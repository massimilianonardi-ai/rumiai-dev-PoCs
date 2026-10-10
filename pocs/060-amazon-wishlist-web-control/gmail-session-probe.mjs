import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const command = process.env.WEB_CONTROL_CMD || 'web-control';
async function call(...args) {
  const { stdout } = await run(command, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
  return JSON.parse(stdout);
}
const page = await call('page', 'new');
try {
  const navigation = await call('page', 'navigate', page.id, 'https://mail.google.com/mail/u/0/#inbox');
  const result = await call('debug', 'cdp', page.id, 'Runtime.evaluate', JSON.stringify({
    expression: `(() => ({
      origin: location.origin,
      path: location.pathname,
      title: document.title,
      composeCandidates: [...document.querySelectorAll('[role="button"]')]
        .filter(el => /^(compose|scrivi)$/i.test((el.getAttribute('aria-label') || el.textContent || '').trim()))
        .length,
      hasMailbox: Boolean(document.querySelector('[role="main"], [gh="tl"]')),
      loginRedirect: /accounts\\.google\\.com/.test(location.hostname)
    }))()`,
    returnByValue: true
  }));
  const value = result?.result?.value;
  const authenticated = value?.origin === 'https://mail.google.com' &&
    value?.hasMailbox === true && !value?.loginRedirect;
  process.stdout.write(JSON.stringify({
    authenticated,
    pageId: page.id,
    navigationStatus: navigation.status ?? null,
    ...value
  }, null, 2) + '\n');
  if (!authenticated) process.exitCode = 2;
} catch (error) {
  process.stderr.write('Gmail probe failed: ' + error.message + '\n');
  process.exitCode = 1;
}
// Intentionally keep the browser page open for manual inspection.
// This probe does not compose, send, or read any messages.
