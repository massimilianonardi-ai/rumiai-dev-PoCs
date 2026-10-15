/**
 * ChatGPT-specific scroll observation through the existing Playwright
 * web-control debug.cdp extension. An actual wheel event is important:
 * assigning scrollTop at the edge does not notify some segment loaders.
 * No standalone remote-debugging socket or provider change is required.
 */
const GEOMETRY_EXPRESSION = String.raw`(() =>
{
  const message = document.querySelector("[data-message-author-role]");
  let element = message?.parentElement || null;
  let scroller = null;
  while (element)
  {
    const style = getComputedStyle(element);
    if (/(auto|scroll|overlay)/.test(style.overflowY) && element.clientHeight > 0)
    {
      scroller = element;
      // Prefer a pane that actually has scrollable content, but remember
      // the first overflow container: a fresh segment may initially fit.
      if (element.scrollHeight > element.clientHeight + 2) break;
    }
    element = element.parentElement;
  }

  if (scroller)
  {
    const rect = scroller.getBoundingClientRect();
    return {
      source: "nested-element",
      scrollY: scroller.scrollTop,
      documentHeight: scroller.scrollHeight,
      viewportHeight: scroller.clientHeight,
      atTop: scroller.scrollTop <= 2,
      atBottom: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 20,
      x: Math.max(2, Math.min(innerWidth - 2, rect.left + rect.width / 2)),
      y: Math.max(2, Math.min(innerHeight - 2, rect.top + rect.height / 2))
    };
  }
  const root = document.documentElement;
  const body = document.body;
  const height = Math.max(root?.scrollHeight || 0, root?.offsetHeight || 0,
    body?.scrollHeight || 0, body?.offsetHeight || 0);
  return {
    source: "document",
    scrollY: scrollY,
    documentHeight: height,
    viewportHeight: innerHeight,
    atTop: scrollY <= 2,
    atBottom: scrollY + innerHeight >= height - 20,
    x: Math.max(2, innerWidth / 2),
    y: Math.max(2, innerHeight / 2)
  };
})()`;

async function _geometry(control, page)
{
  const response = await control("debug", "cdp", page, "Runtime.evaluate",
    JSON.stringify({ expression: GEOMETRY_EXPRESSION, returnByValue: true }));
  const geometry = response.result?.value;
  if (response.exceptionDetails || !geometry
      || !Number.isFinite(geometry.scrollY)
      || !Number.isFinite(geometry.documentHeight)
      || !Number.isFinite(geometry.viewportHeight)
      || !Number.isFinite(geometry.x) || !Number.isFinite(geometry.y)
      || !["nested-element", "document"].includes(geometry.source))
  {
    throw new Error("scroll.invalid-browser-geometry");
  }
  return geometry;
}

function _portableError(error)
{
  return /web-control-command-failed.*(unknown method|unsupported|invalid invocation)/i
    .test(String(error?.message));
}

/**
 * Drive a real browser wheel event, then observe geometry and edge flags.
 * At the edge the wheel is still delivered: a site may load earlier/later
 * segments without the scrolling offset changing until new DOM is mounted.
 */
export async function scrollConversation(control, page, delta)
{
  if (!Number.isSafeInteger(delta)) throw new TypeError("scroll.invalid-delta");
  try
  {
    const before = await _geometry(control, page);
    if (delta !== 0)
    {
      await control("debug", "cdp", page, "Input.dispatchMouseEvent",
        JSON.stringify({
          type: "mouseWheel",
          x: before.x,
          y: before.y,
          deltaX: 0,
          deltaY: delta,
          modifiers: 0,
          pointerType: "mouse"
        }));
    }
    // CDP input dispatch is asynchronous relative to page layout and React.
    await new Promise((resolve) => setTimeout(resolve, 120));
    const after = await _geometry(control, page);
    return { ...after, scrollSource: "cdp-wheel" };
  }
  catch (error)
  {
    if (!_portableError(error)) throw error;
    const portable = await control("page", "scroll", page, String(delta));
    return {
      ...portable,
      source: "portable-document",
      atTop: portable.scrollY <= 2,
      scrollSource: "portable-document"
    };
  }
}
