import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const exporter = fileURLToPath(new URL("../export.mjs", import.meta.url));
const share = "https://chatgpt.com/share/12345678-1234-1234-1234-123456789012";

const providerSimulator = String.raw`#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const kind = args.slice(0, 2).join(" ");
const windows = process.env.SHARE_WINDOWS_JSON
  ? JSON.parse(process.env.SHARE_WINDOWS_JSON) : null;
const offsetFile = process.env.SHARE_SCROLL_FILE;
const initialState = windows ? JSON.parse(await fs.readFile(offsetFile, "utf8")
  .catch(() => JSON.stringify({ offset: windows.length - 1, topProbes: 0, unlocked: false })))
  : { offset: 0, topProbes: 0, unlocked: true };
let state = initialState;
let offset = state.offset;
const minimum = () => process.env.SHARE_LAZY_TOP === "1" && !state.unlocked ? 2 : 0;
async function saveState()
{
  state.offset = offset;
  await fs.writeFile(offsetFile, JSON.stringify(state));
}
let html = windows ? windows[offset] : await fs.readFile(process.env.SHARE_HTML_FILE, "utf8");
let result;

if (args[0] === "status") result = { browserRunning: true };
else if (kind === "page new") result = { id: "simulated-page" };
else if (kind === "page navigate") result = { url: args[3] };
else if (kind === "page inspect") result = { html };
else if (kind === "debug cdp")
{
  const params = JSON.parse(args[4]);
  if (args[3] === "Input.dispatchMouseEvent")
  {
    const delta = Number(params.deltaY);
    if (windows)
    {
      // The client may report a top edge of the currently loaded segment.
      // Multiple wheel attempts at that edge are required to mount the prior
      // segment and enlarge the scrollable region.
      if (delta < 0 && offset === minimum() && process.env.SHARE_LAZY_TOP === "1"
        && !state.unlocked)
      {
        state.topProbes += 1;
        if (state.topProbes >= 6) state.unlocked = true;
      }
      offset = Math.max(minimum(), Math.min(windows.length - 1,
        offset + Math.sign(delta)));
      await saveState();
    }
    result = {};
  }
  else if (args[3] === "Runtime.evaluate")
  {
    result = {
      result: {
        type: "object",
        value: {
          source: windows ? "nested-element" : "document",
          scrollY: windows ? (offset - minimum()) * 450 : 0,
          documentHeight: windows ? (windows.length - minimum()) * 450 : 600,
          viewportHeight: windows ? 450 : 900,
          atTop: !windows || offset === minimum(),
          atBottom: !windows || offset === windows.length - 1,
          x: 400,
          y: 300
        }
      }
    };
  }
  else throw new Error("unexpected CDP method: " + args[3]);
}
else if (kind === "page scroll")
{
  if (windows)
  {
    offset = Math.max(0, Math.min(windows.length - 1,
      offset + Math.sign(Number(args[3]))));
    await saveState();
  }
  result = { scrollY: offset * 600, documentHeight: windows?.length * 600 || 600,
    viewportHeight: 600, atBottom: !windows || offset === windows.length - 1 };
}
else if (kind === "page capture")
{
  const output = args[3];
  await fs.mkdir(output, { recursive: true });
  const htmlFile = path.join(output, "page.html");
  const textFile = path.join(output, "page.txt");
  await fs.writeFile(htmlFile, html);
  await fs.writeFile(textFile, "fixture text\n");
  result = { files: { html: htmlFile, text: textFile } };
}
else if (kind === "page close") result = { closed: true };
else throw new Error("unhandled simulated command " + JSON.stringify(args));
process.stdout.write(JSON.stringify(result) + "\n");
`;

