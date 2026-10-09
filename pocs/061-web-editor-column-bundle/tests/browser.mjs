import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.goto(pathToFileURL(resolve('demo/index.html')).href);
  await page.waitForFunction(() => Boolean(window.columnEditor));
  const initial = await page.evaluate(() => window.columnEditor.getValue());

  // Test an actual pointer-driven rectangle with normal drag in column mode.
  await page.getByRole('button', { name: 'Enable column mode' }).click();
  const rows = page.locator('.cm-line');
  assert.ok(await rows.count() >= 3, 'document has three visible lines');
  const first = await rows.nth(0).boundingBox();
  const third = await rows.nth(2).boundingBox();
  assert.ok(first && third, 'browser must render the editor');
  await page.mouse.move(first.x + 18, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(third.x + 60, third.y + third.height / 2, { steps: 12 });
  await page.mouse.up();
  const selected = await page.evaluate(() => window.columnEditor.getSelections());
  assert.ok(selected.length >= 2, 'column drag must create multiple selection ranges');

  await page.keyboard.type('Z');
  const edited = await page.evaluate(() => window.columnEditor.getValue());
  assert.notEqual(edited, initial, 'typing must modify rectangular selection');
  await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(() => window.columnEditor.getValue()), initial, 'undo restores column edit');

  // The same library must support independent embedded instances.
  const other = await page.evaluate(() => {
    const node = document.createElement('div');
    node.style.height = '100px';
    document.body.appendChild(node);
    const instance = EditorPoC.createEditor(node, { value: 'independent' });
    const value = instance.getValue();
    instance.destroy();
    return value;
  });
  assert.equal(other, 'independent');
  console.log('PASS: local-file browser load, rectangular editing, undo, independent instances');
} finally {
  await browser.close();
}
