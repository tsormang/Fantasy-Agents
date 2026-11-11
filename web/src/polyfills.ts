// DOM APIs are not supplied by the legacy build's JavaScript language polyfills.
if (!Element.prototype.append) {
  Element.prototype.append = function (this: Element, ...nodes: (Node | string)[]) {
    for (const node of nodes) this.appendChild(typeof node === "string" ? document.createTextNode(node) : node);
  };
}

if (!Element.prototype.replaceChildren) {
  Element.prototype.replaceChildren = function (this: Element, ...nodes: (Node | string)[]) {
    while (this.firstChild) this.removeChild(this.firstChild);
    this.append(...nodes);
  };
}

// CSS.supports("gap") also returns true for browsers with grid-only gap support.
const flex = document.createElement("div");
flex.style.cssText = "position:absolute;visibility:hidden;display:flex;flex-direction:column;row-gap:1px";
flex.append(document.createElement("div"), document.createElement("div"));
document.body.appendChild(flex);
document.documentElement.classList.toggle("no-flex-gap", flex.scrollHeight !== 1);
flex.remove();
