import "./polyfills";
import { startDemo } from "./demo";
import { api, el } from "./dom";
import { alternateModePath, lite, modePath, path } from "./mode";
import { type Member, adminPage, connectModal, joinPage, landingPage } from "./pages";
import { Store, connect } from "./store";

const root = document.getElementById("app")!;
const query = new URLSearchParams(location.search);
let graphics: typeof import("./graphics-lite");

function battlefield(store: Store, actions: HTMLElement[] = []): void {
  root.replaceChildren();
  actions.push(el("a", {
    class: "btn quiet",
    href: alternateModePath(),
    textContent: lite ? "Full graphics" : "Lite graphics",
    title: lite ? "Switch to Tiny Swords graphics" : "Original pixel graphics for older TVs",
  }));
  graphics.mount(root, store, actions);
}

async function main(): Promise<void> {
  graphics = await (lite ? import("./graphics-lite") : import("./graphics"));
  graphics.loadSkins();
  if (query.has("demo")) {
    const store = new Store();
    startDemo(store);
    battlefield(store);
    return;
  }

  const join = path.match(/^\/join\/([\w-]+)$/);
  if (join) return joinPage(root, join[1]);

  const watch = path.match(/^\/watch\/([\w-]+)$/);
  if (watch) {
    const store = new Store();
    connect(store, watch[1]);
    battlefield(store);
    store.onChange(() => {
      if (store.denied && !root.querySelector(".modal")) {
        root.append(el("div", { class: "modal" }, el("div", { class: "box" }, el("p", { textContent: "This spectator link is not valid any more." }))));
      }
    });
    return;
  }

  let me: Member;
  try {
    me = (await api<{ member: Member }>("/me")).member;
  } catch {
    return landingPage(root);
  }

  if (path === "/admin") return adminPage(root, me);

  const store = new Store();
  connect(store);
  const connectBtn = el("button", { textContent: "Connect PC" });
  connectBtn.onclick = () => void connectModal(root);
  const actions: HTMLElement[] = [connectBtn];
  const editBtn = el("button", { class: "quiet", textContent: "Edit agents" });
  editBtn.onclick = () => void connectModal(root, "edit");
  actions.push(editBtn);
  if (me.role === "owner") actions.push(el("a", { class: "btn quiet", href: modePath("/admin"), textContent: "Council" }));
  const out = el("button", { class: "quiet", textContent: "Leave" });
  out.title = `Signed in as ${me.name}`;
  out.onclick = async () => {
    await api("/logout", "POST");
    location.href = modePath("/");
  };
  actions.push(out);
  battlefield(store, actions);
  if (query.has("connect")) void connectModal(root);
}

void main().then(() => window.dispatchEvent(new Event("fantasy-ready")));
