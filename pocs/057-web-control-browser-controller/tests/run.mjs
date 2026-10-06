import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createFixtureServer } from './fixture-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rumiai-web-control-poc-'));
const profileDir = path.join(workDir, 'profile');
const socketPath = path.join(workDir, 'controller.sock');
const captureDir = path.join(workDir, 'capture');
const fixture = await createFixtureServer();

class Client {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => this.onData(chunk));
  }

  onData(chunk) {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error?.message || 'request failed'));
    }
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  close() {
    this.socket.end();
  }
}

async function waitForSocket(filename, child) {
  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode !== null) throw new Error(`controller exited early with ${child.exitCode}`);
    try {
      const stat = await fs.stat(filename);
      if (stat.isSocket()) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`controller socket not ready: ${filename}`);
}

async function connect(filename) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(filename);
    socket.once('connect', () => resolve(new Client(socket)));
    socket.once('error', reject);
  });
}

async function startController() {
  const env = {
    ...process.env,
    HEADLESS: '1',
    WEB_CONTROL_SOCKET: socketPath,
    WEB_CONTROL_PROFILE: profileDir
  };
  const child = spawn(process.execPath, [path.join(root, 'controller.mjs')], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('exit', (code) => {
    if (code && stderr) process.stderr.write(stderr);
  });
  await waitForSocket(socketPath, child);
  const client = await connect(socketPath);
  return { child, client };
}

async function stopController(controller) {
  try {
    await controller.client.request('shutdown');
  } finally {
    controller.client.close();
  }
  await new Promise((resolve, reject) => {
    controller.child.once('exit', resolve);
    controller.child.once('error', reject);
  });
}

let first;
let second;
try {
  first = await startController();

  const page = await first.client.request('page.new');
  const pageId = page.id;
  await first.client.request('page.navigate', {
    page: pageId,
    url: fixture.baseUrl,
    waitMs: 300
  });

  const dynamicText = await first.client.request('page.inspect', { page: pageId, kind: 'text' });
  assert.match(dynamicText.text, /dynamic-ready/);

  await first.client.request('page.fill', { page: pageId, selector: '#name', value: 'rumiai' });
  const filledText = await first.client.request('page.inspect', { page: pageId, kind: 'text' });
  assert.match(filledText.text, /rumiai/);

  const beforePopup = await first.client.request('page.list');
  await first.client.request('page.click', { page: pageId, selector: '#popup-button' });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const afterPopup = await first.client.request('page.list');
  assert.equal(afterPopup.length, beforePopup.length + 1);
  assert.ok(afterPopup.some((item) => item.url.endsWith('/popup')));

  const capture = await first.client.request('page.capture', {
    page: pageId,
    outputDir: captureDir,
    formats: ['html', 'text', 'screenshot', 'mhtml']
  });
  for (const filename of Object.values(capture.files)) {
    const stat = await fs.stat(filename);
    assert.ok(stat.size > 0, `expected non-empty capture file: ${filename}`);
  }
  assert.match(await fs.readFile(capture.files.html, 'utf8'), /dynamic-ready/);
  assert.match(await fs.readFile(capture.files.mhtml, 'utf8'), /multipart\/related/i);

  const cdp = await first.client.request('debug.cdp', {
    page: pageId,
    method: 'Runtime.evaluate',
    params: {
      expression: "document.querySelector('#dynamic').textContent",
      returnByValue: true
    }
  });
  assert.equal(cdp.result.value, 'dynamic-ready');

  await first.client.request('page.navigate', { page: pageId, url: `${fixture.baseUrl}/login` });
  await first.client.request('page.click', { page: pageId, selector: '#login' });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const loggedIn = await first.client.request('page.inspect', { page: pageId, kind: 'text' });
  assert.match(loggedIn.text, /cookie=active storage=active/);

  await stopController(first);
  first = null;

  second = await startController();
  const page2 = await second.client.request('page.new');
  await second.client.request('page.navigate', { page: page2.id, url: `${fixture.baseUrl}/account` });
  const persisted = await second.client.request('page.inspect', { page: page2.id, kind: 'text' });
  assert.match(persisted.text, /cookie=active storage=active/);

  const storage = await second.client.request('page.inspect', { page: page2.id, kind: 'storage' });
  assert.equal(storage.local.poc_session, 'active');
  assert.ok(storage.cookies.some((cookie) => cookie.name === 'poc_session' && cookie.value === 'active'));

  await stopController(second);
  second = null;

  console.log(JSON.stringify({
    ok: true,
    workDir,
    checks: [
      'dynamic DOM after fetch',
      'deterministic fill/click',
      'popup page registration',
      'HTML/text/PNG/MHTML capture',
      'raw CDP Runtime.evaluate through controller',
      'cookie/localStorage persistence across controller restart'
    ]
  }, null, 2));
} finally {
  if (first) first.child.kill('SIGTERM');
  if (second) second.child.kill('SIGTERM');
  await fixture.close();
}
