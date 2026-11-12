# Fantasy Agents

A live battlefield for your coding agents, drawn with the Tiny Swords art pack. Every Claude Code, Codex or Cursor session in a project folder you allowed on a connected PC is a hero: idle heroes rest in the village, working heroes cross the bridge and fight the black army's raiders and lancers until the task is done.

In Connect or Edit, choose a name category for each allowed path: Latin, Gothic, Ancient Greek, Korean, Fantasy, Aristocrat, Norse, or Celtic. Run the generated command on that PC. Each session receives a random name from its category, shared by all viewers and kept across status updates. Changing category assigns a new name on the next event. Older custom aliases continue to work as project labels and default to Fantasy hero names.

Click your own resting hero, on the battlefield or in the Heroes list, to remove it from the village. This does not disconnect its PC or change allowed folders. Repeated idle events do not bring it back; resumed work does. A dismissal record retains its name for up to 12 hours, then expires. Working agents, other people's agents, and spectator views do not offer removal.

The generated commands use the connector's existing alias option with a reserved `@names:<category>` value, so installed connectors can select categories without reinstalling hooks. The server stores assigned hero names and categories alongside session state; paths remain local to the PC.

Choose a PC color (Blue, Red, Yellow, Purple, or Automatic) before generating its connection command. Edit agents also offers a PC color selector for your own machines. Save PC color applies immediately to all its active heroes, ribbons and portraits, for every viewer in full and lite graphics, without a terminal command. Automatic preserves the original ID-based palette; PCs may deliberately share a color.

| Agent | Class | Activity on screen |
| --- | --- | --- |
| Claude Code | Monk (casts bolts) | edit = sparks, command = explosion, search/read = scrying ring, web = arcane ring, sub-agent = familiar |
| Codex | Warrior (sword and shield) | same effects, melee |
| Cursor | Archer (bow) | same effects, arrows |

Faction colour (blue, red, yellow or purple) identifies the PC. A task running longer than 10 minutes draws a black knight warlord. An agent waiting for your approval shows a "!" bubble while enemies circle. A PC that goes quiet for 10 minutes fades its heroes.

## How it works

```
PC hooks --POST /api/events--> Worker --> Realm Durable Object --WebSocket--> browsers
```

