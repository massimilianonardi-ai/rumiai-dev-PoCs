"""Real HTTP → native MHTML → offline file reopen in Chromium.

Never alters the saved MHTML or rewrites CSS/asset paths. All test evidence
is held exclusively in a disposable folder within this PoC's evidence/.
"""
import io
import json
import shutil
import tempfile
import threading
import unittest
from email import policy
from email.parser import BytesParser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "fixture"
EVIDENCE = ROOT / "evidence"


class QuietHTTP(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def visual_state(page):
    return page.evaluate("""() => ({
      heading:document.querySelector('h1')?.textContent,
      border:getComputedStyle(document.querySelector('#scrollbox')).borderTopColor,
      logoLoaded:document.querySelector('header img')?.naturalWidth > 0,
      cards:document.querySelectorAll('.item').length
    })""")


def difference_ratio(a, b):
    before = Image.open(io.BytesIO(a)).convert("RGB")
    after = Image.open(io.BytesIO(b)).convert("RGB")
    if before.size != after.size:
        return 1.0
    return sum(max(p) > 36 for p in ImageChops.difference(before, after).getdata()
               ) / (before.width * before.height)


class NativeOfflineTest(unittest.TestCase):
    def test_real_http_mhtml_reopens_with_css_svg_and_no_network(self):
        EVIDENCE.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="native-offline-", dir=EVIDENCE) as name:
            dest = Path(name)
            server = ThreadingHTTPServer(("127.0.0.1", 0),
                partial(QuietHTTP, directory=str(FIXTURE)))
            task = threading.Thread(target=server.serve_forever, daemon=True)
            task.start()
            try:
                with sync_playwright() as playwright:
                    executable = (shutil.which("chromium") or
                                  shutil.which("chromium-browser") or
                                  playwright.chromium.executable_path)
                    browser = playwright.chromium.launch(headless=True,
                        executable_path=executable)
                    try:
                        context = browser.new_context(viewport={"width":1024,"height":768},
                                                      device_scale_factor=1)
                        page = context.new_page()
                        url = f"http://127.0.0.1:{server.server_port}/index.html"
                        response = page.goto(url, wait_until="load")
                        self.assertEqual(response.status, 200)
                        original = visual_state(page)
                        self.assertEqual(original["border"], "rgb(17, 108, 127)")
                        self.assertTrue(original["logoLoaded"])
                        self.assertEqual(original["cards"], 6)
                        shot = page.screenshot(full_page=False, animations="disabled")
                        (dest / "original.png").write_bytes(shot)
                        dom = page.content()
                        self.assertIn('href="style.css"', dom)
                        (dest / "dom.html").write_text(dom, encoding="utf-8")

                        session = context.new_cdp_session(page)
                        raw = session.send("Page.captureSnapshot", {"format":"mhtml"})["data"]
                        session.detach()
                        archived = dest / "original.mhtml"
                        archived.write_text(raw, encoding="utf-8")
                        items = [(x.get_content_type(), x.get("Content-Location",""))
                                 for x in BytesParser(policy=policy.default
                                    ).parsebytes(raw.encode("utf-8")).walk()
                                 if not x.is_multipart()]
                        self.assertTrue(any(ct=="text/css" and "style.css" in loc
                                            for ct,loc in items), items)
                        self.assertTrue(any(ct=="image/svg+xml" and "mark.svg" in loc
                                            for ct,loc in items), items)
                        self.assertNotIn("/run/user/", raw)

                        offline = context.new_page()
                        outgoing = []
                        def forbid(route):
                            outgoing.append(route.request.url)
                            route.abort()
                        offline.route("http://**/*", forbid)
                        offline.route("https://**/*", forbid)
                        offline.goto(archived.as_uri(), wait_until="load")
                        offline.wait_for_timeout(250)
                        restored = visual_state(offline)
                        self.assertEqual(restored["border"], original["border"])
                        self.assertEqual(restored["heading"], original["heading"])
                        self.assertTrue(restored["logoLoaded"])
                        self.assertEqual(restored["cards"], original["cards"])
                        self.assertEqual(outgoing, [], "offline archive fetched live resources")
                        shot_offline = offline.screenshot(full_page=False,
                            animations="disabled")
                        (dest / "offline.png").write_bytes(shot_offline)
                        delta = difference_ratio(shot, shot_offline)
                        (dest / "result.json").write_text(json.dumps({
                            "original":original,"reopened":restored,
                            "screenshotPixelDifference":delta,
                            "externalRequests":outgoing,
                            "mhtmlNative":True,
                            "savePageCompleteHtmlVerified":False
                        },indent=2)+"\n")
                        self.assertLess(delta, 0.03,
                            f"native MHTML visually differs from browser: {delta:.3f}")
                    finally:
                        browser.close()
            finally:
                server.shutdown()
                server.server_close()


if __name__ == "__main__":
    unittest.main()
