import assert from "node:assert/strict";
import test from "node:test";
import { snapshotFromRenderedHtml, conversationFromSnapshot } from "../snapshot.mjs";
import { renderConversationHtml } from "../render-html.mjs";

test("reuse reference exporter mapping/current_node traversal when a real JSON-shaped snapshot is present", () =>
{
  const snapshot = {
    title: "Transcript",
    current_node: "a3",
    mapping: {
      a1: { parent: null, message: { id: "u1", author: { role: "user" },
        content: { parts: ["Hello"] } } },
      a2: { parent: "a1", message: { id: "t1", author: { role: "tool" },
        content: { parts: ["tool response"] } } },
      a3: { parent: "a2", message: { id: "a1", author: { role: "assistant" },
        content: { parts: ["World", { content_type: "image_asset_pointer", asset_pointer: "pointer" }] } } }
    }
  };
  const html = '<script type="application/json">' + JSON.stringify({ props: snapshot }) + '</script>';
  const parsed = snapshotFromRenderedHtml(html);
  assert.ok(parsed);
  const conversation = conversationFromSnapshot(parsed);
  assert.deepEqual(conversation.messages.map((message) => message.role), ["user", "assistant"]);
  assert.equal(conversation.messages[1].text, "World");
  assert.equal(conversation.messages[1].nonTextParts.length, 1);
  assert.equal(conversation.messages[1].messageId, "a1");
  assert.equal(snapshotFromRenderedHtml("<main>Only rendered content</main>"), null);
});

test("styled HTML is self-contained and excludes active scripts/event handlers", () =>
{
  const conversation = {
    title: "Demo",
    messages: [
      { index: 1, role: "assistant", html: '<p>Hi</p><img src="https://files.oaiusercontent.com/i.png">'
        + '<img src="blob:internal"><a href="javascript:alert(1)">bad</a><script>alert(1)</script>'
        + '<b onclick="alert(2)">Good</b>', text: "Hi" }
    ]
  };
  const html = renderConversationHtml(conversation, "https://chatgpt.com/share/example",
    "2026-10-15T10:00:00Z", new Map([
      ["https://files.oaiusercontent.com/i.png", "assets/image-0001.png"]
    ]));
  assert.match(html, /<style>/);
  assert.match(html, /assets\/image-0001\.png/);
  assert.doesNotMatch(html, /<script|onclick=|javascript:alert|blob:internal/);
});
