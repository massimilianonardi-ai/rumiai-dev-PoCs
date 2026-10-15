"""Tests for the share adapter and unchanged reference snapshot writer."""
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("share_cdp", ROOT / "export-share-cdp.py")
share = importlib.util.module_from_spec(spec)
spec.loader.exec_module(share)


def sample_snapshot():
    return {
        "title": "Shared sample",
        "conversation_id": "conversation-example",
        "create_time": 1792100000,
        "current_node": "assistant",
        "mapping": {
            "user": {
                "parent": None,
                "message": {"id": "u1", "author": {"role": "user"},
                            "content": {"parts": ["Hello"]}},
            },
            "assistant": {
                "parent": "user",
                "message": {"id": "a1", "author": {"role": "assistant"},
                            "content": {"parts": [
                                "Visual answer",
                                {"content_type": "image_asset_pointer",
                                 "asset_pointer": "image-reference"}
                            ]}},
            },
            "unused": {
                "parent": None,
                "message": {"id": "other", "author": {"role": "assistant"},
                            "content": {"parts": ["Not on active branch"]}},
            },
        },
    }


class FakeCdp:
    def __init__(self, source):
        self.source = source
        self.calls = []

    def call(self, method, params=None):
        self.calls.append((method, params))
        if method == "Debugger.getScriptSource":
            return {"scriptSource": self.source}
        return {}


class ShareCdpTests(unittest.TestCase):
    def test_url_is_not_a_login_or_external_endpoint(self):
        good = "https://chatgpt.com/share/1234-5678"
        self.assertEqual(share.share_url(good), good)
        for url in [
            "http://chatgpt.com/share/example",
            "https://evil.example/share/example",
            "https://chatgpt.com.evil.org/share/example",
            "https://chatgpt.com/work/conversation/example",
            "https://chatgpt.com/share/example?secret=x",
        ]:
            with self.subTest(url=url), self.assertRaises(share.ExportError):
                share.share_url(url)

    def test_real_reference_json_mapping_extraction(self):
        value = sample_snapshot()
        self.assertEqual(share._json_candidate(json.dumps(value)), value)
        self.assertEqual(share._json_candidate(json.dumps({"props": value})), value)
        self.assertIsNone(share._json_candidate('{"random":{"mapping":{}}}'))
        broken = sample_snapshot()
        broken["mapping"]["assistant"]["parent"] = "missing"
        self.assertIsNone(share._json_candidate(json.dumps(broken)))
        cycle = sample_snapshot()
        cycle["mapping"]["user"]["parent"] = "assistant"
        self.assertIsNone(share._json_candidate(json.dumps(cycle)))

    def test_original_semantic_marker_discovery_uses_loaded_browser_bundle(self):
        fake_source = (
            'function z(e,t){const s=mergeActiveBranch(e,t);return s;}'
        )
        cdp = FakeCdp(fake_source)
        hook = share.discover_share_hook(cdp, {"42": "https://chatgpt.com/assets/main.js"})
        self.assertIsNotNone(hook)
        self.assertEqual(hook["conversation_arg"], "t")
        self.assertEqual(hook["line"], 0)
        self.assertTrue(any(method == "Debugger.getScriptSource"
                            for method, _ in cdp.calls))
        cdp2 = FakeCdp('function z(){return 1;}')
        self.assertIsNone(share.discover_share_hook(
            cdp2, {"42": "https://chatgpt.com/assets/main.js"}))

    def test_reference_export_preserves_multimodal_objects_and_active_branch(self):
        value = sample_snapshot()
        with tempfile.TemporaryDirectory() as directory:
            selected = {"thread_id": "conversation-example",
                        "display_title": "Shared sample"}
            exported = share.original.export_snapshot(
                json.dumps(value), selected, Path(directory))
            self.assertEqual(exported["visible_messages"], 2)
            self.assertEqual(exported["non_text_parts"], 1)
            self.assertEqual(exported["mapping_nodes"], 3)
            saved = json.loads(gzip.decompress(
                (exported["outdir"] / "conversation.raw.json.gz").read_bytes()))
            self.assertEqual(saved, value)
            rows = (exported["outdir"] / "VISIBLE_MESSAGES.jsonl").read_text().splitlines()
            parsed = [json.loads(line) for line in rows]
            self.assertEqual([row["role"] for row in parsed], ["user", "assistant"])
            self.assertEqual(parsed[1]["message"]["content"]["parts"][1][
                "asset_pointer"], "image-reference")
            self.assertNotIn("Not on active branch",
                             (exported["outdir"] / "TRANSCRIPT.md").read_text())
            self.assertTrue(exported["zip"].is_file())

    def test_no_debugger_is_explicit_failure_not_an_empty_success_export(self):
        with self.assertRaises(share.ExportError):
            share.share_url("https://example.com/not-a-share")


if __name__ == "__main__":
    unittest.main()
