import { parseHTML } from "linkedom";

function _absoluteUrl(value, baseUrl)
{
  if (!value) return null;
  try
  {
    const url = new URL(value, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  }
  catch
  {
    return null;
  }
}

function _children(node, context)
{
  return Array.from(node.childNodes || []).map((child) => _markdown(child, context)).join("");
}

function _plain(node)
{
  return (node.textContent || "").replace(/\s+/g, " ").trim();
}

function _codeFence(value)
{
  const runs = value.match(/\x60+/g) || [];
  const size = Math.max(3, ...runs.map((run) => run.length + 1));
  return String.fromCharCode(96).repeat(size);
}

function _markdown(node, context)
{
  if (node.nodeType === 3)
  {
    const preformatted = node.parentElement?.closest(".whitespace-pre-wrap");
    return preformatted
      ? node.nodeValue.replace(/\r\n/g, "\n")
      : node.nodeValue.replace(/\s+/g, " ");
  }
  if (node.nodeType !== 1) return "";

  const tag = node.localName.toLowerCase();
  if (tag === "svg")
  {
    return node.querySelector("path,rect,circle,ellipse,line,polygon,polyline")
      ? "\n\n[SVG graphic — see conversation.html]\n\n" : "";
  }
  if (tag === "canvas") return "\n\n[Canvas graphic — unavailable in DOM export]\n\n";
  if (["button", "script", "style", "noscript", "template"].includes(tag)) return "";
  if (node.getAttribute("aria-hidden") === "true") return "";

  if (tag === "br") return "\n";
  if (tag === "img")
  {
    const raw = node.getAttribute("src") || node.getAttribute("data-src")
      || node.getAttribute("srcset")?.split(",")[0]?.trim().split(/\s+/)[0];
    const src = _absoluteUrl(raw, context.baseUrl);
    const alt = (node.getAttribute("alt") || "image").replace(/[\[\]]/g, "");
    if (!src)
    {
      context.missingImages.push({ alt, reason: "source-not-fetchable" });
      return "[Image unavailable: " + alt + "]";
    }
    context.images.add(src);
    return "![" + alt + "](<" + src + ">)";
  }

  if (tag === "pre")
  {
    const code = node.querySelector("code");
    const text = (code || node).textContent.replace(/\n$/, "");
    const className = code?.getAttribute("class") || "";
    const language = className.match(/(?:^|\s)language-([a-zA-Z0-9_+#.-]+)/)?.[1] || "";
    const fence = _codeFence(text);
    return "\n\n" + fence + language + "\n" + text + "\n" + fence + "\n\n";
  }

  if (tag === "code")
  {
    const value = node.textContent || "";
    const fence = _codeFence(value);
    return fence + value + fence;
  }

  if (tag === "a")
  {
    const label = _children(node, context).trim() || _plain(node);
    const href = _absoluteUrl(node.getAttribute("href"), context.baseUrl);
    if (!href) return label;
    context.links.add(href);
    return "[" + label.replace(/[\[\]]/g, "") + "](<" + href + ">)";
  }

  const value = _children(node, context);
  if (tag === "strong" || tag === "b") return "**" + value.trim() + "**";
  if (tag === "em" || tag === "i") return "*" + value.trim() + "*";
  if (/^h[1-6]$/.test(tag)) return "\n\n" + "#".repeat(Number(tag[1])) + " " + value.trim() + "\n\n";
  if (tag === "p") return value.trim() + "\n\n";
  if (tag === "blockquote")
  {
    return "\n\n" + value.trim().split("\n").map((line) => "> " + line).join("\n") + "\n\n";
  }
  if (tag === "ul" || tag === "ol")
  {
    const items = Array.from(node.children).filter((child) => child.localName === "li");
    const lines = items.map((item, index) =>
    {
      const marker = tag === "ol" ? String(index + 1) + "." : "-";
      const contents = _children(item, context).trim();
      return marker + " " + contents.replace(/\n/g, "\n  ");
    });
    return "\n\n" + lines.join("\n") + "\n\n";
  }
  if (tag === "table") return "\n\n" + node.outerHTML + "\n\n";
  if (tag === "hr") return "\n\n---\n\n";
  return value;
}

function _messageContent(turn)
{
  const explicit = turn.querySelectorAll("[data-testid='message-content']");
  if (explicit.length === 1) return explicit[0];
  const markdown = turn.querySelectorAll(".markdown");
  if (markdown.length === 1)
  {
    const separateGraphic = [...turn.querySelectorAll("svg,canvas")].some((graphic) =>
      !markdown[0].contains(graphic) && !graphic.closest("button,[aria-hidden='true']"));
    if (!separateGraphic) return markdown[0];
  }
  if (markdown.length > 1 || explicit.length > 1) return turn;
  return turn.querySelector(".whitespace-pre-wrap") || turn;
}

function _normalizeMarkdown(value)
{
  return value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+\n/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Parse already-rendered, user-visible ChatGPT share HTML.
 * This is an experimental DOM adapter, not a private ChatGPT API.
 */
export function extractConversation(html, baseUrl)
{
  if (typeof html !== "string") throw new TypeError("html must be a string");
  const { document } = parseHTML(html);
  const messageNodes = Array.from(document.querySelectorAll("[data-message-author-role]"))
    .filter((element) => !element.parentElement?.closest("[data-message-author-role]"));

  if (messageNodes.length === 0)
  {
    const error = new Error("share-dom-unrecognized: no visible message role containers");
    error.code = "share-dom-unrecognized";
    throw error;
  }

  const messages = messageNodes.map((node, index) =>
  {
    const role = node.getAttribute("data-message-author-role");
    const container = node.closest("[data-testid^='conversation-turn-']");
    const match = container?.getAttribute("data-testid")?.match(/^conversation-turn-(\d+)$/);
    const turnIndex = match ? Number(match[1]) : null;
    const messageId = node.getAttribute("data-message-id")
      || node.closest("[data-message-id]")?.getAttribute("data-message-id") || null;
    const content = _messageContent(node);
    const visible = content.cloneNode(true);
    for (const control of visible.querySelectorAll(
      "button,script,style,noscript,template,[aria-hidden='true']"))
    {
      control.remove();
    }
    const context = { baseUrl, images: new Set(), links: new Set(), missingImages: [] };
    const markdown = _normalizeMarkdown(_markdown(visible, context));
    const text = _plain(visible);
    return {
      index: index + 1,
      turnIndex,
      messageId,
      role,
      text,
      markdown: markdown || text,
      html: content.innerHTML,
      imageUrls: [...context.images],
      missingImages: context.missingImages,
      links: [...context.links]
    };
  });

  if (messages.every((message) => !message.text && !message.imageUrls.length && !message.missingImages.length))
  {
    const error = new Error("share-dom-empty: message containers carry no content");
    error.code = "share-dom-empty";
    throw error;
  }

  return {
    title: document.querySelector("title")?.textContent?.trim() || "ChatGPT shared conversation",
    messages,
    imageUrls: [...new Set(messages.flatMap((message) => message.imageUrls))]
  };
}

export function markdownDocument(conversation, sharedUrl, capturedAt)
{
  const lines =
  [
    "# " + conversation.title.replace(/[\r\n]+/g, " "),
    "",
    "Source: " + sharedUrl,
    "Captured: " + capturedAt,
    "",
    "---",
    ""
  ];
  for (const message of conversation.messages)
  {
    lines.push("## " + message.index + ". " + message.role, "", message.markdown, "", "---", "");
  }
  return lines.join("\n") + "\n";
}

export function relinkImages(conversation, downloaded)
{
  for (const message of conversation.messages)
  {
    for (const url of message.imageUrls)
    {
      const local = downloaded.get(url);
      if (!local) continue;
      message.markdown = message.markdown.split("(<" + url + ">)").join("(<" + local + ">)");
    }
  }
}

/**
 * Prepend only demonstrably older turns from a newly rendered DOM window.
 * A matching text body is not a stable identity: messages can be identical.
 * With no IDs/indices, require an actual overlapping suffix/prefix.
 */
export function prependOlderMessages(existing, incoming)
{
  if (!existing.length) return { messages: [...incoming], added: incoming.length, uncertain: false };
  if (!incoming.length) return { messages: existing, added: 0, uncertain: false };

  const key = (m) => m.messageId
    ? "id:" + m.messageId
    : Number.isSafeInteger(m.turnIndex) ? "turn:" + m.turnIndex : null;
  const seen = new Set(existing.map(key).filter(Boolean));
  const knownMin = Math.min(...existing.map((m) =>
    Number.isSafeInteger(m.turnIndex) ? m.turnIndex : Infinity));
  const indexed = incoming.filter((m) => Number.isSafeInteger(m.turnIndex));
  const hasIndices = Number.isFinite(knownMin) && indexed.length === incoming.length;

  if (hasIndices)
  {
    const older = incoming.filter((m) => m.turnIndex < knownMin && !seen.has(key(m)));
    const unique = [...new Map(older.map((m) => [m.turnIndex, m])).values()];
    unique.sort((a, b) => a.turnIndex - b.turnIndex);
    return { messages: [...unique, ...existing], added: unique.length, uncertain: false };
  }

  const existingFirst = key(existing[0]);
  const anchor = existingFirst ? incoming.findIndex((m) => key(m) === existingFirst) : -1;
  if (anchor >= 0)
  {
    const prefix = incoming.slice(0, anchor).filter((m) => key(m) && !seen.has(key(m)));
    return { messages: [...prefix, ...existing], added: prefix.length, uncertain: false };
  }

  // Without observed identity, accept only a contiguous overlap. Never
  // silently append an apparently different whole viewport as a new segment.
  for (let count = Math.min(existing.length, incoming.length); count > 0; count -= 1)
  {
    const matches = incoming.slice(-count).every((m, i) =>
    {
      const prior = existing[i];
      const leftKey = key(m);
      const rightKey = key(prior);
      return leftKey && rightKey ? leftKey === rightKey
        : m.role === prior.role && m.markdown === prior.markdown;
    });
    if (matches)
    {
      const prefix = incoming.slice(0, incoming.length - count);
      return { messages: [...prefix, ...existing], added: prefix.length, uncertain: false };
    }
  }

  // A completely disjoint window may represent a real skipped segment,
  // but cannot be ordered/deduplicated conclusively without stronger IDs.
  if (incoming.every((m) => key(m)) && existing.every((m) => key(m)))
  {
    const prefix = incoming.filter((m) => !seen.has(key(m)));
    return { messages: [...prefix, ...existing], added: prefix.length, uncertain: true };
  }
  return { messages: existing, added: 0, uncertain: true };
}
