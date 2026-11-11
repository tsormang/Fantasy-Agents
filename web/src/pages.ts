import { api, copyButton, el } from "./dom";

export interface Member {
  id: string;
  name: string;
  role: "owner" | "member";
}

const origin = () => location.origin;

function form(onSubmit: () => Promise<void>, errBox: HTMLElement, ...kids: Node[]): HTMLFormElement {
  const f = el("form", { class: "row" }, ...kids);
  f.onsubmit = async (e) => {
    e.preventDefault();
    errBox.textContent = "";
    try {
      await onSubmit();
    } catch (x) {
      errBox.textContent = (x as Error).message;
    }
  };
  return f;
}

// ----------------------------------------------------------------- landing

export function landingPage(root: HTMLElement): void {
  const err = el("p", { class: "err" });
  const token = el("input", { type: "password", placeholder: "Owner token", autocomplete: "current-password" });
  token.setAttribute("aria-label", "Owner token");
  root.replaceChildren(
    el(
      "div",
      { class: "page" },
      el(
        "div",
        { class: "box" },
        el("h1", { textContent: "Fantasy Agents" }),
        el("p", { textContent: "A village of coding agents. When one starts working, its hero marches out to battle." }),
        el("p", { class: "dim", textContent: "Watching needs an invite link from the village owner, or a spectator link." }),
        el("a", { class: "btn", href: "/?demo", textContent: "Watch the demo" }),
      ),
      el(
        "div",
        { class: "box" },
        el("h2", { textContent: "Owner sign-in" }),
        form(
          async () => {
            await api("/admin/login", "POST", { token: token.value });
            location.href = "/";
          },
          err,
          el("div", { class: "grow" }, token),
          el("button", { textContent: "Enter" }),
        ),
        err,
      ),
    ),
  );
}

// -------------------------------------------------------------------- join

export function joinPage(root: HTMLElement, code: string): void {
  const err = el("p", { class: "err" });
  const name = el("input", { placeholder: "Your name", maxLength: 24 });
  name.setAttribute("aria-label", "Your name");
  root.replaceChildren(
    el(
      "div",
      { class: "page" },
      el(
        "div",
        { class: "box" },
        el("h1", { textContent: "You are invited to the village" }),
        el("p", { textContent: "Pick the name other villagers will see next to your heroes." }),
        form(
          async () => {
            await api("/join", "POST", { code, name: name.value });
            location.href = "/?connect";
          },
          err,
          el("div", { class: "grow" }, name),
          el("button", { textContent: "Join" }),
        ),
        err,
      ),
    ),
  );
  name.focus();
}

// ------------------------------------------------------- connect a PC modal

export async function connectModal(root: HTMLElement): Promise<void> {
  const body = el("div", {});
  const close = el("button", { class: "quiet", textContent: "Close" });
  const modal = el("div", { class: "modal" }, el("div", { class: "box" }, el("h1", { textContent: "Connect a PC" }), body, close));
  close.onclick = () => modal.remove();
  root.append(modal);

  const devices = el("ul", { class: "list" });
  const loadDevices = async () => {
    const { devices: list } = await api<{ devices: any[] }>("/devices");
    devices.replaceChildren(
      ...list.map((d) => {
        const rm = el("button", { class: "danger", textContent: "Revoke" });
        rm.onclick = async () => {
          if (!confirm(`Revoke "${d.name}"? Its agents will stop appearing.`)) return;
          await api(`/devices/${d.id}`, "DELETE");
          void loadDevices();
        };
        return el("li", {}, el("span", { textContent: `${d.name} (${d.owner})` }), rm);
      }),
    );
    if (!list.length) devices.append(el("li", { class: "dim" }, el("span", { textContent: "No PCs connected yet." })));
  };

  try {
    const { code } = await api<{ code: string }>("/pair", "POST");
    const get = `node -e "fetch('${origin()}/fa.mjs').then(r=>r.text()).then(s=>require('fs').writeFileSync('fa.mjs',s))"`;
    const run = `node fa.mjs connect ${origin()} ${code}`;
    body.append(
      el("p", { textContent: "On the PC you want to connect, run these two commands in a terminal (needs Node 18 or newer):" }),
      el("div", { class: "row" }, el("code", { class: "cmd grow", textContent: get }), copyButton(() => get)),
      el("div", { class: "row" }, el("code", { class: "cmd grow", textContent: run }), copyButton(() => run)),
      el("p", {
        class: "dim",
        textContent:
          "The code works once and expires in 10 minutes. The connector shows which hook files it will change and asks before writing. It only ever sends: agent type, project folder name and activity kind.",
      }),
      el("h2", { textContent: "Connected PCs" }),
      devices,
    );
    await loadDevices();
  } catch (x) {
    body.append(el("p", { class: "err", textContent: (x as Error).message }));
  }
}

