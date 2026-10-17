#!/usr/bin/env python3
"""Build PoC-local static HTML views from Chromium's original MHTML evidence.

This is a derived, non-executable display format, not replacement evidence.
Never download remote content and never silently treat missing CSS as preserved.
"""
import hashlib
import html
import json
import mimetypes
import re
import sys
from email import policy
from email.parser import BytesParser
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urldefrag, urlsplit

SAFE_TYPES = ("text/css", "image/", "font/", "application/font",
              "application/vnd.ms-fontobject", "application/octet-stream")
SUFFIXES = {
    "text/css": ".css", "image/png": ".png", "image/jpeg": ".jpg",
    "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg",
    "font/woff": ".woff", "font/woff2": ".woff2",
    "application/font-woff": ".woff", "application/font-woff2": ".woff2",
    "application/vnd.ms-fontobject": ".eot", "font/ttf": ".ttf",
    "font/otf": ".otf",
}
URL_PATTERN = re.compile(r"""url\(\s*(['"]?)(.*?)\1\s*\)""", re.I)
IMPORT_PATTERN = re.compile(r"""@import\s+(['"])(.*?)\1""", re.I)


def escape(value):
    return html.escape(str(value), quote=True)


def normalized(source, base):
    value = html.unescape(str(source or "")).strip().strip("<>")
    if not value or value.startswith(("data:", "blob:", "cid:", "#")):
        return value
    return urldefrag(urljoin(base, value))[0]


class Archive:
    def __init__(self, raw):
        msg = BytesParser(policy=policy.default).parsebytes(raw)
        if not msg.is_multipart():
            raise ValueError("MHTML has no MIME multipart evidence")
        self.parts = {}
        self.main = None
        self.origin = ""
        for part in msg.walk():
            if part.is_multipart():
                continue
            ct = part.get_content_type().lower()
            location = part.get("Content-Location", "").strip().strip("<>")
            content = part.get_payload(decode=True)
            if not isinstance(content, bytes):
                continue
            if ct == "text/html" and self.main is None:
                self.main = content
                self.origin = location
            elif location:
                self.parts[location] = (ct, content)
        if self.main is None:
            raise ValueError("MHTML has no HTML root part")
        if not urlsplit(self.origin).scheme:
            self.origin = "https://archived.invalid/"
        self.files = {}
        self.stylesheet_references = 0
        self.inline_styles = 0
        self.missing = []
        self.resources = {}
        for location, (ct, payload) in self.parts.items():
            if not ct.startswith(SAFE_TYPES):
                continue
            resolved = normalized(location, self.origin)
            if not resolved.startswith(("https://", "http://")):
                continue
            suffix = SUFFIXES.get(ct, mimetypes.guess_extension(ct) or ".bin")
            filename = hashlib.sha256(resolved.encode()).hexdigest()[:20] + suffix
            self.resources[resolved] = (ct, payload, filename)

    def resolve(self, value, base, kind="resource", asset_prefix="offline-assets/"):
        value = str(value or "").strip()
        if value.startswith(("data:", "#")):
            return value
        full = normalized(value, base)
        if full in self.resources:
            return asset_prefix + self.resources[full][2]
        # Original MHTML may contain file:///run/user portal aliases from
        # Chromium or desktop integration. Never propagate local file paths
        # into the derived viewer or its public inspection diagnostics.
        safe = (full[:600] if full.startswith(("https://", "http://"))
                else "[local-or-unsupported-uri-blocked]")
        self.missing.append({"type": kind, "url": safe})
        return "about:blank"

    def css(self, css, base, asset_prefix="offline-assets/"):
        def replace_url(match):
            value = match.group(2)
            return "url(" + json.dumps(self.resolve(value, base, "css-resource", asset_prefix)) + ")"
        content = URL_PATTERN.sub(replace_url, css)
        def replace_import(match):
            value = match.group(2)
            return '@import "' + self.resolve(value, base, "css-import", asset_prefix) + '"'
        return IMPORT_PATTERN.sub(replace_import, content)

    def write_resources(self, dest):
        folder = dest / "offline-assets"
        folder.mkdir(mode=0o700, exist_ok=True)
        for url, (ct, payload, name) in self.resources.items():
            if ct == "text/css":
                payload = self.css(payload.decode("utf-8", errors="replace"), url,
                                   asset_prefix="").encode()
            destination = folder / name
            if destination.exists():
                if destination.read_bytes() != payload:
                    raise ValueError("offline.derived-resource-conflict")
            else:
                with destination.open("xb") as out:
                    out.write(payload)
        return folder


