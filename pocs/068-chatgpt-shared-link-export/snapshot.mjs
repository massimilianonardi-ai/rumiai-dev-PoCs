import { parseHTML } from "linkedom";

/**
 * The user-supplied native-app exporter traverses mapping/current_node and
 * classifies visible messages. Only use this representation when it is
 * actually present in a shared page's JSON script. No private endpoint or
 * native-app debugger bundle/function name is assumed.
 */
function _findSnapshot(value, depth = 0)
{
  if (depth > 12 || !value || typeof value !== "object") return null;
  if (!Array.isArray(value) && value.mapping && typeof value.mapping === "object"
    && typeof value.current_node === "string")
  {
    return value;
  }
  for (const child of Object.values(value))
  {
    const found = _findSnapshot(child, depth + 1);
    if (found) return found;
  }
  return null;
}

export function snapshotFromRenderedHtml(html)
{
  const { document } = parseHTML(html);
  for (const script of document.querySelectorAll("script[type='application/json']"))
  {
    const raw = script.textContent?.trim();
    if (!raw || raw.length > 32 * 1024 * 1024) continue;
    try
    {
      const candidate = _findSnapshot(JSON.parse(raw));
      if (candidate) return candidate;
    }
    catch
    {
      // Not a conversation snapshot: keep the rendered-window fallback.
    }
  }
  return null;
}

export function conversationFromSnapshot(snapshot)
{
  const mapping = snapshot.mapping;
  const chain = [];
  const seen = new Set();
  let nodeId = snapshot.current_node;
  while (nodeId)
  {
    if (seen.has(nodeId)) throw new Error("snapshot.parent-cycle");
    seen.add(nodeId);
    const node = mapping[nodeId];
    if (!node) throw new Error("snapshot.parent-chain-broken");
    chain.push(node);
    nodeId = node.parent;
  }
  chain.reverse();

  const messages = [];
  for (const node of chain)
  {
    const msg = node.message;
    if (!msg) continue;
    const role = msg.author?.role;
    const channel = msg.channel;
    const content = msg.content || {};
    if (!["user", "assistant"].includes(role) || role === "assistant"
      && (channel === "analysis" || (msg.recipient && msg.recipient !== "all"))
      || ["thoughts", "reasoning_recap"].includes(content.content_type))
    {
      continue;
    }

    // Mirrored from the uploaded Python reference's textual_fragments:
    // keep the non-text parts as-is, not as invented Markdown.
    const fragments = [];
    const nonTextParts = [];
    if (Array.isArray(content.parts))
    {
      for (const part of content.parts)
      {
        if (typeof part === "string") fragments.push(part);
        else nonTextParts.push(part);
      }
    }
    if (!fragments.length)
    {
      if (typeof content.text === "string") fragments.push(content.text);
      else if (typeof content.code === "string") fragments.push(content.code);
    }
    if (role === "assistant" && !fragments.length && !nonTextParts.length) continue;
    const text = fragments.join("");
    messages.push({
      index: messages.length + 1,
      turnIndex: null,
      messageId: msg.id || null,
      role,
      text,
      markdown: text,
      html: "",
      imageUrls: [],
      missingImages: [],
      links: [],
      nonTextParts,
      originalMessage: msg
    });
  }
  return {
    title: snapshot.title || "ChatGPT shared conversation",
    messages,
    imageUrls: [],
    rawSnapshot: snapshot
  };
}
