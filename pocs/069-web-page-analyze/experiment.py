#!/usr/bin/env python3
"""Controlled browser experiment. Not an installed exporter or a provider."""
import argparse
import hashlib
import json
import re
import shutil
import threading
from email import policy
from email.parser import BytesParser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
FIXTURE = ROOT / 'fixture'
EVIDENCE = ROOT / 'evidence'

OBSERVE = r'''(() => {
  const target = document.querySelector('#scrollbox');
  if (!target || target.dataset.observed) return;
  target.dataset.observed = 'yes';
  target.addEventListener('scroll', event => {
    const el = event.currentTarget;
    window.__observe({container:'#scrollbox', top:Math.round(el.scrollTop),
      height:el.scrollHeight, viewport:el.clientHeight,
      trusted:event.isTrusted, at:Date.now()});
  }, {passive:true});
})()'''


def infer_phases(samples):
    """Preserve observed scroll direction and reversals instead of imposing a scan."""
    phases = []
    prev = None
    for sample in samples:
        pos = sample['top']
        if prev is None:
            prev = pos
            continue
        delta = pos - prev
        if delta == 0:
            continue
        direction = 'down' if delta > 0 else 'up'
        if not phases or phases[-1]['direction'] != direction:
            phases.append({'direction':direction, 'from':prev, 'to':pos,
                           'container':sample['container'], 'events':1})
        else:
            phases[-1]['to'] = pos
            phases[-1]['events'] += 1
        prev = pos
    return phases


def geometry(page):
    return page.locator('#scrollbox').evaluate('el => ({top:Math.round(el.scrollTop), '
        'max:Math.round(el.scrollHeight-el.clientHeight), '
        'shown:document.querySelectorAll(".item").length, '
        'color:getComputedStyle(el).borderTopColor})')


def wheel_until(page, direction):
    """Real browser mouse-wheel input, stopped by observed edge stability."""
    page.locator('#scrollbox').hover()
    stops = 0
    for _ in range(80):
        before = geometry(page)
        page.mouse.wheel(0, 250 if direction == 'down' else -250)
        page.wait_for_timeout(100)
        after = geometry(page)
        at_edge = (after['top'] >= after['max'] - 2 if direction == 'down'
                   else after['top'] <= 2)
        stops = stops + 1 if (at_edge and after['top'] == before['top']
                              and after['shown'] == before['shown']) else 0
        if stops >= 3:
            return after
    raise RuntimeError('scroll.boundary-not-stable')


def capture_state(page, target, label):
    state = target / label
    state.mkdir(mode=0o700)
    cdp = page.context.new_cdp_session(page)
    try:
        mhtml = cdp.send('Page.captureSnapshot', {'format':'mhtml'})['data']
        (state / 'page.mhtml').write_text(mhtml, encoding='utf-8')
        # DOM serialization is deliberately distinct from native browser archive.
        (state / 'dom.html').write_text(page.content(), encoding='utf-8')
        snap = cdp.send('DOMSnapshot.captureSnapshot', {
            'computedStyles':['display','color','background-color','border-top-color'],
            'includeDOMRects':True
        })
        (state / 'dom-snapshot.json').write_text(json.dumps(snap, indent=2))
        page.screenshot(path=str(state / 'viewport.png'), full_page=False)
        mime = BytesParser(policy=policy.default).parsebytes(mhtml.encode('utf-8'))
        types = [part.get_content_type() for part in mime.walk()
                 if not part.is_multipart()]
        report = {
            'viewport':geometry(page), 'mhtmlMimePartTypes':types,
            'mhtmlContainsExternalCss':'text/css' in types,
            'mhtmlContainsSvg':'image/svg+xml' in types,
            'domHtmlIsCompleteArchive':False,
            'mhtmlSha256':hashlib.sha256(mhtml.encode('utf-8')).hexdigest(),
            'visualFidelityVerified':False
        }
        (state / 'manifest.json').write_text(json.dumps(report, indent=2)+'\n')
        return report
    finally:
        cdp.detach()


