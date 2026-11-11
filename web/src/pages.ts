import { ago, api, copyButton, el } from "./dom";
import { alternateModePath, lite, modePath } from "./mode";

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
        el("a", { class: "btn", href: modePath("/") + "?demo", textContent: "Watch the demo" }),
        el("a", { class: "btn quiet", href: alternateModePath(), textContent: lite ? "Full graphics" : "Lite graphics (older TVs)" }),
      ),
      el(
        "div",
        { class: "box" },
        el("h2", { textContent: "Owner sign-in" }),
        form(
          async () => {
            await api("/admin/login", "POST", { token: token.value });
            location.href = modePath("/");
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
            location.href = modePath("/") + "?connect";
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
  /** false for PCs paired before the connector reported its tools */
  reported: number;
  /** connector wire version last seen: 1 = an old connector that reports every folder and is refused */
  proto: number;
  agents: { agent: string; seen: number | null }[];
}

/** Which PC was paired from this browser. A per-browser convenience only; the server does not depend on it. */
const THIS_PC = "fa.thisPc";
const recall = (): string | null => {
  try {
    return localStorage.getItem(THIS_PC);
  } catch {
    return null;
  }
};
const remember = (id: string | null): void => {
  try {
    if (id) localStorage.setItem(THIS_PC, id);
    else localStorage.removeItem(THIS_PC);
  } catch {
    /* storage unavailable: the dialog just will not remember */
  }
};

/** One command for any shell (PowerShell, cmd, bash, zsh): download the connector to the temp folder and run it. */
export function connectCommand(base: string, code: string): string {
  return (
    `node -e "fetch('${base}/fa.mjs').then(r=>r.text()).then(s=>{const f=require('os').tmpdir()+'/fa.mjs';` +
    `require('fs').writeFileSync(f,s);require('child_process').spawnSync(process.execPath,[f,'connect','${base}','${code}'],{stdio:'inherit'})})"`
  );
}

/** For a PC that is already connected: replace its connector with the current one, then show what it reports. */
export function updateCommand(base: string): string {
  return (
    `node -e "fetch('${base}/fa.mjs').then(r=>r.ok?r.text():Promise.reject(r.status)).then(s=>{const f=require('path').join(require('os').homedir(),'.fantasy-agents','fa.mjs');` +
    `require('fs').writeFileSync(f,s);require('child_process').spawnSync(process.execPath,[f,'status'],{stdio:'inherit'})})"`
  );
}

/** Encode paths as data so shell metacharacters, quotes and Unicode survive every supported shell. */
export function projectsCommand(paths: string[]): string {
  const encoded = btoa(Array.from(new TextEncoder().encode(JSON.stringify(paths)), (b) => String.fromCharCode(b)).join(""));
  return `node -e "const f=require('path').join(require('os').homedir(),'.fantasy-agents','fa.mjs');const paths=JSON.parse(Buffer.from('${encoded}','base64').toString('utf8'));for(const p of paths){const r=require('child_process').spawnSync(process.execPath,[f,'allow',p],{stdio:'inherit'});if(r.error||r.status!==0)process.exit(r.status||1)}"`;
}

function projectFields(): HTMLElement {
  const fields = el("div", {});
  const command = el("code", { class: "cmd grow" });
  const copy = copyButton(() => command.textContent || "");
  const output = el("div", { class: "row project-command" }, command, copy);
  const hint = el("p", { class: "dim", textContent: "Enter a project path above to generate your command." });
  const inputs: HTMLInputElement[] = [];
  const update = () => {
    const paths = [...new Set(inputs.map((input) => input.value).filter((path) => path.trim()))];
    command.textContent = paths.length ? projectsCommand(paths) : "";
    output.hidden = !paths.length;
    hint.hidden = !!paths.length;
  };
  const addField = (focus = true) => {
    const input = el("input", { type: "text", placeholder: "C:\\Projects\\MyApp or /home/you/projects/my-app", autocomplete: "off", spellcheck: false });
    const label = el("span", { textContent: `Project path ${inputs.length + 1}` });
    const remove = el("button", { class: "quiet", type: "button", textContent: "Remove" });
    const row = el("div", { class: "project-path" }, el("label", { class: "grow" }, label, input), remove);
    inputs.push(input);
    input.oninput = update;
    remove.onclick = () => {
      inputs.splice(inputs.indexOf(input), 1);
      row.remove();
      Array.from(fields.children).forEach((child, i) => { child.querySelector("span")!.textContent = `Project path ${i + 1}`; });
      if (!inputs.length) addField();
      update();
    };
    fields.append(row);
    if (focus) input.focus();
  };
  const add = el("button", { class: "quiet", type: "button", textContent: "+ Add project path" });
  add.onclick = () => addField();
  addField(false);
  update();
  return el("div", { class: "project-setup" },
    el("p", { textContent: "Choose the project folders agents can report from on this PC. Subfolders and git worktrees are included." }),
    fields, el("p", {}, add), hint,
    el("p", { textContent: "Copy and run the generated command in a terminal on this PC, then start a new agent session in an allowed folder and send a prompt." }),
    output,
    el("p", { class: "dim", textContent: "Paths stay in this dialog and are never sent to the server. Running the command saves the allowed folders on your PC; viewers see only the folder name. Adding a field here does not allow the folder until you run the command." }),
  );
}

export async function connectModal(root: HTMLElement): Promise<void> {
  const intro = el("div", {});
  const pairBox = el("div", {});
  const devicesEl = el("ul", { class: "list" });
  const checklist = el("div", {});
  const projectHost = el("div", {});
  const selectedPC = el("p", { textContent: "Connect a PC in step 1 to continue." });
  const projectPanels = new Map<string, HTMLElement>();
  let selectedId: string | null = null;
  const close = el("button", { class: "quiet", textContent: "Close" });
  const modal = el(
    "div",
    { class: "modal" },
    el("div", { class: "box" }, el("h1", { textContent: "Connect" }),
      el("section", { class: "connect-step" }, el("h2", { textContent: "Step 1: Connect PC" }), intro, pairBox, el("h3", { textContent: "Connected PCs" }), devicesEl),
      el("section", { class: "connect-step" }, el("h2", { textContent: "Step 2: Connect Agents" }), selectedPC, projectHost, checklist), close),
  );
  let timer = 0;
  close.onclick = () => {
    clearInterval(timer);
    modal.remove();
  };
  root.append(modal);

  let known: Set<string> | null = null;
  /** Which PC is being tested, and from what moment an event counts as a pass. */
  let testing: { id: string; since: number } | null = null;
  let pairing = false;

  const showPair = async () => {
    if (pairing) return;
    pairing = true;
    try {
      const { code } = await api<{ code: string }>("/pair", "POST");
      const cmd = connectCommand(origin(), code);
      pairBox.replaceChildren(
        el("p", { textContent: "Paste this one command into a terminal on the PC you want to connect (needs Node 18 or newer):" }),
        el("div", { class: "row" }, el("code", { class: "cmd grow", textContent: cmd }), copyButton(() => cmd)),
        el("p", {
          class: "dim",
          textContent:
            "The code inside works once and expires in 10 minutes. The connector asks what to call the PC, lists the hook files it will change and asks before writing. This dialog continues by itself once the PC connects.",
        }),
        el("p", {
          class: "dim",
          textContent:
            "A connected PC reports nothing until you allow a project folder on it. For allowed folders it only ever sends: agent type, the folder's name (or an alias you choose) and an activity kind. Sessions in every other folder send nothing at all.",
        }),
      );
    } catch (x) {
      pairing = false;
      pairBox.replaceChildren(el("p", { class: "err", textContent: (x as Error).message }));
    }
  };

  const renderIntro = (list: Device[]) => {
    const mine = list.find((d) => d.id === recall());
    if (!mine) return intro.replaceChildren();
    const add = el("button", { class: "quiet", textContent: "Add another PC" });
    add.hidden = pairing;
    add.onclick = () => {
      add.hidden = true;
      void showPair();
    };
    intro.replaceChildren(
      el("p", { textContent: `This browser's PC is connected as "${mine.name}". Nothing to set up again.` }),
      el("p", {}, add),
    );
  };

  const renderChecklist = (list: Device[], now: number) => {
    const t0 = testing;
    const d = t0 && list.find((x) => x.id === t0.id);
    if (!t0 || !d) {
      selectedId = null;
      selectedPC.textContent = "Connect a PC in step 1, or select Test next to a connected PC, to continue.";
      projectHost.replaceChildren();
      return checklist.replaceChildren();
    }
    selectedPC.textContent = `Set up agents on "${d.name}"`;
    if (selectedId !== d.id) {
      selectedId = d.id;
      if (!projectPanels.has(d.id)) projectPanels.set(d.id, projectFields());
      projectHost.replaceChildren(projectPanels.get(d.id)!);
    }
    const passedFor = (agent: string) => {
      const e = d.agents.find((a) => a.agent === agent);
      return !!e?.seen && e.seen >= t0.since;
    };
    const rows = TOOLS.map((t) => {
      const entry = d.agents.find((a) => a.agent === t.agent);
      const passed = passedFor(t.agent);
      const unknown = !entry && !d.reported;
      const state = unknown
        ? "Not heard from yet"
        : !entry
          ? "Not set up on this PC"
          : passed
            ? t0.since
              ? "OK - hero summoned"
              : `OK - last heard ${ago(now - entry.seen!)} ago`
            : "Waiting for a prompt...";
      const item = el(
        "div",
        { class: `check ${passed ? "ok" : entry || unknown ? "wait" : "off"}` },
        el("div", { class: "row" }, el("b", { class: "grow", textContent: t.label }), el("span", { class: "state", textContent: state })),
      );
      if (unknown) {
        item.append(
          el("p", { class: "dim", textContent: "This PC was connected with an older connector, so it is not known whether this tool is set up. Run the status command below on that PC to refresh, or just try it:" }),
          el("ol", {}, ...t.steps.map((s) => el("li", { textContent: s }))),
        );
      } else if (!entry) {
        item.append(el("p", { class: "dim", textContent: "The connector did not find this tool here. If you install it later, add this PC again." }));
      } else if (!passed) {
        if (entry.seen) item.append(el("p", { class: "dim", textContent: `Last heard from it ${ago(now - entry.seen)} ago. Send a prompt to test again.` }));
        item.append(el("ol", {}, ...t.steps.map((s) => el("li", { textContent: s }))));
      }
      return item;
    });
    const outdated = d.proto === 1;
    const update = updateCommand(origin());
    const done = TOOLS.every((t) => (d.agents.some((a) => a.agent === t.agent) ? passedFor(t.agent) : !!d.reported));
    checklist.replaceChildren(
      el("h3", { textContent: "Agent status" }),
      ...(outdated
        ? [
            el(
              "div",
              { class: "check wait" },
              el("div", { class: "row" }, el("b", { class: "grow", textContent: "Connector out of date" }), el("span", { class: "state", textContent: "Ignored" })),
              el("p", {
                class: "dim",
                textContent:
                  "This PC runs an old connector that reports every folder, so the village ignores it. Run this on that PC to update it; afterwards it reports only the folders you allow:",
              }),
              el("div", { class: "row" }, el("code", { class: "cmd grow", textContent: update }), copyButton(() => update)),
            ),
          ]
        : []),
      el("p", {
        textContent: done
          ? "Everything that is set up on this PC is reporting in."
          : "Then, in each tool below, start a new session inside an allowed folder and send any prompt. This list updates by itself.",
      }),
      ...rows,
      el("p", { class: "dim", textContent: "If nothing arrives at all, run this on that PC to check it can reach the server and to see which folders it reports:" }),
      el("code", { class: "cmd", textContent: 'node "$HOME/.fantasy-agents/fa.mjs" status' }),
      ...(outdated
        ? []
        : [
            el("p", { class: "dim", textContent: 'If a command above is unknown on that PC (for example "add"), its connector is older than this page. Run this there to update it:' }),
            el("div", { class: "row" }, el("code", { class: "cmd grow", textContent: update }), copyButton(() => update)),
          ]),
      el("p", { class: "dim", textContent: "These commands work in PowerShell, bash and zsh. In the old Windows Command Prompt, replace $HOME with %USERPROFILE%." }),
    );
  };

  const refresh = async () => {
    const { devices: list, now } = await api<{ devices: Device[]; now: number }>("/devices");
    const first = !known;
    if (!known) known = new Set(list.map((d) => d.id));
    // A PC that appears while this dialog is open was just paired from here: remember it and start testing it.
    const fresh = list.find((d) => !known!.has(d.id));
    if (fresh) {
      known.add(fresh.id);
      remember(fresh.id);
      testing = { id: fresh.id, since: 0 };
      pairing = false;
      pairBox.replaceChildren();
    }
    if (first) {
      const mine = list.find((d) => d.id === recall());
      if (mine) testing = { id: mine.id, since: 0 };
      else {
        // never paired from this browser, or that PC was revoked since
        remember(null);
        void showPair();
      }
    }
    devicesEl.replaceChildren(
      ...list.map((d) => {
        const here = d.id === recall() ? " - this PC" : "";
        const test = el("button", { class: "quiet", textContent: "Test" });
        test.onclick = () => {
          testing = { id: d.id, since: now };
          void refresh();
        };
        const rm = el("button", { class: "danger", textContent: "Revoke" });
        rm.onclick = async () => {
          if (!confirm(`Revoke "${d.name}"? Its agents will stop appearing and it must be added again to come back.`)) return;
          await api(`/devices/${d.id}`, "DELETE");
          void refresh();
        };
        return el("li", {}, el("span", { textContent: `${d.name} (${d.owner})${here}` }), test, rm);
      }),
    );
    if (!list.length) devicesEl.append(el("li", { class: "dim" }, el("span", { textContent: "No PCs connected yet." })));
    renderIntro(list);
    renderChecklist(list, now);
  };

  try {
    await refresh();
    timer = window.setInterval(() => void refresh().catch(() => {}), 3000);
  } catch (x) {
    intro.replaceChildren(el("p", { class: "err", textContent: (x as Error).message }));
  }
}

// ------------------------------------------------------------------- admin

export async function adminPage(root: HTMLElement, me: Member): Promise<void> {
  const page = el("div", { class: "page" });
  root.replaceChildren(page);
  if (me.role !== "owner") {
    page.append(el("div", { class: "box" }, el("p", { textContent: "Only the village owner can open this page." }), el("a", { href: modePath("/"), textContent: "Back to the battlefield" })));
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

  page.append(el("div", { class: "box" }, el("h1", { textContent: "Village council" }), el("a", { href: modePath("/"), textContent: "Back to the battlefield" })));
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
    reveal: (r) => `${origin()}${modePath(`/watch/${r.token}`)}`,
    note: "Anyone with this link can watch (read-only) until you remove it. It is shown only now:",
  });
  section("Members", "/members", "members", (m) => `${m.name} (${m.role})`, undefined, (m) => m.role !== "owner");
  section("Connected PCs", "/devices", "devices", (d) => `${d.name} (${d.owner}) - last seen ${new Date(d.last_seen).toLocaleString()}`);
}
