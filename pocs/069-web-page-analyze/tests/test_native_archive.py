"""Native Chromium stylesheet archival test, without page-export rewriting."""
import unittest
import shutil
from email import policy
from email.parser import BytesParser
from pathlib import Path
from playwright.sync_api import sync_playwright

FIXTURE = Path(__file__).resolve().parent.parent / 'fixture'


class NativeArchiveTests(unittest.TestCase):
    def test_browser_snapshot_includes_external_css_response(self):
        with sync_playwright() as p:
            executable = (shutil.which('chromium') or
                          shutil.which('chromium-browser') or
                          p.chromium.executable_path)
            browser = p.chromium.launch(headless=True, executable_path=executable)
            try:
                page = browser.new_page()
                seen = []
                def css_response(route):
                    seen.append(route.request.url)
                    route.fulfill(
                        body=(FIXTURE / 'style.css').read_bytes(),
                        content_type='text/css'
                    )
                # This is an independently requested stylesheet resource, not
                # a CSS string inserted into the HTML document.
                page.route('**/style.css', css_response)
                page.set_content(
                    '<html><head><base href="https://fixture.invalid/">' +
                    '<link rel="stylesheet" href="style.css"></head>' +
                    '<body><main style="height:20px;overflow:auto">test</main>' +
                    '</body></html>', wait_until='load')
                self.assertEqual(seen, ['https://fixture.invalid/style.css'])
                cdp = page.context.new_cdp_session(page)
                data = cdp.send('Page.captureSnapshot', {'format':'mhtml'})['data']
                parts = [
                    (part.get_content_type(), part.get('Content-Location'))
                    for part in BytesParser(policy=policy.default).parsebytes(
                        data.encode('utf-8')).walk() if not part.is_multipart()
                ]
                self.assertIn(('text/css', 'https://fixture.invalid/style.css'), parts)
                self.assertNotIn('file:///', data)
                cdp.detach()
            finally:
                browser.close()


if __name__ == '__main__':
    unittest.main()