// ------------------------------------------------------------------- admin

export async function adminPage(root: HTMLElement, me: Member): Promise<void> {
  const page = el("div", { class: "page" });
  root.replaceChildren(page);
  if (me.role !== "owner") {
    page.append(el("div", { class: "box" }, el("p", { textContent: "Only the village owner can open this page." }), el("a", { href: "/", textContent: "Back to the battlefield" })));
    return;
  }

  const section = (
    title: string,
    path: string,
    key: string,
    label: (x: any) => string,
    create?: { placeholder: string; field: string; reveal: (res: any) => string; note: string },
    canDelete: (x: any) => boolean = () => true,
  ) => {
    const list = el("ul", { class: "list" });
    const err = el("p", { class: "err" });
    const out = el("div", {});
    const load = async () => {
      const data = await api(path);
      list.replaceChildren(
        ...data[key].map((x: any) => {
          const li = el("li", {}, el("span", { textContent: label(x) }));
          if (canDelete(x)) {
            const rm = el("button", { class: "danger", textContent: "Remove" });
            rm.onclick = async () => {
              if (!confirm(`Remove "${label(x)}"?`)) return;
              try {
                await api(`${path}/${x.id}`, "DELETE");
                await load();
              } catch (e) {
                err.textContent = (e as Error).message;
              }
            };
            li.append(rm);
          }
          return li;
        }),
      );
      if (!data[key].length) list.append(el("li", { class: "dim" }, el("span", { textContent: "None yet." })));
    };
    const box = el("div", { class: "box" }, el("h2", { textContent: title }), list);
    if (create) {
      const input = el("input", { placeholder: create.placeholder, maxLength: 40 });
      input.setAttribute("aria-label", create.placeholder);
      box.append(
        form(
          async () => {
            const res = await api(path, "POST", { [create.field]: input.value });
            const link = create.reveal(res);
            out.replaceChildren(
              el("p", { class: "dim", textContent: create.note }),
              el("div", { class: "row" }, el("code", { class: "cmd grow", textContent: link }), copyButton(() => link)),
            );
            input.value = "";
            await load();
          },
          err,
          el("div", { class: "grow" }, input),
          el("button", { textContent: "Create" }),
        ),
        out,
      );
    }
    box.append(err);
    page.append(box);
    void load().catch((e) => (err.textContent = e.message));
  };

  page.append(el("div", { class: "box" }, el("h1", { textContent: "Village council" }), el("a", { href: "/", textContent: "Back to the battlefield" })));
  const day = (t: number) => new Date(t).toLocaleDateString();
  section(
    "Invite links",
    "/invites",
    "invites",
    (i) => `${i.note || "invite"} - ${i.used_by ? `joined as ${i.used_by}` : `open until ${day(i.expires)}`}`,
    {
      placeholder: "Who is this invite for?",
      field: "note",
      reveal: (r) => `${origin()}/join/${r.code}`,
      note: "Send this link to the person you are inviting. It works once, for 7 days, and is shown only now:",
    },
  );
  section("Spectator links", "/shares", "shares", (s) => `${s.label || "spectator"} - created ${day(s.created)}`, {
    placeholder: "Label, e.g. Living room TV",
    field: "label",
    reveal: (r) => `${origin()}/watch/${r.token}`,
    note: "Anyone with this link can watch (read-only) until you remove it. It is shown only now:",
  });
  section("Members", "/members", "members", (m) => `${m.name} (${m.role})`, undefined, (m) => m.role !== "owner");
  section("Connected PCs", "/devices", "devices", (d) => `${d.name} (${d.owner}) - last seen ${new Date(d.last_seen).toLocaleString()}`);
}
