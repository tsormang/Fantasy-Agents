/** Observe layout changes, including hidden panes, on older TV browsers too. */
export function observeSize(element: HTMLElement, changed: () => void): () => void {
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(changed);
    observer.observe(element);
    return () => observer.disconnect();
  }
  let width = element.clientWidth;
  let height = element.clientHeight;
  const check = () => {
    if (width === element.clientWidth && height === element.clientHeight) return;
    width = element.clientWidth;
    height = element.clientHeight;
    changed();
  };
  // Window resize alone misses a hidden container becoming visible or a wrapping HUD.
  const timer = window.setInterval(check, 500);
  window.addEventListener("resize", check);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("resize", check);
  };
}
