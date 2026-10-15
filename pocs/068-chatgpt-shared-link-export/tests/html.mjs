import assert from "node:assert/strict";
import test from "node:test";
import { renderConversationHtml } from "../render-html.mjs";

test("styled export preserves safe SVG graphics, local images, and blocks active content", () =>
{
  const conversation = {
    title: "Demo",
    messages: [
      {
        index: 1,
        role: "assistant",
        html: '<p>Hi</p><svg width="400" height="200"><rect width="20" height="50" fill="blue"/></svg>'
          + '<img src="https://files.oaiusercontent.com/i.png">'
          + '<img src="blob:internal"><a href="javascript:alert(1)">bad</a>'
          + '<script>alert(1)</script><b onclick="alert(2)">Good</b>',
        text: "Hi"
      }
    ]
  };
  const html = renderConversationHtml(conversation, "https://chatgpt.com/share/example",
    "2026-10-15T10:00:00Z", new Map([
      ["https://files.oaiusercontent.com/i.png", "assets/image-0001.png"]
    ]));
  assert.match(html, /<style>/);
  assert.match(html, /<svg[^>]*>/);
  assert.match(html, /<rect[^>]*fill="blue"/);
  assert.match(html, /assets\/image-0001\.png/);
  assert.doesNotMatch(html, /<script|onclick=|javascript:alert|blob:internal/);
});

test("canvas does not masquerade as an exported chart", () =>
{
  const conversation = {
    title: "Canvas",
    messages: [{ index: 1, role: "assistant", html: "<canvas></canvas>", text: "" }]
  };
  const html = renderConversationHtml(conversation, "https://chatgpt.com/share/example",
    "2026-10-15T10:00:00Z", new Map());
  assert.match(html, /Canvas graphic: pixel data unavailable/);
});
