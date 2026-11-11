// Older smart-TV browsers (Samsung Tizen ships Chromium 76 and earlier) lack a few DOM helpers.
if (!Element.prototype.replaceChildren) {
  Element.prototype.replaceChildren = function (this: Element, ...nodes: (Node | string)[]) {
    while (this.firstChild) this.removeChild(this.firstChild);
    this.append(...nodes);
  };
}