- `worker/` Cloudflare Worker and the `Realm` Durable Object (SQLite state, hibernating WebSockets).
- `web/` Vite + TypeScript + Canvas 2D client. Art is [Tiny Swords by Pixel Frog](https://pixelfrog-assets.itch.io/tiny-swords) (free pack), which you download yourself: see [Get the sprites](#get-the-sprites). Sprite and scene definitions are in `web/src/game/sprites.ts` and `world.ts`.
- `connector/fa.mjs` dependency-free Node script that installs hooks and posts events. Served by the Worker at `/fa.mjs`.
- `shared/protocol.ts` wire format.

## Privacy

A connected PC reports **nothing** until its owner allows a project folder on it. The allow-list lives on the PC in `~/.fantasy-agents/config.json` and is checked by the connector before anything is posted, so a session in any other folder produces no network request at all. The server never sees the list or any path.

For a session in an allowed folder the connector sends only:

- the agent type (`claude`, `codex`, `cursor`);
- a session id, which is an HMAC of the tool's session id keyed with that PC's device token, so it cannot be recomputed or matched against a session id by anyone else;
- the event (`start`, `working`, `activity`, `waiting`, `idle`, `end`) and an activity kind (`edit`, `command`, `search`, `read`, `web`, `subagent`, `think`);
- the name of the allowed folder, or the alias you gave it. This is the name of the folder you allowed, never of the subfolder or worktree the agent happens to be in.

Prompts, commands, tool input, file names, paths and code never leave the machine. This is enforced in `mapHook` in `connector/fa.mjs` and covered by tests, including one that runs the real hook in a folder that is not allowed and asserts that no request is made.

Separately, `connect` and `status` send the PC's name and which of the three tools have hooks installed. The name defaults to the computer's hostname; the connector asks for it, so pick something else if the hostname identifies your employer.

What the server keeps: for each live session one row with the fields above plus timestamps and a tool-call count, deleted when the session ends or goes quiet; for each PC its name, a hash of its token and when it was last heard from. There is no history, and the Worker does not log events.

Who sees what: every signed-in member **and everyone holding a spectator link** sees every hero: agent type, project name or alias, PC name, the PC owner's member name, status, activity kind and timing. If a project name should not be visible to those people, give the folder an alias or do not allow it.

## Get the sprites

For all six packs, exact extraction paths, verification steps, and a copyable coding-agent prompt, see **[Complete sprite setup](docs/SPRITE_SETUP.md)**.

The art is not in this repository. Tiny Swords is free to use, but its licence does not allow the files to be redistributed, so each person downloads their own copy. Without it the project still builds, but the battlefield shows only water and name labels.

1. Open <https://pixelfrog-assets.itch.io/tiny-swords> and choose **Download Now** (the price is pay-what-you-want; "No thanks, just take me to the downloads" is fine).
2. Download **Tiny Swords (Free Pack).zip** and unzip it anywhere. The Enemy Pack and the legacy edition are not needed.
3. Copy the sheets the game uses into the project:

```bash
npm run art -- "path/to/Tiny Swords (Free Pack)"
```

This copies 101 PNGs into `web/src/assets/ts` (git-ignored). You can also unzip the pack into a `Tiny Swords` folder at the repository root (also git-ignored) and run `npm run art` with no path. Run it again whenever you update the pack, then rebuild.

## Develop

```bash
npm install
npm run art -- "path/to/Tiny Swords (Free Pack)"   # once, see above
npm run dev        # builds the client, then wrangler dev on http://localhost:8787
npm test           # connector tests (node:test) + Worker tests (vitest in workerd)
npm run typecheck
```

`http://localhost:8787/?demo` shows scripted fake agents; add `&night=1` to force night lighting.
Local owner sign-in uses `ADMIN_TOKEN` from `.dev.vars` (git-ignored).

### Lightweight graphics

Open **`/lite` on your own deployment** for the original
code-drawn pixel graphics. The normal `/` site keeps the Tiny Swords art.
Use **Lite graphics** / **Full graphics** on the battlefield or sign-in page
to switch. Lite uses a low-resolution canvas, caps rendering at 30 FPS, pauses
rendering in hidden tabs, and skips all Tiny Swords image and UI downloads.
It shares the same sign-in, live agents and connected PCs.

For a TV spectator link, insert `/lite` before `/watch/...`:
`/lite/watch/YOUR_TOKEN` on your own deployment.
Demo: `/lite?demo`; forced night: `/lite?demo&night=1`.
Lite reduces graphics work; the browser compatibility target below still applies.

### Samsung TV browsers

The production build includes a legacy JavaScript bundle targeting Chromium 56
(Samsung's 2018 Tizen 4.0 generation) and newer. Lowering Vite's syntax target
alone is insufficient: these TVs do not understand module scripts. The legacy
plugin supplies the non-module loader and language polyfills; the client also
provides missing DOM helpers, a size-observation fallback, and older CSS layouts.
2015–2017 TVs are outside this target and require separate validation.

For a TV, create a spectator link in **Council** on your PC and open that
`/watch/...` link in the TV browser. This avoids entering the owner token on the TV.
After deploying an update, reload the TV page (clear its browser cache if needed).
Use `/?demo` to check rendering without signing in. Startup failures now show a
message and the browser's user agent instead of leaving an empty screen.
Real TV testing is still required; desktop browser tests cannot establish firmware compatibility.

## Deploy

Deploy to your own Cloudflare account. `wrangler.jsonc` contains the application's
shared runtime configuration; it contains no account ID or personal domain.
Choose your own Worker name in that file and use the URL printed after deployment.
Keep account credentials and `ADMIN_TOKEN` out of Git; local secrets belong in
the git-ignored `.dev.vars` file.

```bash
npx wrangler login
npx wrangler secret put ADMIN_TOKEN   # choose a long random owner token
npm run deploy
```

## Use

1. Open the site and sign in with the owner token.
2. **Connect PC** shows one command to paste into a terminal on a machine, then a checklist that confirms each agent tool reports in. The browser remembers the PC it paired, so reopening the dialog goes straight to its status. The connector asks what to call the PC, lists the hook files it will change, asks before writing, keeps existing hooks and makes backups.
3. Choose which projects appear. A newly connected PC shares nothing. In each project folder you want on the battlefield:

   ```bash
   node "$HOME/.fantasy-agents/fa.mjs" add                       # asks you to paste the path of each folder
   node "$HOME/.fantasy-agents/fa.mjs" browse                    # same, but pick the folder in a folder window
   node "$HOME/.fantasy-agents/fa.mjs" allow                     # the current folder
   node "$HOME/.fantasy-agents/fa.mjs" allow path/to/project --as "side project"   # show an alias instead of the folder name
   node "$HOME/.fantasy-agents/fa.mjs" list                      # what is reported
   node "$HOME/.fantasy-agents/fa.mjs" disallow path/to/project  # or: disallow --all
   node "$HOME/.fantasy-agents/fa.mjs" status                    # connection, reported folders, whether the current folder is reported
   ```

   The commands are written with `$HOME` so they work in PowerShell, bash and zsh (`~` does not work in Windows PowerShell). In the Windows Command Prompt use `%USERPROFILE%` instead.

   Allowing a folder covers its subfolders and its git worktrees, wherever those are on disk. Changes apply to the next event, also for sessions that are already running. An event is judged by the folder it happens in: if an agent leaves the allowed folder, its hero stops updating and fades. `connect` also offers to allow the folder it is run from. The folder window of `browse` opens on the PC itself (Windows, macOS, or Linux with zenity or kdialog); the web page cannot offer one, because browsers do not reveal folder paths and the list must not pass through the server.
4. **Council** creates single-use invite links for other people and revocable read-only spectator links (`/watch/...`) for TVs or phones.
5. To remove a PC: `node "$HOME/.fantasy-agents/fa.mjs" disconnect`, and revoke it under Connect PC.

Hook files touched: `~/.claude/settings.json`, `~/.codex/hooks.json`, `~/.cursor/hooks.json`. For Cursor only after-the-fact events are used, so the connector can never block an action. Codex silently skips new hooks until you trust them (desktop app: **Settings > Hooks**; CLI: `/hooks`), then start a new chat.

### Updating a PC connected before the allow-list

Older connectors reported every folder on the PC. The server now refuses their events and forgets their heroes, and Connect PC marks such a PC as out of date and shows a one-line update command. With a connector that already has it, `node "$HOME/.fantasy-agents/fa.mjs" update` does the same. The connection and hooks are kept; after updating, the PC reports nothing until you `allow` folders. Until a PC is updated, its old connector still posts events for every folder to the village server, which discards them; run `disconnect` on a PC you cannot update yet.
