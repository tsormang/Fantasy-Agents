import { startDemo } from "./demo";
import { api, el } from "./dom";
import { Game } from "./game/game";
import { Hud } from "./hud";
import { type Member, adminPage, connectModal, joinPage, landingPage } from "./pages";
import { Store, connect } from "./store";

const root = document.getElementById("app")!;
const path = location.pathname;
const query = new URLSearchParams(location.search);

function battlefield(store: Store, actions: HTMLElement[] = []): void {
  root.replaceChildren();
  const game = new Game(root, store);
  new Hud(root, store, game, actions);
}

async function main(): Promise<void> {
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
  if (me.role === "owner") actions.push(el("a", { class: "btn quiet", href: "/admin", textContent: "Council" }));
  const out = el("button", { class: "quiet", textContent: "Leave" });
  out.title = `Signed in as ${me.name}`;
  out.onclick = async () => {
    await api("/logout", "POST");
    location.href = "/";
  };
  actions.push(out);
  battlefield(store, actions);
  if (query.has("connect")) void connectModal(root);
}

void main();