class SilentServer(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def run(name, mode, embedded=False):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', name):
        raise ValueError('output.invalid-run-name')
    EVIDENCE.mkdir(exist_ok=True)
    if EVIDENCE.is_symlink():
        raise ValueError('output.symlinked-evidence-root')
    output = EVIDENCE / name
    output.mkdir(mode=0o700, exist_ok=False)
    server = ThreadingHTTPServer(
        ('127.0.0.1', 0), partial(SilentServer, directory=str(FIXTURE)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as p:
            # Auxiliary controlled experiment, NOT the RumiAI web-control provider.
            executable = (shutil.which('chromium') or
                          shutil.which('chromium-browser') or
                          p.chromium.executable_path)
            browser = p.chromium.launch(headless=(mode == 'scripted'),
                executable_path=executable)
            try:
                context = browser.new_context(viewport={'width':1024,'height':768})
                page = context.new_page()
                url = f'http://127.0.0.1:{server.server_port}/index.html'
                if embedded:
                    # Explicitly degraded auxiliary-host mode when URL navigation
                    # is blocked: no external asset fidelity conclusions permitted.
                    markup = (FIXTURE / 'index.html').read_text()
                    markup = markup.replace('<link rel="stylesheet" href="style.css">',
                        '<style>'+(FIXTURE / 'style.css').read_text()+'</style>')
                    markup = markup.replace('<script src="fixture.js"></script>',
                        '<script>'+(FIXTURE / 'fixture.js').read_text()+'</script>')
                    markup = markup.replace('<img src="mark.svg"',
                        '<img src="data:image/svg+xml,none"')
                    page.set_content(markup, wait_until='load')
                else:
                    page.goto(url, wait_until='load')

                events = [{'container':'#scrollbox','top':0,'trusted':True,'at':0}]
                page.expose_binding('__observe', lambda _, event: events.append(event))
                page.evaluate(OBSERVE)
                initial = geometry(page)
                if mode == 'scripted':
                    wheel_until(page, 'down')
                    wheel_until(page, 'up')
                else:
                    print('Scorri manualmente fino in fondo e poi all’inizio. Premi Invio quando hai finito.')
                    input()
                page.wait_for_timeout(300)
                phases = infer_phases(events)
                (output / 'demonstration.json').write_text(json.dumps({
                    'mode':mode, 'embeddedFixture':embedded, 'start':initial,
                    'events':events, 'inferredPhases':phases
                }, indent=2)+'\n')
                if [x['direction'] for x in phases] != ['down','up']:
                    raise RuntimeError('observation.not-bottom-then-top:'+str(phases))

                replay = context.new_page()
                try:
                    if embedded:
                        replay.set_content(markup, wait_until='load')
                    else:
                        replay.goto(url, wait_until='load')
                    states = {'start':capture_state(replay,output,'00-start')}
                    for index, phase in enumerate(phases, 1):
                        reached = wheel_until(replay, phase['direction'])
                        label = f'{index:02d}-{phase["direction"]}'
                        states[label] = capture_state(replay,output,label)
                        if phase['direction'] == 'down' and reached['shown'] != 24:
                            raise RuntimeError('replay.lazy-elements-missing')
                    report = {
                        'source':'controlled Chromium fixture',
                        'embeddedFixture':embedded,
                        'inferredDirections':[x['direction'] for x in phases],
                        'observedStartAtTop':initial['top'] == 0,
                        'replayFinishedAtTop':reached['top'] <= 2,
                        'states':states,
                        'nativeCssIncluded':(states['start']['mhtmlContainsExternalCss']
                            if not embedded else None),
                        'visualFidelityVerified':False,
                        'completeSavePageHtmlTested':False,
                        'notice':'MHTML stored unchanged; no HTML/CSS rewriting or external output paths.'
                    }
                    (output / 'report.json').write_text(json.dumps(report,indent=2)+'\n')
                    return report
                finally:
                    replay.close()
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True, help='new folder under PoC/evidence')
    parser.add_argument('--mode', choices=['scripted','manual'], default='scripted')
    parser.add_argument('--embedded-host-test', action='store_true',
        help='restricted auxiliary hosts only; external CSS validation skipped')
    options = parser.parse_args()
    try:
        result = run(options.run,options.mode,options.embedded_host_test)
    except Exception as error:
        print('experiment.failed',type(error).__name__,str(error)[:400])
        raise SystemExit(1)
    print(json.dumps({key:result[key] for key in (
        'inferredDirections','replayFinishedAtTop',
        'nativeCssIncluded','completeSavePageHtmlTested')},indent=2))


if __name__ == '__main__':
    main()
