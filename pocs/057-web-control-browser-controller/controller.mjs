import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

function parseArgs(argv) {
  const out = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq >= 0) {
      out.set(arg.slice(2, eq), arg.slice(eq + 1));
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out.set(key, next);
      i += 1;
    } else {
      out.set(key, 'true');
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const socketPath = args.get('socket') || process.env.WEB_CONTROL_SOCKET || path.join(os.tmpdir(), 'rumiai-web-control-poc.sock');
const profileDir = args.get('profile') || process.env.WEB_CONTROL_PROFILE || path.join(os.tmpdir(), 'rumiai-web-control-poc-profile');
const headless = args.has('headless') ? args.get('headless') !== 'false' : process.env.HEADLESS === '1';
const executablePath = args.get('executable') || process.env.BROWSER_EXECUTABLE || undefined;
const browserArgs = process.env.WEB_CONTROL_BROWSER_ARGS ? JSON.parse(process.env.WEB_CONTROL_BROWSER_ARGS) : [];

await fs.mkdir(profileDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
  headless,
  executablePath,
  acceptDownloads: true,
  viewport: { width: 1440, height: 1000 },
  args: browserArgs
});

let nextPageId = 1;
const pages = new Map();
const pageIds = new WeakMap();

function registerPage(page) {
  let id = pageIds.get(page);
  if (id) return id;
  id = `page-${nextPageId++}`;
  pages.set(id, page);
  pageIds.set(page, id);
  page.once('close', () => pages.delete(id));
  return id;
}

for (const page of context.pages()) registerPage(page);
context.on('page', registerPage);

function getPage(id) {
  const page = pages.get(id);
  if (!page) throw new Error(`unknown page: ${id}`);
  return page;
}

async function pageDescriptor(id, page) {
  return {
    id,
    url: page.url(),
    title: await page.title().catch(() => '')
  };
}

async function inspectStorage(page) {
  const cookies = await context.cookies();
  const storage = await page.evaluate(() => {
    const local = {};
    const session = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      local[key] = localStorage.getItem(key);
    }
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      session[key] = sessionStorage.getItem(key);
    }
    return { local, session };
  });
  return { cookies, ...storage };
}

async function capturePage(pageId, page, params) {
  const outputDir = path.resolve(params.outputDir || path.join(process.cwd(), 'artifacts', pageId));
  const formats = params.formats || ['html', 'text', 'screenshot', 'mhtml'];
  await fs.mkdir(outputDir, { recursive: true });
  const files = {};

  if (formats.includes('html')) {
    const filename = path.join(outputDir, 'page.html');
    await fs.writeFile(filename, await page.content(), 'utf8');
    files.html = filename;
  }

  if (formats.includes('text')) {
    const filename = path.join(outputDir, 'page.txt');
    const text = await page.locator('body').innerText().catch(() => '');
    await fs.writeFile(filename, `${text}\n`, 'utf8');
    files.text = filename;
  }

  if (formats.includes('screenshot')) {
    const filename = path.join(outputDir, 'page.png');
    await page.screenshot({ path: filename, fullPage: true });
    files.screenshot = filename;
  }

  if (formats.includes('mhtml')) {
    const filename = path.join(outputDir, 'page.mhtml');
    const cdp = await context.newCDPSession(page);
    try {
      const snapshot = await cdp.send('Page.captureSnapshot', { format: 'mhtml' });
      await fs.writeFile(filename, snapshot.data, 'utf8');
      files.mhtml = filename;
    } finally {
      await cdp.detach();
    }
  }

  const metadata = {
    page: pageId,
    url: page.url(),
    title: await page.title().catch(() => ''),
    capturedAt: new Date().toISOString(),
    files
  };
  const metadataFile = path.join(outputDir, 'metadata.json');
  await fs.writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  files.metadata = metadataFile;
  return { ...metadata, files };
}