async function fixtureRun(html, run, options = {})
{
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-shared-export-poc-"));
  const htmlPath = path.join(root, "shared.html");
  const command = path.join(root, "web-control-fixture.mjs");
  await fs.writeFile(htmlPath, Array.isArray(html) ? html.at(-1) : html);
  await fs.writeFile(command, providerSimulator, { mode: 0o700 });
  try
  {
    await run({
      directory: path.join(root, "exports"),
      env: {
        ...process.env,
        WEB_CONTROL_CMD: command,
        SHARE_HTML_FILE: htmlPath,
        SHARE_WINDOWS_JSON: Array.isArray(html) ? JSON.stringify(html) : "",
        SHARE_SCROLL_FILE: path.join(root, "scroll-state"),
        SHARE_LAZY_TOP: options.lazyTop ? "1" : ""
      }
    });
  }
  finally
  {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("export command writes new revisions without overwriting prior snapshots", async () =>
{
  const html = '<html><title>Shared</title><body>'
    + '<section data-message-author-role="user"><div class="whitespace-pre-wrap">Question</div></section>'
    + '<section data-message-author-role="assistant"><div class="markdown"><p>Answer</p></div></section>'
    + "</body></html>";

  await fixtureRun(html, async ({ directory, env }) =>
  {
    const first = JSON.parse((await execFileAsync(process.execPath,
      [exporter, share, directory], { env })).stdout);
    assert.equal(first.revision, "0001");
    assert.equal(first.messageCount, 2);
    const styled = await fs.readFile(path.join(directory, "0001", "conversation.html"), "utf8");
    assert.match(styled, /<style>/);
    assert.match(styled, /Answer/);
    const markdown = await fs.readFile(path.join(directory, "0001", "conversation.md"), "utf8");
    assert.match(markdown, /Answer/);
    const original = await fs.readFile(path.join(directory, "0001", "capture", "page.html"), "utf8");
    assert.equal(original, html);

    const second = JSON.parse((await execFileAsync(process.execPath,
      [exporter, share, directory], { env })).stdout);
    assert.equal(second.revision, "0002");
    const json = JSON.parse(await fs.readFile(
      path.join(directory, "0002", "conversation.json"), "utf8"));
    assert.equal(json.messages.length, 2);
    assert.equal(json.completeness,
      "scanned-rendered-windows-only; source-chat completeness not verifiable");
    assert.equal(await fs.readFile(path.join(directory, "0001", "conversation.md"), "utf8"), markdown);
  });
});

test("failed extraction retains rendered page evidence", async () =>
{
  await fixtureRun("<html><body>restricted share</body></html>", async ({ directory, env }) =>
  {
    await assert.rejects(execFileAsync(process.execPath, [exporter, share, directory], { env }));
    const saved = await fs.readFile(path.join(directory, "0001", "capture", "page.html"), "utf8");
    assert.match(saved, /restricted share/);
    const failure = JSON.parse(await fs.readFile(
      path.join(directory, "0001", "failure.json"), "utf8"));
    assert.equal(failure.diagnostic, "share-dom-unrecognized");
    await fs.access(path.join(directory, "0001", "error.txt"));
  });
});

test("invalid share URL fails without creating archive", async () =>
{
  await fixtureRun("<html></html>", async ({ directory, env }) =>
  {
    await assert.rejects(execFileAsync(process.execPath,
      [exporter, "https://example.org/share/invalid", directory], { env }));
    await assert.rejects(fs.access(directory));
  });
});

test("real CLI assembles virtualized windows and preserves evicted image references", async () =>
{
  const render = (numbers) => '<html><title>Virtualized</title><body>'
    + numbers.map((i) => '<div data-testid="conversation-turn-' + i + '">'
      + '<article data-message-id="msg-' + i + '" data-message-author-role="'
      + (i % 2 ? "assistant" : "user") + '"><div class="markdown"><p>Turn ' + i + '</p>'
      + (i === 1 ? '<img alt="diagram" src="blob:only-in-browser">' : '')
      + '</div></article></div>').join("") + "</body></html>";
  const windows =
  [
    render([0, 1, 2]),
    render([2, 3, 4]),
    render([4, 5, 6]),
    render([6, 7, 8, 9])
  ];

  await fixtureRun(windows, async ({ directory, env }) =>
  {
    const result = JSON.parse((await execFileAsync(process.execPath,
      [exporter, share, directory], { env })).stdout);
    assert.equal(result.messageCount, 10);
    assert.equal(result.observedSettledAtBottom, true);
    assert.equal(result.observedSettledAtTop, true);
    assert.equal(result.observationComplete, false);
    assert.equal(result.scrollSource, "nested-element");
    assert.ok(result.observedSegmentCaptures >= 4);
    const data = JSON.parse(await fs.readFile(
      path.join(directory, "0001", "conversation.json"), "utf8"));
    assert.deepEqual(data.messages.map((message) => message.turnIndex),
      Array.from({ length: 10 }, (_, i) => i));
    assert.equal(data.messages[1].missingImages.length, 1);
    assert.equal(result.imagesUnavailable, 1);
    const markdown = await fs.readFile(path.join(directory, "0001", "conversation.md"), "utf8");
    assert.ok(markdown.indexOf("Turn 0") < markdown.indexOf("Turn 9"));
    const captured = await fs.readdir(path.join(directory, "0001", "capture", "segments"));
    assert.ok(captured.length >= 4);
  });
});

test("CLI waits at a false top boundary until an earlier segment mounts", async () =>
{
  const render = (numbers) => '<html><head><title>Segments</title></head><body>'
    + numbers.map((i) => '<div data-testid="conversation-turn-' + i + '">'
      + '<article data-message-id="msg-' + i + '" data-message-author-role="user">'
      + '<div class="whitespace-pre-wrap">Turn ' + i
      + '</div></article></div>').join("") + "</body></html>";
  const windows = [
    render([0, 1, 2]), render([2, 3, 4]),
    render([4, 5, 6]), render([6, 7, 8, 9])
  ];
  await fixtureRun(windows, async ({ directory, env }) =>
  {
    const result = JSON.parse((await execFileAsync(process.execPath,
      [exporter, share, directory], { env, timeout: 240000 })).stdout);
    assert.equal(result.messageCount, 10);
    assert.equal(result.observedSettledAtTop, true);
    assert.equal(result.observationComplete, false);
    assert.ok(result.observedBoundaryExtensions > 0);
    const state = JSON.parse(await fs.readFile(env.SHARE_SCROLL_FILE, "utf8"));
    assert.equal(state.unlocked, true);
    const data = JSON.parse(await fs.readFile(
      path.join(directory, "0001", "conversation.json"), "utf8"));
    assert.deepEqual(data.messages.map((message) => message.turnIndex),
      Array.from({ length: 10 }, (_, i) => i));
  }, { lazyTop: true });
});
