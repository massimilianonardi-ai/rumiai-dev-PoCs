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
    return node.nodeValue.replace(/\s+/g, " ");
  }
  if (node.nodeType !== 1) return "";

  const tag = node.localName.toLowerCase();
  if (["button", "svg", "script", "style", "noscript", "template"].includes(tag)) return "";
  if (node.getAttribute("aria-hidden") === "true") return "";

  if (tag === "br") return "\n";
  if (tag === "img")
  {
    const src = _absoluteUrl(node.getAttribute("src") || node.getAttribute("data-src"), context.baseUrl);
    if (!src) return "";
    context.images.add(src);
    const alt = (node.getAttribute("alt") || "image").replace(/[\[\]]/g, "");
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
  return turn.querySelector(".markdown")
    || turn.querySelector("[data-testid='message-content']")
    || turn.querySelector(".whitespace-pre-wrap")
    || turn;
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
    const content = _messageContent(node);
    const context = { baseUrl, images: new Set(), links: new Set() };
    const markdown = _normalizeMarkdown(_markdown(content, context));
    const text = _plain(content);
    return {
      index: index + 1,
      role,
      text,
      markdown: markdown || text,
      html: content.innerHTML,
      imageUrls: [...context.images],
      links: [...context.links]
    };
  });

  if (messages.every((message) => !message.text && !message.imageUrls.length))
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
