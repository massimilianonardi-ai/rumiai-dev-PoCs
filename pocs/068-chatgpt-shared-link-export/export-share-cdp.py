#!/usr/bin/env python3
"""
Experimental shared-link adapter for the UNMODIFIED working macOS CDP exporter.

The original reference/chatgpt-export-v3.py provides the persistent WebSocket
client, CDP event multiplexer, snapshot traversal, audit, and export writer.
This adapter changes only renderer selection/navigation and browser-specific
snapshot discovery. It does not scroll, parse turns from the DOM, invent a
ChatGPT endpoint, or claim that the native application's hook exists on /share/.
"""
from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import sys
import time
import urllib.parse
import urllib.request

REFERENCE = Path(__file__).resolve().parent / "reference" / "chatgpt-export-v3.py"
spec = importlib.util.spec_from_file_location("chatgpt_export_original", REFERENCE)
if spec is None or spec.loader is None:
    raise RuntimeError("share.reference-unavailable: cannot load original exporter")
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)

MAX_JSON_BYTES = 24 * 1024 * 1024
MAX_SCRIPTS = 120


class ExportError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code


def share_url(raw: str) -> str:
    url = urllib.parse.urlsplit(raw)
    if (url.scheme != "https" or url.netloc != "chatgpt.com"
            or not re.fullmatch(r"/share/[A-Za-z0-9-]+/?", url.path)
            or url.username or url.password or url.query):
        raise ExportError("share.invalid-url",
                          "expected https://chatgpt.com/share/<id>")
    return urllib.parse.urlunsplit((url.scheme, url.netloc, url.path, "", ""))


def _api(port: int, path: str, *, method: str = "GET"):
    if not 1 <= port <= 65535:
        raise ExportError("share.invalid-port", "port must be between 1 and 65535")
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}",
                                     method=method)
    try:
        with urllib.request.urlopen(request, timeout=3.0) as response:
            return json.loads(response.read(MAX_JSON_BYTES))
    except Exception as error:
        raise ExportError("share.local-cdp-unavailable",
                          "no local Chrome debugger on 127.0.0.1:"
                          + str(port)) from error


def new_browser_tab(port: int) -> dict:
    # Create a separate blank target, never overwrite an existing user tab.
    target = _api(port, "/json/new?about:blank", method="PUT")
    if target.get("type") != "page" or not target.get("webSocketDebuggerUrl"):
        raise ExportError("share.browser-target-unavailable",
                          "Chrome did not create a debuggable page target")
    return target


def _candidate(value, depth: int = 0):
    if depth > 22 or not isinstance(value, (list, dict)):
        return None
    if isinstance(value, dict):
        mapping = value.get("mapping")
        current = value.get("current_node")
        if isinstance(mapping, dict) and isinstance(current, str) and current in mapping:
            # Check parent chain, not just matching field names.
            visited = set()
            node_id = current
            while node_id:
                if node_id in visited or node_id not in mapping:
                    break
                visited.add(node_id)
                node = mapping[node_id]
                if not isinstance(node, dict):
                    break
                node_id = node.get("parent")
            else:
                return value
        for child in value.values():
            found = _candidate(child, depth + 1)
            if found is not None:
                return found
    else:
        for child in value:
            found = _candidate(child, depth + 1)
            if found is not None:
                return found
    return None


def _record_json_shape(raw: str, stats: dict):
    """Retain structural hints only; never log conversation values or URLs."""
    shapes = stats.setdefault("json_shapes", [])
    if len(shapes) >= 6 or not raw or len(raw) > MAX_JSON_BYTES:
        return
    try:
        value = json.loads(raw)
    except (ValueError, RecursionError):
        return

    def safe_keys(value):
        if not isinstance(value, dict):
            return []
        return sorted(k for k in value
                      if isinstance(k, str)
                      and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,39}", k))[:16]

    def describe(value):
        if isinstance(value, list):
            return {"type": "array", "items": len(value)}
        if not isinstance(value, dict):
            return {"type": type(value).__name__}
        keys = safe_keys(value)
        return {
            "type": "object",
            "keys": keys,
            "nested": {key: safe_keys(value[key])
                       for key in keys if isinstance(value[key], dict)},
        }

    candidate = describe(value)
    if candidate not in shapes:
        shapes.append(candidate)


def _json_candidate(text: str):
    if not text or len(text.encode("utf-8")) > MAX_JSON_BYTES:
        return None
    try:
        return _candidate(json.loads(text))
    except (ValueError, RecursionError):
        return None


def _js_sources(scripts):
    # Original discover_snapshot_function looks only at app:// JS; the shared
    # browser page uses HTTPS bundles. The semantic marker/parameter matching
    # remains identical to the proven original algorithm.
    def priority(item):
        url = item[1]
        return 0 if url.startswith("https://chatgpt.com/") else 1
    return sorted(((sid, url) for sid, url in scripts.items()
                   if url.startswith("https://") and ".js" in url
                   and (url.startswith("https://chatgpt.com/")
                        or ".oaistatic.com/" in url)),
                  key=priority)[:MAX_SCRIPTS]


