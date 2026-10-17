"""Targeted controlled tests; no real-site or full-page-save claims."""
import shutil
import unittest
import uuid
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from experiment import EVIDENCE, infer_phases, run


class ObservationTests(unittest.TestCase):
    def test_reversal_is_not_erased(self):
        samples = [{'container':'#scrollbox', 'top':position}
                   for position in (0, 200, 400, 250, 100, 0)]
        phases = infer_phases(samples)
        self.assertEqual([phase['direction'] for phase in phases], ['down', 'up'])
        self.assertEqual(phases[0]['from'], 0)
        self.assertEqual(phases[0]['to'], 400)
        self.assertEqual(phases[1]['from'], 400)
        self.assertEqual(phases[1]['to'], 0)

    def test_path_must_be_one_run_name(self):
        with self.assertRaisesRegex(ValueError, 'output.invalid-run-name'):
            run('../outside-poc', 'scripted', embedded=True)
        with self.assertRaisesRegex(ValueError, 'output.invalid-run-name'):
            run('/run/user/1000/doc/missing', 'scripted', embedded=True)

    def test_real_chromium_nested_scroll_and_native_mhtml(self):
        name = 'browser-test-' + uuid.uuid4().hex[:10]
        destination = EVIDENCE / name
        try:
            result = run(name, 'scripted', embedded=True)
            self.assertEqual(result['inferredDirections'], ['down', 'up'])
            self.assertTrue(result['replayFinishedAtTop'])
            self.assertIsNone(result['nativeCssIncluded'])
            self.assertFalse(result['visualFidelityVerified'])
            self.assertFalse(result['completeSavePageHtmlTested'])
            for state in ('00-start', '01-down', '02-up'):
                folder = destination / state
                self.assertTrue((folder / 'page.mhtml').is_file())
                self.assertTrue((folder / 'dom-snapshot.json').is_file())
                self.assertTrue((folder / 'viewport.png').is_file())
                self.assertTrue((folder / 'manifest.json').is_file())
            self.assertEqual(result['states']['01-down']['viewport']['shown'], 24)
            self.assertLessEqual(result['states']['02-up']['viewport']['top'], 2)
        finally:
            if destination.exists():
                shutil.rmtree(destination)


if __name__ == '__main__':
    unittest.main()