async function dispatch(method, params = {}) {
  switch (method) {
    case 'status':
      return {
        socketPath,
        profileDir,
        headless,
        pages: await Promise.all([...pages].map(([id, page]) => pageDescriptor(id, page)))
      };

    case 'page.new': {
      const page = await context.newPage();
      return pageDescriptor(registerPage(page), page);
    }

    case 'page.list':
      return Promise.all([...pages].map(([id, page]) => pageDescriptor(id, page)));

    case 'page.close': {
      const page = getPage(params.page);
      await page.close();
      return { page: params.page, closed: true };
    }

    case 'page.navigate': {
      const page = getPage(params.page);
      const response = await page.goto(params.url, {
        waitUntil: params.waitUntil || 'domcontentloaded',
        timeout: params.timeout ?? 30000
      });
      if (params.waitMs) await page.waitForTimeout(params.waitMs);
      return {
        page: params.page,
        url: page.url(),
        title: await page.title().catch(() => ''),
        status: response?.status() ?? null,
        statusText: response?.statusText() ?? null
      };
    }

    case 'page.inspect': {
      const page = getPage(params.page);
      switch (params.kind || 'summary') {
        case 'summary':
          return pageDescriptor(params.page, page);
        case 'html':
          return { page: params.page, html: await page.content() };
        case 'text':
          return { page: params.page, text: await page.locator('body').innerText().catch(() => '') };
        case 'storage':
          return { page: params.page, ...(await inspectStorage(page)) };
        default:
          throw new Error(`unsupported inspect kind: ${params.kind}`);
      }
    }

    case 'page.capture':
      return capturePage(params.page, getPage(params.page), params);

    case 'page.click': {
      const page = getPage(params.page);
      await page.locator(params.selector).click({ timeout: params.timeout ?? 10000 });
      return { page: params.page, selector: params.selector };
    }

    case 'page.fill': {
      const page = getPage(params.page);
      await page.locator(params.selector).fill(params.value ?? '', { timeout: params.timeout ?? 10000 });
      return { page: params.page, selector: params.selector };
    }

    case 'page.press': {
      const page = getPage(params.page);
      await page.locator(params.selector).press(params.key, { timeout: params.timeout ?? 10000 });
      return { page: params.page, selector: params.selector, key: params.key };
    }

    case 'debug.cdp': {
      const page = getPage(params.page);
      if (typeof params.method !== 'string' || !params.method) throw new Error('debug.cdp requires method');
      const cdp = await context.newCDPSession(page);
      try {
        return await cdp.send(params.method, params.params || {});
      } finally {
        await cdp.detach();
      }
    }

    case 'shutdown':
      return { stopping: true };

    default:
      throw new Error(`unknown method: ${method}`);
  }
}

async function removeSocket() {
  try {
    const stat = await fs.lstat(socketPath);
    if (!stat.isSocket()) throw new Error(`refusing to remove non-socket path: ${socketPath}`);
    await fs.unlink(socketPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

await fs.mkdir(path.dirname(socketPath), { recursive: true });
await removeSocket();

const server = net.createServer((socket) => {
  socket.setEncoding('utf8');
  let buffer = '';

  socket.on('data', async (chunk) => {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;

      let request;
      try {
        request = JSON.parse(line);
        const result = await dispatch(request.method, request.params);
        const payload = `${JSON.stringify({ id: request.id ?? null, ok: true, result })}\n`;
        socket.write(payload, () => {
          if (request.method === 'shutdown') setImmediate(() => gracefulShutdown(0));
        });
      } catch (error) {
        socket.write(`${JSON.stringify({
          id: request?.id ?? null,
          ok: false,
          error: { message: String(error?.message || error) }
        })}\n`);
      }
    }
  });
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(socketPath, resolve);
});
await fs.chmod(socketPath, 0o600);

console.log(JSON.stringify({ event: 'ready', socketPath, profileDir, headless }));

let stopping = false;
async function gracefulShutdown(exitCode) {
  if (stopping) return;
  stopping = true;
  server.close();
  await context.close().catch(() => {});
  await removeSocket().catch(() => {});
  process.exit(exitCode);
}

process.on('SIGINT', () => gracefulShutdown(0));
process.on('SIGTERM', () => gracefulShutdown(0));