def discover_share_hook(cdp, scripts):
    for sid, url in _js_sources(scripts):
        try:
            source = cdp.call("Debugger.getScriptSource", {"scriptId": sid}).get(
                "scriptSource", "")
        except Exception:
            continue
        marker_pos = source.find("mergeActiveBranch")
        while marker_pos >= 0:
            window_start = max(0, marker_pos - 500)
            window = source[window_start:marker_pos + 250]
            matches = list(re.finditer(
                r"function\s+([A-Za-z_$][A-Za-z0-9_$]*)\((.*?)\)\{",
                window, re.S))
            for match in reversed(matches):
                params = match.group(2)
                if "mergeActiveBranch" not in params:
                    continue
                pieces = original.split_top_level_params(params)
                if len(pieces) < 2:
                    continue
                arg = pieces[1]
                if not re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", arg):
                    continue
                line, column = original.line_column(
                    source, window_start + match.end())
                return {
                    "url": url, "script_id": sid,
                    "line": line, "column": column,
                    "conversation_arg": arg,
                }
            marker_pos = source.find("mergeActiveBranch", marker_pos + 1)
    return None


def _paused_snapshot(cdp, event, stats):
    frames = event.get("params", {}).get("callFrames", [])
    candidate = None
    try:
        for frame in frames:
            frame_id = frame["callFrameId"]
            # Exactly the original reference's call-frame extraction method.
            arg = stats.get("hook_arg")
            if not arg:
                continue
            try:
                result = original.evaluate_on_frame(
                    cdp, frame_id, f"JSON.stringify({arg})")
                raw = result.get("result", {}).get("value")
                if not isinstance(raw, str):
                    continue
                found = _json_candidate(raw)
                if found is not None:
                    candidate = json.dumps(found, ensure_ascii=False,
                                           separators=(",", ":"))
                    break
            except Exception:
                continue
    finally:
        cdp.call("Debugger.resume")
    return candidate


def _response_snapshot(cdp, request_id, entry, stats):
    url, mime = entry
    # Inspect only passive responses from the page being visited; never
    # synthesize authenticated requests, scrape cookies, or guess endpoints.
    if not url.startswith("https://chatgpt.com/"):
        return None
    if not any(part in mime for part in ("json", "text/html")):
        return None
    stats["inspected_responses"] += 1
    try:
        body = cdp.call("Network.getResponseBody",
                        {"requestId": request_id})
        raw = body.get("body", "")
        if body.get("base64Encoded"):
            raw = base64.b64decode(raw).decode("utf-8", "replace")
        found = _json_candidate(raw)
        if found is None:
            _record_json_shape(raw, stats)
        return found
    except Exception:
        return None


def _embedded_snapshot(cdp):
    # Only literal JSON script tags already present in the rendered page.
    # The DOM is NOT used to reconstruct or scroll message turns.
    expression = """(() => [...document.querySelectorAll(
      'script[type="application/json"]')].slice(0, 20).map(
        s => s.textContent).filter(x => x && x.length < 16000000))()"""
    try:
        response = cdp.call("Runtime.evaluate",
                            {"expression": expression, "returnByValue": True})
        scripts = response.get("result", {}).get("value", [])
        if isinstance(scripts, list):
            for raw in scripts:
                if isinstance(raw, str):
                    found = _json_candidate(raw)
                    if found:
                        return found
    except Exception:
        pass
    return None


def observe(cdp, seconds: int, stats, *, hook_active=False):
    deadline = time.monotonic() + seconds
    scripts = stats.setdefault("scripts", {})
    requests = {}
    while time.monotonic() < deadline:
        try:
            event = cdp.next_event()
        except socket.timeout:
            continue
        method = event.get("method")
        params = event.get("params", {})
        if method == "Debugger.scriptParsed":
            sid = params.get("scriptId")
            if sid:
                scripts[sid] = params.get("url", "")
        elif method == "Network.responseReceived":
            response = params.get("response", {})
            requests[params.get("requestId")] = (
                response.get("url", ""), response.get("mimeType", ""))
        elif method == "Network.loadingFinished":
            rid = params.get("requestId")
            if rid in requests:
                found = _response_snapshot(cdp, rid, requests.pop(rid), stats)
                if found is not None:
                    return json.dumps(found, ensure_ascii=False,
                                      separators=(",", ":")), "observed-network"
        elif method == "Debugger.paused":
            captured = _paused_snapshot(cdp, event, stats)
            if captured is not None and hook_active:
                return captured, "original-breakpoint"
    return None, None


