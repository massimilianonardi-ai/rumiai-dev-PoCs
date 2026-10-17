import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email import encoders

POC = pathlib.Path(__file__).resolve().parent.parent
SCRIPT = POC / "experiments" / "prepare-offline-views.py"
spec = importlib.util.spec_from_file_location("offline_views", SCRIPT)
offline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(offline)


def fixture(css_href=True):
    root = MIMEMultipart("related")
    document = (
        '<!doctype html><html><head>'
        + ('<link rel="stylesheet" href="/static/main.css">' if css_href else '')
        + '</head><body><script>window.bad=true</script>'
        '<div class="card" style="background-image:url(/picture.png)">Hello</div>'
        '<img src="/picture.png">'
        '</body></html>'
    )
    html_part = MIMEText(document, "html", "utf-8")
    html_part["Content-Location"] = "https://example.org/story"
    root.attach(html_part)
    if css_href:
        css = MIMEText('.card{font-family:local;'
                       'background-image:url("/picture.png");'
                       'src:url("/font.woff2")}', "css", "utf-8")
        css["Content-Location"] = "https://example.org/static/main.css"
        root.attach(css)
    image = MIMEBase("image", "png")
    image.set_payload(b"\x89PNG\r\n\x1a\nfakepixels")
    encoders.encode_base64(image)
    image["Content-Location"] = "https://example.org/picture.png"
    root.attach(image)
    font = MIMEBase("font", "woff2")
    font.set_payload(b"fakefont")
    encoders.encode_base64(font)
    font["Content-Location"] = "https://example.org/font.woff2"
    root.attach(font)
    return root.as_bytes()


class OfflineMhtmlTests(unittest.TestCase):
    def test_css_references_and_images_rewritten_to_local_poc_files(self):
        evidence = POC / "experiments" / "evidence"
        evidence.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=evidence) as temp:
            state = pathlib.Path(temp)
            (state / "page.mhtml").write_bytes(fixture())
            report = offline.render_state(state)
            text = (state / "offline.html").read_text()
            self.assertIn('href="offline-assets/', text)
            self.assertIn('src="offline-assets/', text)
            self.assertNotIn("<script", text)
            self.assertNotIn("https://example.org/static", text)
            self.assertTrue(report["offlineCssComplete"])
            css_files = list((state / "offline-assets").glob("*.css"))
            self.assertEqual(len(css_files), 1)
            css_text = css_files[0].read_text()
            self.assertNotIn("offline-assets/offline-assets", css_text)
            self.assertIn('url("', css_text)
            self.assertFalse("https://example.org" in css_text)
            self.assertEqual(report["missingResourceCount"], 0)

    def test_missing_stylesheet_is_explicitly_reported(self):
        mhtml = fixture(css_href=False)
        evidence = POC / "experiments" / "evidence"
        evidence.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=evidence) as temp:
            state = pathlib.Path(temp)
            (state / "page.mhtml").write_bytes(mhtml)
            report = offline.render_state(state)
            self.assertFalse(report["offlineCssComplete"])
            self.assertEqual(report["htmlStylesheetLinks"], 0)

    def test_desktop_portal_resource_uri_is_not_exposed_in_derived_html(self):
        evidence = POC / "experiments" / "evidence"
        evidence.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=evidence) as temp:
            state = pathlib.Path(temp)
            mhtml = MIMEMultipart("related")
            body = MIMEText(
                '<html><head><link rel="stylesheet" '
                'href="file:///run/user/1000/doc/portal.css"></head>'
                '<body><a href="file:///run/user/1000/doc/foo">bad link</a>'
                '<img src="file:///run/user/1000/doc/missing.png"></body></html>',
                "html", "utf-8")
            body["Content-Location"] = "https://example.org/"
            mhtml.attach(body)
            (state / "page.mhtml").write_bytes(mhtml.as_bytes())
            report = offline.render_state(state)
            view = (state / "offline.html").read_text()
            self.assertNotIn("/run/user/", view)
            self.assertIn("about:blank", view)
            self.assertFalse(report["offlineCssComplete"])
            diagnostic = (state / "offline-report.json").read_text()
            self.assertNotIn("/run/user/", diagnostic)

    def test_review_links_derived_view_and_screenshot_not_raw_mhtml(self):
        evidence = POC / "experiments" / "evidence"
        evidence.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=evidence) as temp:
            site = pathlib.Path(temp)
            state = site / "replay" / "0000"
            state.mkdir(parents=True)
            (state / "offline.html").write_text("<html></html>")
            rendered = offline.review_page(site, [state], {
                "replay/0000": {"offlineCssComplete": True}
            })
            self.assertIn('replay/0000/offline.html', rendered)
            self.assertIn('replay/0000/page.png', rendered)
            self.assertNotIn('page.mhtml"', rendered)
            self.assertNotIn('/run/user/', rendered)


if __name__ == "__main__":
    unittest.main()
