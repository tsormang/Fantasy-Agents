# Fantasy Agents

A live battlefield for your coding agents, drawn with the Tiny Swords art pack. Every Claude Code, Codex or Cursor session on a connected PC is a hero: idle heroes rest in the village, working heroes cross the bridge and fight the black army's raiders and lancers until the task is done.

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

**Privacy:** a connected PC sends only the agent type, a hashed session id, the project folder name and an activity kind (`edit`, `command`, `search`, `read`, `web`, `subagent`, `think`). Prompts, commands, paths and code never leave the machine. This is enforced in `mapHook` and covered by a test.

## Get the sprites

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

## Deploy

```bash
npx wrangler login
npx wrangler secret put ADMIN_TOKEN   # choose a long random owner token
npm run deploy
```

## Use

1. Open the site and sign in with the owner token.
2. **Connect PC** shows one command to paste into a terminal on a machine, then a checklist that confirms each agent tool reports in. The browser remembers the PC it paired, so reopening the dialog goes straight to its status. The connector lists the hook files it will change, asks before writing, keeps existing hooks and makes backups.
3. **Council** creates single-use invite links for other people and revocable read-only spectator links (`/watch/...`) for TVs or phones.
4. To remove a PC: `node ~/.fantasy-agents/fa.mjs disconnect`, and revoke it under Connect PC.

Hook files touched: `~/.claude/settings.json`, `~/.codex/hooks.json`, `~/.cursor/hooks.json`. For Cursor only after-the-fact events are used, so the connector can never block an action. Codex silently skips new hooks until you trust them (desktop app: **Settings > Hooks**; CLI: `/hooks`), then start a new chat.
