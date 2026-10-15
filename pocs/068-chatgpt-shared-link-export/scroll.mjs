/**
 * Experimental ChatGPT-specific extension over Playwright web-control.
 * Portable page scroll only moves window; ChatGPT often scrolls a nested pane.
 * This uses the provider's existing privileged, page-scoped CDP extension.
 * It never opens or publishes a remote debugger port.
 */
const SCROLL_EXPRESSION = String.raw`(function (delta)
{
  const message = document.querySelector("[data-message-author-role]");
  let element = message?.parentElement || null;
  while (element)
  {
    const style = getComputedStyle(element);
    if (element.scrollHeight > element.clientHeight + 24
      && /(auto|scroll|overlay)/.test(style.overflowY))
    {
      element.scrollTop += delta;
      return {
        source: "nested-element",
        scrollY: element.scrollTop,
        documentHeight: element.scrollHeight,
        viewportHeight: element.clientHeight,
        atTop: element.scrollTop <= 2,
        atBottom: element.scrollTop + element.clientHeight >= element.scrollHeight - 20
      };
    }
    element = element.parentElement;
  }

  window.scrollBy(0, delta);
  const root = document.documentElement;
  const body = document.body;
  const height = Math.max(root?.scrollHeight || 0, root?.offsetHeight || 0,
    body?.scrollHeight || 0, body?.offsetHeight || 0);
  return {
    source: "document",
    scrollY: window.scrollY,
    documentHeight: height,
    viewportHeight: window.innerHeight,
    atTop: window.scrollY <= 2,
    atBottom: window.scrollY + window.innerHeight >= height - 20
  };
})(__DELTA__)`;

/**
 * Detect the actual scrolling geometry through the real Playwright CDP
 * extension, falling back to portable document scroll for other providers.
 * A portable fallback cannot prove reaching the top of a nested pane.
 */
export async function scrollConversation(control, page, delta)
{
  if (!Number.isSafeInteger(delta)) throw new TypeError("invalid scroll delta");

  try
  {
    const response = await control("debug", "cdp", page, "Runtime.evaluate",
      JSON.stringify({
        expression: SCROLL_EXPRESSION.replace("__DELTA__", String(delta)),
        returnByValue: true
      }));
    if (response.exceptionDetails || !response.result?.value)
    {
      throw new Error("scroll.browser-evaluation-failed");
    }
    const geometry = response.result.value;
    if (!["nested-element", "document"].includes(geometry.source)
      || !Number.isFinite(geometry.scrollY))
    {
      throw new Error("scroll.invalid-evaluation-result");
    }
    return geometry;
  }
  catch (error)
  {
    if (!/web-control-command-failed.*(unknown method|unsupported|invalid invocation)/i
      .test(String(error.message)))
    {
      throw error;
    }
    const portable = await control("page", "scroll", page, String(delta));
    return {
      ...portable,
      source: "portable-document",
      atTop: portable.scrollY <= 2
    };
  }
}
