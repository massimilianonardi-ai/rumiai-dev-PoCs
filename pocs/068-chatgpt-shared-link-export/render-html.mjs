import { parseHTML } from "linkedom";

const CSS =
[
  ":root{font-family:system-ui,sans-serif;color-scheme:light}",
  "*{box-sizing:border-box}",
  "body{margin:0;background:#f6f7f9;color:#20232a;line-height:1.65}",
  "header{background:white;padding:1.5rem max(1rem,calc((100vw - 960px)/2));border-bottom:1px solid #ddd}",
  "h1{font-size:1.5rem;margin:0 0 .5rem;overflow-wrap:anywhere}",
  "header p{font-size:.85rem;color:#555;overflow-wrap:anywhere}",
  "main{max-width:960px;margin:2rem auto;padding:0 1rem}",
  "article{background:white;border:1px solid #ddd;border-radius:1rem;margin-bottom:1.25rem;overflow:hidden}",
  "article.user{background:#eff7f4;border-color:#d2e6db}",
  "article h2{font-size:.9rem;font-weight:600;background:#eef0f3;padding:.7rem 1.3rem;margin:0}",
  "article.user h2{background:#dcefe8}",
  ".message{padding:.7rem 1.3rem 1.1rem;overflow-wrap:anywhere}",
  ".message .whitespace-pre-wrap{white-space:pre-wrap}",
  ".message img{max-width:100%;height:auto;border-radius:.5rem}",
  ".message pre{background:#202532;color:#f3f4f6;padding:1rem;border-radius:.5rem;overflow-x:auto}",
  ".message code{font-family:ui-monospace,Consolas,monospace}",
  ".message :not(pre)>code{background:#e9edf3;padding:.1rem .3rem;border-radius:.2rem}",
  ".message table{border-collapse:collapse;display:block;overflow-x:auto}",
  ".message td,.message th{padding:.5rem;border:1px solid #ddd}",
  ".message blockquote{border-left:3px solid #aaa;padding-left:1rem;margin:1rem 0}",
  ".message a{color:#0969da}",
  ".message ul,.message ol{padding-left:1.5rem}",
  "footer{max-width:960px;margin:2rem auto;padding:1rem;color:#667;font-size:.85rem}",
  "@media print{body{background:white}article{break-inside:avoid}}"
].join("\n");

function _escape(value)
{
  return String(value).replace(/[&<>"']/g, (match) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[match]);
}

function _safeFragment(fragment, downloaded)
{
  const { document } = parseHTML("<html><body><div id='fragment-root'>"
    + fragment + "</div></body></html>");
  const root = document.querySelector("#fragment-root");
  for (const element of [...root.querySelectorAll("*")])
  {
    const tag = element.localName?.toLowerCase();
    if (["script", "iframe", "object", "embed", "svg", "style", "link", "form",
      "input", "button", "video", "audio", "source"].includes(tag))
    {
      element.remove();
      continue;
    }

    for (const attr of [...element.attributes])
    {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || ["style", "srcset", "formaction"].includes(name))
      {
        element.removeAttribute(attr.name);
      }
    }
    if (tag === "a")
    {
      const href = element.getAttribute("href") || "";
      if (!/^https?:\/\//i.test(href) && !href.startsWith("#"))
      {
        element.removeAttribute("href");
      }
      element.setAttribute("rel", "noreferrer noopener");
    }
    if (tag === "img")
    {
      const source = element.getAttribute("src") || "";
      const local = downloaded.get(source);
      if (local) element.setAttribute("src", local);
      else if (!/^https:\/\//i.test(source)) element.removeAttribute("src");
    }
  }
  return root.innerHTML;
}

export function renderConversationHtml(conversation, sharedUrl, capturedAt, downloaded)
{
  const messages = conversation.messages.map((message) =>
  {
    const role = message.role === "user" ? "user" : "assistant";
    const fragment = _safeFragment(message.html || "", downloaded);
    return "<article class='" + role + "'><h2>" + _escape(message.index)
      + ". " + _escape(role) + "</h2><div class='message'>"
      + (fragment || "<p>" + _escape(message.text || "") + "</p>")
      + "</div></article>";
  }).join("\n");

  return "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
    + "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    + "<title>" + _escape(conversation.title) + "</title>"
    + "<style>" + CSS + "</style></head><body>"
    + "<header><h1>" + _escape(conversation.title) + "</h1>"
    + "<p>Source: " + _escape(sharedUrl) + "</p>"
    + "<p>Captured: " + _escape(capturedAt) + "</p></header>"
    + "<main>" + messages + "</main><footer>Visible captured messages; source completeness not guaranteed.</footer>"
    + "</body></html>\n";
}
