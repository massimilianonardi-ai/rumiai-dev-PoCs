import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extractConversation, markdownDocument, relinkImages, prependOlderMessages } from "./extract.mjs";
import { renderConversationHtml } from "./render-html.mjs";

const execFileAsync = promisify(execFile);
const WEB_CONTROL = process.env.WEB_CONTROL_CMD || "web-control";
const MAX_BUFFER = 64 * 1024 * 1024;
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;

function _shareUrl(input)
{
  let url;
  try
  {
    url = new URL(input);
  }
  catch
  {
    throw new Error("export.invalid-share-url: expected a full ChatGPT shared conversation link");
  }
  if (url.protocol !== "https:" || url.hostname !== "chatgpt.com"
      || !/^\/share\/[a-zA-Z0-9-]+\/?$/.test(url.pathname)
      || url.username || url.password)
  {
    throw new Error("export.invalid-share-url: only https://chatgpt.com/share/<id> is accepted");
  }
  url.hash = "";
  return url.href;
}

async function _control(...arguments_)
{
  let stdout;
  try
  {
    const result = await execFileAsync(WEB_CONTROL, arguments_, {
      timeout: 60000,
      maxBuffer: MAX_BUFFER
    });
    stdout = result.stdout;
  }
  catch (error)
  {
    throw new Error("export.web-control-command-failed: "
      + arguments_.slice(0, 3).join(" ") + ": " + String(error.stderr || error.message));
  }
  try
  {
    return JSON.parse(stdout);
  }
  catch
  {
    throw new Error("export.web-control-invalid-response: command returned non-JSON output");
  }
}

async function _ensureController()
{
  try
  {
    await _control("status");
    return;
  }
  catch (original)
  {
    try
    {
      await execFileAsync("srv", ["start", "web-control"], { timeout: 60000 });
      await _control("status");
    }
    catch
    {
      throw original;
    }
  }
}

async function _newVersion(directory)
{
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const names = await fs.readdir(directory);
  let next = 1 + Math.max(0, ...names.filter((name) => /^\d{4,}$/.test(name)).map(Number));

  while (true)
  {
    const name = String(next).padStart(4, "0");
    const versionDir = path.join(directory, name);
    try
    {
      await fs.mkdir(versionDir, { mode: 0o700 });
      return { name, versionDir };
    }
    catch (error)
    {
      if (error.code !== "EEXIST") throw error;
      next += 1;
    }
  }
}

function _trustedAssetUrl(input)
{
  let url;
  try
  {
    url = new URL(input);
  }
  catch
  {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;

  const host = url.hostname.toLowerCase();
  return host === "chatgpt.com"
    || host.endsWith(".oaiusercontent.com")
    || host === "oaiusercontent.com"
    || host.endsWith(".oaistatic.com")
    || host === "oaistatic.com"
    || host === "oaidalleapiprodscus.blob.core.windows.net";
}

function _extension(contentType)
{
  const type = contentType?.split(";")[0].trim().toLowerCase();
  return {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "image/avif": "avif"
  }[type] || null;
}

async function _images(imageUrls, versionDir)
{
  const records = imageUrls.map((url, index) =>
    ({ index: index + 1, url, status: "unavailable" }));
  const available = new Map();
  const assetDir = path.join(versionDir, "assets");
  let next = 0;

  async function worker()
  {
    while (next < imageUrls.length)
    {
      const index = next++;
      const url = imageUrls[index];
      const item = records[index];

    if (!_trustedAssetUrl(url))
    {
      item.reason = "source-origin-not-allowed";
      continue;
    }

    try
    {
      const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(7000)
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const ext = _extension(response.headers.get("content-type"));
      if (!ext) throw new Error("unsupported-image-media-type");
      if (Number(response.headers.get("content-length")) > IMAGE_MAX_BYTES)
      {
        throw new Error("image-too-large");
      }

      const parts = [];
      const reader = response.body.getReader();
      let length = 0;
      while (true)
      {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > IMAGE_MAX_BYTES)
        {
          await reader.cancel();
          throw new Error("image-too-large");
        }
        parts.push(Buffer.from(value));
      }
      const bytes = Buffer.concat(parts, length);
      await fs.mkdir(assetDir, { recursive: true, mode: 0o700 });
      const filename = "image-" + String(index + 1).padStart(4, "0") + "." + ext;
      await fs.writeFile(path.join(assetDir, filename), bytes, { mode: 0o600 });
      item.status = "downloaded";
      item.path = "assets/" + filename;
      available.set(url, item.path);
    }
    catch (error)
    {
      // Deliberately avoid logging asset URLs: they can contain signed tokens.
      item.reason = String(error.message || error);
    }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, imageUrls.length) }, () => worker()));
  return { records, available };
}

