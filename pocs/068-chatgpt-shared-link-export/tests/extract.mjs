import assert from "node:assert/strict";
import test from "node:test";
import { extractConversation, markdownDocument, relinkImages, prependOlderMessages } from "../extract.mjs";

const sharedUrl = "https://chatgpt.com/share/12345678-1234-1234-1234-123456789012";

test("extract two roles, text markup, source links and image references", () =>
{
  const html = [
    "<html><head><title>Example chat</title></head><body>",
    '<article data-message-author-role="user"><div class="whitespace-pre-wrap">Hello user</div></article>',
    '<article data-message-author-role="assistant"><div class="markdown">',
    '<h2>Answer</h2><p><strong>Bold</strong> and <a href="/help">help</a>.</p>',
    '<pre><code class="language-js">const n = 1;\nconsole.log(n);\n</code></pre>',
    '<img alt="figure" src="https://files.oaiusercontent.com/test.png">',
    "</div></article>",
    "</body></html>"
  ].join("");

  const conversation = extractConversation(html, sharedUrl);
  assert.equal(conversation.title, "Example chat");
  assert.deepEqual(conversation.messages.map((message) => message.role), ["user", "assistant"]);
  assert.equal(conversation.messages[0].text, "Hello user");
  assert.match(conversation.messages[1].markdown, /## Answer/);
  assert.match(conversation.messages[1].markdown, /\*\*Bold\*\*/);
  assert.match(conversation.messages[1].markdown, /https:\/\/chatgpt.com\/help/);
  assert.match(conversation.messages[1].markdown, /console.log\(n\)/);
  assert.deepEqual(conversation.imageUrls, ["https://files.oaiusercontent.com/test.png"]);
  assert.match(conversation.messages[1].markdown, /!\[figure\]/);
  assert.match(markdownDocument(conversation, sharedUrl, "2026-10-15T00:00:00.000Z"),
    /## 2\. assistant/);

  relinkImages(conversation,
    new Map([["https://files.oaiusercontent.com/test.png", "assets/image-0001.png"]]));
  assert.match(conversation.messages[1].markdown, /assets\/image-0001.png/);
  assert.ok(!conversation.messages[1].markdown.includes("https://files.oaiusercontent.com/test.png"));
});

test("reject a document without ChatGPT message containers", () =>
{
  assert.throws(() => extractConversation("<html><body>Login required</body></html>", sharedUrl),
    { code: "share-dom-unrecognized" });
});

test("reject role containers without content", () =>
{
  assert.throws(() => extractConversation(
    '<main><div data-message-author-role="assistant"><button>Copy</button></div></main>', sharedUrl),
  { code: "share-dom-empty" });
});

test("ignore nested duplicate role nodes", () =>
{
  const html = '<article data-message-author-role="assistant">'
    + '<section data-message-author-role="assistant"><p>Hi</p></section></article>';
  assert.equal(extractConversation(html, sharedUrl).messages.length, 1);
});

test("ignore role-independent page controls", () =>
{
  const html = '<div data-message-author-role="assistant">'
    + '<div class="markdown"><p>Actual content</p><button>Copy</button><svg><text>icon</text></svg></div>'
    + "</div>";
  const result = extractConversation(html, sharedUrl);
  assert.match(result.messages[0].markdown, /Actual content/);
  assert.doesNotMatch(result.messages[0].markdown, /Copy|icon/);
});

test("retain fenced source code containing triple backticks", () =>
{
  const html = '<div data-message-author-role="assistant"><div class="markdown">'
    + "<pre><code>hello\n" + String.fromCharCode(96).repeat(3) + "\nbye</code></pre></div></div>";
  const result = extractConversation(html, sharedUrl);
  assert.equal((result.messages[0].markdown.match(/^\x60{4,}/gm) || []).length, 2);
  assert.match(result.messages[0].markdown, /hello/);
});

test("keep non-fetchable image as explicit missing content", () =>
{
  const html = '<div data-message-author-role="assistant">'
    + '<div class="markdown"><p>Diagram</p><img alt="drawing" src="blob:temporary"></div></div>';
  const result = extractConversation(html, sharedUrl);
  assert.equal(result.messages[0].missingImages.length, 1);
  assert.match(result.messages[0].markdown, /\[Image unavailable: drawing\]/);
});

test("retain multiple markdown sections within one assistant turn", () =>
{
  const html = '<div data-message-author-role="assistant">'
    + '<div class="markdown"><p>Part one</p></div>'
    + '<div class="markdown"><p>Part two</p></div></div>';
  const result = extractConversation(html, sharedUrl);
  assert.match(result.messages[0].markdown, /Part one/);
  assert.match(result.messages[0].markdown, /Part two/);
});

test("retain user line breaks from whitespace-pre-wrap source", () =>
{
  const html = '<div data-message-author-role="user">'
    + '<div class="whitespace-pre-wrap">first\nsecond</div></div>';
  const result = extractConversation(html, sharedUrl);
  assert.match(result.messages[0].markdown, /first\nsecond/);
});


test("prepend only new numbered DOM turns and never duplicate complete windows", () =>
{
  const window = (from, to) =>
  {
    const nodes = [];
    for (let i = from; i <= to; i += 1)
    {
      nodes.push('<div data-testid="conversation-turn-' + i + '">'
        + '<article data-message-id="msg-' + i + '" data-message-author-role="'
        + (i % 2 ? "assistant" : "user") + '"><div class="markdown">'
        + '<p>Message ' + i + '</p></div></article></div>');
    }
    return extractConversation('<html><title>Dynamic share</title><body>'
      + nodes.join("") + "</body></html>", sharedUrl).messages;
  };

  let assembled = window(6, 9);
  for (const current of [window(4, 7), window(2, 5), window(0, 3)])
  {
    const joined = prependOlderMessages(assembled, current);
    assert.equal(joined.added, 2);
    assembled = joined.messages;
  }
  for (let attempt = 0; attempt < 6; attempt += 1)
  {
    const same = prependOlderMessages(assembled, window(0, 9));
    assert.equal(same.added, 0);
    assembled = same.messages;
  }
  assert.deepEqual(assembled.map((m) => m.turnIndex),
    Array.from({ length: 10 }, (_, i) => i));
});

test("duplicate text with different numbered turns remains distinct", () =>
{
  const first = extractConversation(
    '<div data-testid="conversation-turn-2"><div data-message-author-role="user">OK</div></div>',
    sharedUrl).messages;
  const previous = extractConversation(
    '<div data-testid="conversation-turn-1"><div data-message-author-role="user">OK</div></div>',
    sharedUrl).messages;
  const joined = prependOlderMessages(first, previous);
  assert.deepEqual(joined.messages.map((m) => m.turnIndex), [1, 2]);
});

test("unidentified disjoint DOM chunks are not silently prepended", () =>
{
  const first = extractConversation(
    '<div data-message-author-role="assistant">B</div>', sharedUrl).messages;
  const previous = extractConversation(
    '<div data-message-author-role="user">A</div>', sharedUrl).messages;
  const joined = prependOlderMessages(first, previous);
  assert.equal(joined.uncertain, true);
  assert.equal(joined.added, 0);
});

test("SVG chart is retained as an HTML graphic reference", () =>
{
  const html = '<div data-message-author-role="assistant"><div class="markdown">'
    + '<p>Distribution</p><svg width="400" height="200"><rect width="20" height="50"/></svg>'
    + '</div></div>';
  const chat = extractConversation(html, sharedUrl);
  assert.match(chat.messages[0].markdown, /SVG graphic/);
  assert.match(chat.messages[0].html, /<svg/);
});