def capture_shared_snapshot(cdp, url: str, seconds: int, stats):
    cdp.call("Runtime.enable")
    cdp.call("Debugger.enable")
    cdp.call("Network.enable")
    cdp.call("Page.enable")
    cdp.ws.sock.settimeout(0.6)

    stats["phase"] = "initial-navigation"
    cdp.call("Page.navigate", {"url": url})
    raw, method = observe(cdp, min(seconds, 10), stats)
    if raw is not None:
        return raw, method
    embedded = _embedded_snapshot(cdp)
    if embedded is not None:
        return json.dumps(embedded, ensure_ascii=False,
                          separators=(",", ":")), "embedded-json"

    stats["phase"] = "hook-discovery"
    hook = discover_share_hook(cdp, stats["scripts"])
    stats["hook_found"] = hook is not None
    if hook is None:
        raise ExportError("share.snapshot-hook-unavailable",
                          "no structured snapshot seen; the native mergeActiveBranch "
                          "hook was not found in loaded shared-page bundles")

    # Unlike the current web-control debug.cdp command, this SAME persistent
    # connection remains attached across breakpoint installation and reload.
    stats["phase"] = "breakpoint-capture"
    stats["hook_arg"] = hook["conversation_arg"]
    cdp.call("Debugger.setBreakpointByUrl", {
        "url": hook["url"], "lineNumber": hook["line"],
        "columnNumber": hook["column"],
    })
    cdp.call("Page.navigate", {"url": url})
    raw, method = observe(cdp, seconds, stats, hook_active=True)
    if raw is None:
        raise ExportError("share.snapshot-not-observed",
                          "hook was installed, but no complete structured "
                          "conversation snapshot was observed before timeout")
    return raw, method


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Experimental CDP snapshot export for ChatGPT share URL")
    parser.add_argument("share_url", help="https://chatgpt.com/share/<id>")
    parser.add_argument("output", nargs="?", type=Path, default=Path("./archive"))
    parser.add_argument("--port", type=int, default=9222,
                        help="explicit local Chrome debugging port (default 9222)")
    parser.add_argument("--seconds", type=int, default=20,
                        help="per-stage maximum observation time (default 20)")
    args = parser.parse_args(argv)
    url = share_url(args.share_url)
    if not 1 <= args.seconds <= 120:
        parser.error("--seconds must be between 1 and 120")

    # Private archive; never print raw JSON, cookies or signed media URLs.
    os.umask(0o077)
    output = args.output.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    stats = {
        "kind": "chatgpt-share-cdp-snapshot",
        "phase": "target-creation",
        "hook_found": False,
        "inspected_responses": 0,
        "scripts": {},
        "json_shapes": [],
    }
    target = None
    cdp = None
    try:
        target = new_browser_tab(args.port)
        cdp = original.CDP(target["webSocketDebuggerUrl"])
        raw, method = capture_shared_snapshot(cdp, url, args.seconds, stats)
        snapshot = _json_candidate(raw)
        if not snapshot:
            raise ExportError("share.invalid-snapshot", "captured data is not a valid parent-linked mapping")
        selected = {
            "thread_id": snapshot.get("conversation_id") or url.rsplit("/", 1)[-1],
            "display_title": snapshot.get("title") or "Shared conversation",
            "source_created_at": snapshot.get("create_time"),
        }
        exported = original.export_snapshot(raw, selected, output)
        manifest = {
            "source": url, "method": method,
            "captured_mapping_nodes": exported["mapping_nodes"],
            "visible_messages": exported["visible_messages"],
            "non_text_parts": exported["non_text_parts"],
            "media_binary_downloaded": False,
        }
        (exported["outdir"] / "ACQUISITION.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8")
        print(json.dumps({
            "directory": str(exported["outdir"]),
            "zip": str(exported["zip"]),
            "method": method,
            "messageCount": exported["visible_messages"],
            "nonTextParts": exported["non_text_parts"],
            "imagesDownloaded": 0,
            "mediaBinaryAvailable": False,
        }, ensure_ascii=False, indent=2))
        return 0
    except (ExportError, OSError, RuntimeError) as error:
        # Only non-sensitive diagnostics; never persist arbitrary page payloads.
        diagnostics = {
            "status": "incomplete", "error": getattr(error, "code", "share.cdp-failed"),
            "phase": stats["phase"],
            "hookFound": stats["hook_found"],
            "scriptCount": len(stats["scripts"]),
            "inspectedResponses": stats["inspected_responses"],
            "observedJsonShapes": stats["json_shapes"],
        }
        file = output / "share-cdp-diagnostic.json"
        file.write_text(json.dumps(diagnostics, indent=2) + "\n",
                        encoding="utf-8")
        print(f"{error}\nDiagnostic: {file}", file=sys.stderr)
        return 1
    finally:
        if cdp is not None:
            cdp.ws.sock.close()
        if target and target.get("id"):
            # Close only the blank target created for this export.
            try:
                _api(args.port, "/json/close/"
                     + urllib.parse.quote(target["id"], safe=""))
            except ExportError:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