class StaticHTML(HTMLParser):
    def __init__(self, archive):
        super().__init__(convert_charrefs=False)
        self.archive = archive
        self.output = []
        self.skip_script = 0
        self.in_style = False

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.skip_script += 1
            return
        if self.skip_script:
            return
        if tag == "base":
            return
        original = dict(attrs)
        if tag == "meta" and original.get("http-equiv", "").lower() == "refresh":
            return
        if tag in ("iframe", "object", "embed"):
            self.output.append('<span data-offline-unavailable="embedded-frame">[Embedded frame not archived]</span>')
            return
        updated = []
        for key, value in attrs:
            if key.lower().startswith("on") or key in ("integrity", "nonce"):
                continue
            if value is None:
                updated.append((key, value))
                continue
            if key == "style":
                value = self.archive.css(value, self.archive.origin)
            elif tag == "link" and key == "href":
                if "stylesheet" in (original.get("rel") or "").lower():
                    self.archive.stylesheet_references += 1
                    value = self.archive.resolve(value, self.archive.origin, "stylesheet")
                else:
                    continue  # Ignore prefetch, favicon, manifest and preload links.
            elif key in ("src", "poster", "background"):
                value = self.archive.resolve(value, self.archive.origin, tag + "-" + key)
            elif key == "href":
                # No browser-local file references may escape via the viewer.
                if (value.lower().startswith(("javascript:", "file:", "blob:"))
                        or "/run/user/" in value):
                    value = "#"
            elif key == "srcset":
                # A comma-separated URL set; data-URLs are not split safely.
                chunks = []
                for item in value.split(","):
                    components = item.strip().split()
                    if not components:
                        continue
                    url = self.archive.resolve(components[0], self.archive.origin, "srcset")
                    chunks.append(" ".join([url, *components[1:]]))
                value = ", ".join(chunks)
            updated.append((key, value))
        values = "".join(" " + key if value is None else
                         " " + key + '="' + escape(value) + '"'
                         for key, value in updated)
        self.output.append("<" + tag + values + ">")
        if tag == "style":
            self.in_style = True
            self.archive.inline_styles += 1

    def handle_startendtag(self, tag, attrs):
        size = len(self.output)
        self.handle_starttag(tag, attrs)
        if len(self.output) > size and self.output[-1].endswith(">"):
            # Preserve self-closing SVG nodes; converting <path/> to <path>
            # can change subsequent sibling layout.
            self.output[-1] = self.output[-1][:-1] + "/>"

    def handle_endtag(self, tag):
        if tag == "script":
            if self.skip_script:
                self.skip_script -= 1
            return
        if self.skip_script or tag in ("base", "iframe", "object", "embed"):
            return
        self.output.append("</" + tag + ">")
        if tag == "style":
            self.in_style = False

    def handle_data(self, data):
        if not self.skip_script:
            self.output.append(
                self.archive.css(data, self.archive.origin)
                if self.in_style else data
            )

    def handle_entityref(self, name):
        if not self.skip_script:
            self.output.append("&" + name + ";")

    def handle_charref(self, name):
        if not self.skip_script:
            self.output.append("&#" + name + ";")

    def handle_comment(self, data):
        if not self.skip_script:
            self.output.append("<!--" + data + "-->")

    def handle_decl(self, decl):
        self.output.append("<!" + decl + ">")


def write_json_new(path, item):
    with path.open("x", encoding="utf-8") as out:
        json.dump(item, out, indent=2, ensure_ascii=False)
        out.write("\n")


def render_state(folder):
    original = folder / "page.mhtml"
    if not original.is_file():
        return {"state": folder.name, "present": False}
    if (folder / "offline.html").exists():
        stored = folder / "offline-report.json"
        if not stored.is_file():
            raise ValueError("offline.derived-report-missing")
        report = json.loads(stored.read_text(encoding="utf-8"))
        report["existing"] = True
        return report
    archive = Archive(original.read_bytes())
    view = StaticHTML(archive)
    view.feed(archive.main.decode("utf-8", errors="replace"))
    view.close()
    archive.write_resources(folder)
    with (folder / "offline.html").open("x", encoding="utf-8") as out:
        out.write("".join(view.output))
    missing_css = [m for m in archive.missing
                   if m["type"] in ("stylesheet", "css-import")]
    report = {
        "state": folder.name,
        "mhtmlResourceCount": len(archive.parts),
        "archivedUsableResources": len(archive.resources),
        "archivedStylesheets": sum(1 for ct, _, _ in archive.resources.values()
                                    if ct == "text/css"),
        "htmlStylesheetLinks": archive.stylesheet_references,
        "htmlInlineStyleTags": archive.inline_styles,
        "missingStylesheets": missing_css,
        "missingResourceCount": len(archive.missing),
        "offlineCssComplete": (
            not missing_css and (
                archive.inline_styles > 0 or archive.stylesheet_references > 0
            )
        ),
        "visualFidelityVerified": False,
        "originalMhtmlPreserved": True,
        "notice": "Derived script-free HTML; compare to recorded page.png. Not a pixel-perfect reconstruction."
    }
    write_json_new(folder / "offline-report.json", report)
    return report