async function _sleep(milliseconds)
{
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function _observe(page, sharedUrl, versionDir)
{
  const segmentDirectory = path.join(versionDir, "capture", "segments");
  await fs.mkdir(segmentDirectory, { recursive: true, mode: 0o700 });

  const pollDelay = 250;
  let conversation = null;
  let segments = 0;
  let uncertain = false;
  let previousHtml = "";

  function parseWindow(html)
  {
    try
    {
      return extractConversation(html, sharedUrl);
    }
    catch (error)
    {
      if (!["share-dom-unrecognized", "share-dom-empty"].includes(error.code)) throw error;
      return null;
    }
  }

  async function readWindow()
  {
    const html = (await _control("page", "inspect", page, "html")).html;
    return { html, parsed: parseWindow(html) };
  }

  async function preserve(html)
  {
    if (html === previousHtml) return;
    previousHtml = html;
    segments += 1;
    await fs.writeFile(path.join(segmentDirectory,
      String(segments).padStart(5, "0") + ".html"), html, { mode: 0o600 });
  }

  // Navigation can resolve before the application mounts the first turn.
  for (let probe = 0; probe < 16; probe += 1)
  {
    const current = await readWindow();
    if (current.parsed)
    {
      conversation = current.parsed;
      await preserve(current.html);
      break;
    }
    await _sleep(pollDelay);
  }
  if (!conversation)
  {
    return {
      conversation: { title: "ChatGPT shared conversation", messages: [], imageUrls: [] },
      extractionMethod: "dom-prefix",
      observedSegmentCaptures: 0,
      observedBoundaryExtensions: 0,
      observationComplete: false,
      uncertain: true
    };
  }

  // The current page often opens at the END of the chat. Ask the browser to
  // jump to the top of the current loaded segment, wait for the DOM to prepend
  // older turns, keep only the newly observed prefix, then repeat.
  let expansions = 0;
  let exhausted = false;
  for (let step = 0; step < 120; step += 1)
  {
    const head = conversation.messages[0];
    const target = Number.isSafeInteger(head.turnIndex)
      ? '[data-testid="conversation-turn-' + head.turnIndex + '"]'
      : head.messageId && /^[A-Za-z0-9_-]+$/.test(head.messageId)
        ? '[data-message-id="' + head.messageId + '"]' : "body";
    let changed = false;

    for (const key of ["Home", "PageUp"])
    {
      try
      {
        await _control("page", "press", page, target, key);
      }
      catch (error)
      {
        if (target === "body") throw error;
        await _control("page", "press", page, "body", key);
      }

      // Test for a NEW PREFIX, not arbitrary React DOM churn or full-page
      // changes; cosmetic updates must never duplicate the conversation.
      for (let attempt = 0; attempt < 7; attempt += 1)
      {
        const current = await readWindow();
        if (current.parsed)
        {
          const merged = prependOlderMessages(conversation.messages, current.parsed.messages);
          if (merged.added > 0)
          {
            conversation.messages = merged.messages;
            conversation.title = current.parsed.title || conversation.title;
            uncertain ||= merged.uncertain;
            await preserve(current.html);
            expansions += 1;
            changed = true;
            break;
          }
          uncertain ||= merged.uncertain;
        }
        await _sleep(pollDelay);
      }
      if (changed) break;
    }

    if (!changed)
    {
      exhausted = true;
      break;
    }
  }

  for (const [index, message] of conversation.messages.entries()) message.index = index + 1;
  conversation.imageUrls = [...new Set(
    conversation.messages.flatMap((message) => message.imageUrls)
  )];
  return {
    conversation,
    extractionMethod: "dom-prefix",
    observedSegmentCaptures: segments,
    observedBoundaryExtensions: expansions,
    observationComplete: false,
    observedNoEarlierPrefix: exhausted,
    uncertain
  };
}

async function exportLink(rawUrl, destination)
{
  const sharedUrl = _shareUrl(rawUrl);
  const { name, versionDir } = await _newVersion(path.resolve(destination));
  const capturedAt = new Date().toISOString();
  let page = null;

  try
  {
    await _ensureController();
    const created = await _control("page", "new");
    page = created.id;
    if (!page) throw new Error("export.page-create-failed: missing page ID");

    const navigation = await _control("page", "navigate", page, sharedUrl);
    if (!navigation.url || !navigation.url.startsWith("https://chatgpt.com/share/"))
    {
      throw new Error("export.navigation-outside-share: final page is not a ChatGPT conversation share");
    }

    const observed = await _observe(page, sharedUrl, versionDir);
    const captureDirectory = path.join(versionDir, "capture");
    await _control("page", "capture", page, captureDirectory, "html", "text");

    const conversation = observed.conversation;
    if (!conversation.messages.length)
    {
      const error = new Error("share-dom-unrecognized: no message windows captured");
      error.code = "share-dom-unrecognized";
      await fs.writeFile(path.join(versionDir, "failure.json"),
        JSON.stringify({
          source: sharedUrl,
          capturedAt,
          diagnostic: error.code,
          message: error.message,
          evidence: "capture/"
        }, null, 2) + "\n", { mode: 0o600 });
      throw error;
    }

    const assets = await _images(conversation.imageUrls, versionDir);
    relinkImages(conversation, assets.available);
    const data = {
      format: "chatgpt-shared-link-export-poc-1",
      source: sharedUrl,
      finalUrl: navigation.url,
      capturedAt,
      revision: name,
      extractionMethod: observed.extractionMethod,
      observedSegmentCaptures: observed.observedSegmentCaptures,
      observedBoundaryExtensions: observed.observedBoundaryExtensions,
      observedNoEarlierPrefix: observed.observedNoEarlierPrefix,
      uncertainWindowAlignment: observed.uncertain,
      observationComplete: false,
      completeness: "scanned-rendered-windows-only; source-chat completeness not verifiable",
      messages: conversation.messages,
      assets: assets.records,
      capture: "capture/"
    };
    const markdown = markdownDocument(conversation, sharedUrl, capturedAt);
    await fs.writeFile(path.join(versionDir, "conversation.md"), markdown, { mode: 0o600 });
    await fs.writeFile(path.join(versionDir, "conversation.html"),
      renderConversationHtml(conversation, sharedUrl, capturedAt, assets.available),
      { mode: 0o600 });
    await fs.writeFile(path.join(versionDir, "conversation.json"),
      JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    return { directory: versionDir, revision: name, messageCount: data.messages.length,
      imagesDownloaded: assets.records.filter((asset) => asset.status === "downloaded").length,
      imagesUnavailable: assets.records.filter((asset) => asset.status !== "downloaded").length
        + conversation.messages.reduce((sum, message) => sum + message.missingImages.length, 0),
      extractionMethod: data.extractionMethod,
      observationComplete: data.observationComplete,
      observedSegmentCaptures: data.observedSegmentCaptures,
      observedBoundaryExtensions: data.observedBoundaryExtensions,
      observedNoEarlierPrefix: data.observedNoEarlierPrefix,
      uncertainWindowAlignment: data.uncertainWindowAlignment };
  }
  catch (error)
  {
    await fs.writeFile(path.join(versionDir, "error.txt"), String(error.message || error) + "\n",
      { mode: 0o600 });
    throw error;
  }
  finally
  {
    if (page)
    {
      try
      {
        await _control("page", "close", page);
      }
      catch
      {
        // A controller/browser crash must not hide the export result.
      }
    }
  }
}

if (process.argv.length !== 4)
{
  process.stderr.write("usage: node export.mjs <https://chatgpt.com/share/id> <output-dir>\n");
  process.exitCode = 2;
}
else
{
  try
  {
    const result = await exportLink(process.argv[2], process.argv[3]);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  }
  catch (error)
  {
    process.stderr.write(String(error.message || error) + "\n");
    process.exitCode = 1;
  }
}
