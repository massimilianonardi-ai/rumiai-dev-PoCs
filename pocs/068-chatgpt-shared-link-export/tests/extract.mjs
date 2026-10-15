import assert from "node:assert/strict";
import test from "node:test";
import { extractConversation, markdownDocument, relinkImages } from "../extract.mjs";

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
  assert.match(result.messages[0].markdown, /^\n*/);
  assert.match(result.messages[0].markdown, /hello/);
});