def review_page(site, states, reports):
    cards = []
    for folder in states:
        sub = folder.relative_to(site).as_posix()
        report = reports.get(sub, {})
        style = ("CSS links resolved (visual fidelity not verified)"
                 if report.get("offlineCssComplete")
                 else "CSS not fully archived; compare screenshot")
        link = ('<a href="' + escape(sub) + '/offline.html">View styled archived HTML</a>'
                if (folder / "offline.html").exists()
                else "MHTML unavailable")
        cards.append(
            '<section><h2>' + escape(sub) + '</h2>'
            '<p>' + escape(style) + '</p>'
            '<p>' + link + ' · <a href="' + escape(sub) +
            '/offline-report.json">CSS resource diagnostics</a></p>'
            '<img loading="lazy" src="' + escape(sub) +
            '/page.png" alt="Original rendered viewport screenshot">'
            '</section>'
        )
    return ('<!doctype html><html lang="it"><head><meta charset="utf-8">'
            '<title>PoC evidence — offline styled comparison</title>'
            '<style>body{font:16px system-ui;max-width:1100px;margin:2rem auto;padding:0 1rem}'
            'section{border:1px solid #ccc;padding:1rem;margin:2rem 0;border-radius:10px}'
            'img{width:100%;max-width:100%;height:auto}'
            'a{color:#135da6}</style></head><body>'
            '<h1>Offline HTML + browser screenshot</h1>'
            '<p>All references are relative to the PoC. Original MHTML and raw HTML are unchanged.'
            ' Each screenshot is the reference; a missing CSS report means HTML fidelity is not accepted.</p>'
            + "".join(cards) + '</body></html>\n')


def main(argv):
    if len(argv) != 2:
        print("usage: python3 experiments/prepare-offline-views.py "
              "./experiments/evidence/<existing-run>", file=sys.stderr)
        return 2
    poc = Path(__file__).resolve().parent.parent
    base = poc / "experiments" / "evidence"
    target = Path(argv[1]).resolve(strict=True)
    if target.parent != base.resolve() or not target.is_dir():
        print("offline.evidence-must-be-in-poc", file=sys.stderr)
        return 2
    all_results = {}
    for site in ("amazon-wishlist", "chatgpt-share"):
        root = target / site
        if not root.is_dir():
            continue
        states = [root / name for name in ("manual-initial", "manual-final")]
        replay = root / "replay"
        if replay.is_dir():
            states += sorted(p for p in replay.iterdir()
                             if p.is_dir() and re.fullmatch(r"[0-9]{4}", p.name))
        states = [p for p in states if (p / "page.mhtml").is_file()]
        report = {}
        for state in states:
            relative = state.relative_to(root).as_posix()
            try:
                report[relative] = render_state(state)
            except Exception as exc:
                report[relative] = {"state": relative, "error": type(exc).__name__,
                                    "diagnostic": str(exc)[:180]}
        out = root / "review-offline.html"
        if not out.exists():
            out.write_text(review_page(root, states, report), encoding="utf-8")
        all_results[site] = {"states": len(states), "results": report}
    report_path = target / "offline-preparation-report.json"
    if not report_path.exists():
        write_json_new(report_path, all_results)
    print(json.dumps({"root": str(target), "sites": {
        k: {"states": v["states"],
            "errors": sum("error" in item for item in v["results"].values()),
            "cssUnverified": sum(item.get("offlineCssComplete") is not True
                                 for item in v["results"].values())}
        for k, v in all_results.items()}}, ensure_ascii=False, indent=2))
    return 1 if any(("error" in item or
                     item.get("offlineCssComplete") is not True)
                    for r in all_results.values()
                    for item in r["results"].values()) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
