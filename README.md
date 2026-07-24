# PIE

**Personal Intelligent Environment** — a desktop **code agent** for real software work.

Not another chat box: **tasks**, an **execution timeline**, **tool approval**, and **git-aware review** — local-first on your machine.

<p align="center">
  <a href="#screenshots"><strong>Screenshots</strong></a> ·
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#roadmap"><strong>Roadmap</strong></a> ·
  <a href="#quick-start"><strong>Quick start</strong></a>
</p>

---

## Screenshots

### Workspace + chat timeline
Task sidebar, questionnaire / agent turns, and the session rail (model, context, git) — the main loop on one screen.

[![PIE workspace and chat timeline](docs/screenshots/chat-timeline.png)](docs/screenshots/chat-timeline.png)

### Branch graph
Session leaves as a readable tree: forks from edit / resume, tool counts, and switch-back without losing history.

[![Branch graph](docs/screenshots/graph-branch.png)](docs/screenshots/graph-branch.png)

### Context inspector
What actually went to the model — window fill, token totals, session shape, and estimated composition (system / user / tool).

[![Context inspector](docs/screenshots/context.jpg)](docs/screenshots/context.jpg)

---

## Keywords

`code agent` · `AI coding` · `desktop app` · `Electron` · `local-first` · `PI runtime` · `tasks` · `tool approval` · `git review` · `session resume` · `skills` · `xAI` · `OpenAI` · `Anthropic` · `OpenRouter`

---

## Features

What you can use **today** in the desktop app:

### Agent workspace
- **Task sidebar** — group by workspace folder, search, reorder, archive
- **Agent timeline** — user / assistant / tool calls / streaming (not a flat log)
- **Composer** — model + thinking controls, stop / retry / edit last user turn
- **Inspector** — Files · Terminal (shell tool output) · Context (prompt / usage)

### Execution & safety
- Live **tool-call cards** (read, edit, bash, …) with expand / group
- **Tool approval** before gated operations
- **Git-aware** change list and review window
- **Session resume** — reopen a task and continue the PI session

### Conversation structure
- **Fork / switch** session leaves without losing history
- **Branch tree** view for long-running work
- **Questionnaire** turns when the agent needs structured answers

### Skills & paths (early)
- **Extract Skill** from a run (draft `SKILL.md`, you confirm write) — first slice
- Optional **engineering path** playbooks at task create (step card + starters)
- Personal skills via PI (`~/.pi/agent/skills`)

### Platform
- **Local-first** Electron app — data stays on your machine
- **Orbit** UI — calm pale-blue surfaces, dark mode tokens
- Multi-provider models through PI (**xAI / OpenAI / Anthropic / OpenRouter**, …)

---

## Roadmap

Not done yet — don’t treat these as shipping product features:

| Area | Status | Notes |
|------|--------|--------|
| **Subagents** in the desktop product | **TODO** | `@pi-3.14/subagents` package exists; end-to-end product UX (spawn, child tasks, timeline) not finished |
| Skills management UI | **TODO** | Extract is a first slice; browse / attach / organize skills is later |
| Richer workflow engine | **TODO** | Playbooks are lightweight; full automation paths TBD |
| Polished packaging / onboarding | **TODO** | Early product; install & auth UX still evolving |

---

## Quick start

**Requires** Node.js **≥ 22.19** and **pnpm 11.10**.

```sh
pnpm install
pnpm desktop:dev
```

Package a local app:

```sh
pnpm desktop:build
pnpm desktop:package   # dir build
pnpm desktop:dist      # installer (e.g. dmg)
```

Configure model providers the same way as PI (API keys / OAuth in the PI agent environment). Typical env examples: `XAI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.

---

## Packages

| Package | Role |
|---------|------|
| [`@pi-3.14/model`](packages/model) | JSON-safe host contracts & model types |
| [`@pi-3.14/runtime`](packages/runtime) | Embedded & RPC PI hosts, tool approval |
| [`@pi-3.14/session`](packages/session) | Session JSONL parse & analysis |
| [`@pi-3.14/subagents`](packages/subagents) | Subagent orchestration library (**desktop product integration still TODO**) |
| [`@pi-3.14/usage`](packages/usage) | Provider quota / context composition helpers |
| [`pie`](apps/desktop) | Electron + SolidJS + Orbit desktop app |

```sh
pnpm typecheck
pnpm test
pnpm build
```

---

## Architecture (short)

```text
apps/desktop     PIE UI + Electron main / preload / PI host process
packages/*       Shared @pi-3.14 runtime building blocks
```

- **Task** = durable PIE unit of work ↔ one **PI Session**
- PI owns conversation / tools / session files; PIE owns task metadata, layout prefs, and product UX
- Domain language: [`CONTEXT.md`](CONTEXT.md)

More detail: [`apps/desktop/README.md`](apps/desktop/README.md) · [`docs/local-persistence.md`](docs/local-persistence.md)

---

## License

[MIT](LICENSE)
