import { ago, api, copyButton, el } from "./dom";

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

const TOOLS: { agent: string; label: string; steps: string[] }[] = [
  {
    agent: "claude",
    label: "Claude Code",
    steps: [
      "Start a NEW Claude Code session and send any prompt. Sessions that were already open do not load new hooks.",
      "Still nothing? Type /hooks in Claude Code and check that the fa.mjs entries are listed. Approve them if it asks you to review hook changes.",
    ],
  },
  {
    agent: "codex",
    label: "Codex",
    steps: [
      'Codex skips new hooks until you trust them. Desktop app: Settings > Hooks, or "Review hooks" in the composer. CLI: type /hooks.',
      "Trust the entries that run fa.mjs, then start a NEW chat and send any prompt.",
    ],
  },
  {
    agent: "cursor",
    label: "Cursor",
    steps: [
      "Open a NEW Agent chat and send any prompt. Tab completions and inline edits do not count.",
      'Still nothing? Check Settings > Hooks and the "Hooks" output channel for errors, and update Cursor if no hooks are listed.',
    ],
  },
];

interface Device {
  id: string;
  name: string;
  owner: string;
  created: number;
  agents: { agent: string; seen: number | null }[];
}

export async function connectModal(root: HTMLElement): Promise<void> {
  const body = el("div", {});
  const close = el("button", { class: "quiet", textContent: "Close" });
  const modal = el("div", { class: "modal" }, el("div", { class: "box" }, el("h1", { textContent: "Connect a PC" }), body, close));
  let timer = 0;
  close.onclick = () => {
    clearInterval(timer);
    modal.remove();
  };
  root.append(modal);

  const devicesEl = el("ul", { class: "list" });
  const checklist = el("div", {});
  let known: Set<string> | null = null;
  /** Which PC is being tested, and from what moment an event counts as a pass. */
  let testing: { id: string; since: number } | null = null;

  const renderChecklist = (list: Device[], now: number) => {
    const t0 = testing;
    const d = t0 && list.find((x) => x.id === t0.id);
    if (!t0 || !d) return checklist.replaceChildren();
    const passedFor = (agent: string) => {
      const e = d.agents.find((a) => a.agent === agent);
      return !!e?.seen && e.seen >= t0.since;
    };
    const rows = TOOLS.map((t) => {
      const entry = d.agents.find((a) => a.agent === t.agent);
      const passed = passedFor(t.agent);
      const state = !entry ? "Not set up on this PC" : passed ? "OK - hero summoned" : "Waiting for a prompt...";
      const item = el(
        "div",
        { class: `check ${passed ? "ok" : entry ? "wait" : "off"}` },
        el("div", { class: "row" }, el("b", { class: "grow", textContent: t.label }), el("span", { class: "state", textContent: state })),
      );
      if (!entry) {
        item.append(el("p", { class: "dim", textContent: "The connector did not find this tool here. If you install it later, run the two commands again." }));
      } else if (!passed) {
        if (entry.seen) item.append(el("p", { class: "dim", textContent: `Last heard from it ${ago(now - entry.seen)} ago. Send a prompt to test again.` }));
        item.append(el("ol", {}, ...t.steps.map((s) => el("li", { textContent: s }))));
      }
      return item;
    });
    const done = TOOLS.every((t) => !d.agents.some((a) => a.agent === t.agent) || passedFor(t.agent));
    checklist.replaceChildren(
      el("h2", { textContent: `Test "${d.name}"` }),
      el("p", {
        textContent: done
          ? "Everything that is set up on this PC is reporting in. You can close this."
          : "In each tool below, start a new session and send any prompt. This list updates by itself.",
      }),
      ...rows,
      el("p", { class: "dim", textContent: "If nothing arrives at all, run this on that PC to check it can reach the server:" }),
      el("code", { class: "cmd", textContent: "node ~/.fantasy-agents/fa.mjs status" }),
    );
  };

  const refresh = async () => {
    const { devices: list, now } = await api<{ devices: Device[]; now: number }>("/devices");
    if (!known) known = new Set(list.map((d) => d.id));
    // A PC that appears while this dialog is open was just paired: start testing it.
    const fresh = list.find((d) => !known!.has(d.id));
    if (fresh) {
      known.add(fresh.id);
      testing = { id: fresh.id, since: 0 };
    }
    devicesEl.replaceChildren(
      ...list.map((d) => {
        const test = el("button", { class: "quiet", textContent: testing?.id === d.id ? "Testing" : "Test" });
        test.onclick = () => {
          testing = { id: d.id, since: now };
          void refresh();
        };
        const rm = el("button", { class: "danger", textContent: "Revoke" });
        rm.onclick = async () => {
          if (!confirm(`Revoke "${d.name}"? Its agents will stop appearing.`)) return;
          await api(`/devices/${d.id}`, "DELETE");
          void refresh();
        };
        return el("li", {}, el("span", { textContent: `${d.name} (${d.owner})` }), test, rm);
      }),
    );
    if (!list.length) devicesEl.append(el("li", { class: "dim" }, el("span", { textContent: "No PCs connected yet." })));
    renderChecklist(list, now);
  };

  try {
    const { code } = await api<{ code: string }>("/pair", "POST");
    const get = `node -e "fetch('${origin()}/fa.mjs').then(r=>r.text()).then(s=>require('fs').writeFileSync('fa.mjs',s))"`;
    const run = `node fa.mjs connect ${origin()} ${code}`;
    body.append(
      el("h2", { textContent: "1. Run on the PC" }),
      el("p", { textContent: "In a terminal on the PC you want to connect (needs Node 18 or newer):" }),
      el("div", { class: "row" }, el("code", { class: "cmd grow", textContent: get }), copyButton(() => get)),
      el("div", { class: "row" }, el("code", { class: "cmd grow", textContent: run }), copyButton(() => run)),
      el("p", {
        class: "dim",
        textContent:
          "The code works once and expires in 10 minutes. The connector shows which hook files it will change and asks before writing. It only ever sends: agent type, project folder name and activity kind.",
      }),
      el("h2", { textContent: "2. Test the agents" }),
      el("p", { class: "dim", textContent: "A newly connected PC shows up here by itself. Press Test on any PC to check it again." }),
      devicesEl,
      checklist,
    );
    await refresh();
    timer = window.setInterval(() => void refresh().catch(() => {}), 3000);
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
