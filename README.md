# Fantasy Agents

A live pixel-art battlefield for your coding agents. Every Claude Code, Codex or Cursor session on a connected PC is a hero: idle heroes rest in the village, working heroes march out of the gate and fight goblins and skeletons until the task is done.

| Agent | Class | Activity on screen |
| --- | --- | --- |
| Claude Code | Mage (staff, fire bolts) | edit = sparks, command = shockwave, search/read = scrying ring, web = arcane ring, sub-agent = familiar |
| Codex | Barbarian (axe) | same effects, melee |
| Cursor | Ranger (bow) | same effects, arrows |

Cloak colour identifies the PC. A task running longer than 10 minutes draws a goblin warlord. An agent waiting for your approval shows a "!" bubble while enemies circle. A PC that goes quiet for 10 minutes fades its heroes.

## How it works

```
PC hooks --POST /api/events--> Worker --> Realm Durable Object --WebSocket--> browsers
```

- `worker/` Cloudflare Worker and the `Realm` Durable Object (SQLite state, hibernating WebSockets).
- `web/` Vite + TypeScript + Canvas 2D client. All art is original and drawn in code (`web/src/game/sprites.ts`, `world.ts`).
- `connector/fa.mjs` dependency-free Node script that installs hooks and posts events. Served by the Worker at `/fa.mjs`.
- `shared/protocol.ts` wire format.

**Privacy:** a connected PC sends only the agent type, a hashed session id, the project folder name and an activity kind (`edit`, `command`, `search`, `read`, `web`, `subagent`, `think`). Prompts, commands, paths and code never leave the machine. This is enforced in `mapHook` and covered by a test.

## Develop

```bash
npm install
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
2. **Connect PC** shows two commands to run on a machine. The connector lists the hook files it will change, asks before writing, keeps existing hooks and makes backups.
3. **Council** creates single-use invite links for other people and revocable read-only spectator links (`/watch/...`) for TVs or phones.
4. To remove a PC: `node ~/.fantasy-agents/fa.mjs disconnect`, and revoke it under Connect PC.

Hook files touched: `~/.claude/settings.json`, `~/.codex/hooks.json`, `~/.cursor/hooks.json`. For Cursor only after-the-fact events are used, so the connector can never block an action. Codex asks you to trust new hooks on next start.
