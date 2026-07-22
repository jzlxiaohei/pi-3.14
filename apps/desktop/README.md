# PIE

Electron + SolidJS + Orbit desktop app for personal code-agent workflows.

Shared PI runtime packages live under `@pi-3.14/*`.

## Stack

- Electron 42 with `contextIsolation`, `sandbox`, and `nodeIntegration: false`
- electron-vite 5 for main, preload, and renderer builds
- electron-builder 26 for local packaging
- SolidJS + `@solidjs/router` + `@tanstack/solid-query`
- Ark UI wrapped behind `src/renderer/src/shared/ui`
- Orbit tokens in `src/renderer/src/styles/tokens.css`
- `lucide-solid` icons

## Module format policy

With `"type": "module"` and `sandbox: true`, keep these fixed (see `electron.vite.config.ts`):

| Surface | Format | Extension | Rule |
|---------|--------|-----------|------|
| main | ESM | `.js` | default under `"type": "module"` |
| preload | CJS | `.cjs` | sandboxed preload cannot run ESM `import` |
| renderer | Vite ESM | — | avoid CJS-only dependency trees in the browser |

PI host runs in an Electron `utilityProcess` (`src/main/pi/host-process.ts`), forked from main with electron-vite `?modulePath`. Main keeps task store, dialogs, and JSONL timeline projection. Do not guess `.js` / `.mjs` / `.cjs` at runtime for preload or the host entry.

## Development

From the repo root:

```sh
pnpm desktop:dev
pnpm desktop:build
pnpm desktop:package
pnpm desktop:dist
```

Or inside this package:

```sh
pnpm dev
pnpm build
pnpm package
pnpm dist
```

## Directory Guide

```text
src/main/       Electron main process
src/preload/    Narrow contextBridge API
src/renderer/   Solid renderer app
```

Renderer structure:

```text
src/renderer/src/
  app/                 providers and app-wide setup
  pages/agent-workspace/
    model.ts           page-local mock state factory
    route.tsx          route entry
    ui/                page-local shell and product UI
  shared/ui/           reusable Ark/Orbit primitives
  styles/              tokens, base CSS, shared UI CSS, page CSS
```

## Engineering path (optional)

PIE can show a task-level **Engineering path** strip (step N/M + Next/Skip). Progress is
stored on the task and is **not** driven by chat messages.

The strip only pre-fills slash starters (e.g. `/to-spec`). It does **not** ship Matt’s
skills. Without skills in the **current workspace**, Next still advances the strip, but the
model may not recognize those commands.

**Default recommendation: install skills in the project** you open as the task cwd (keeps
dependency explicit and reviewable; PIE does not assume a global PI lifestyle).

In the Engineering path strip, use **安装 skills** → confirm dialog → one-click install.
That path:

1. Clones `mattpocock/skills` engineering set into `{cwd}/.pi/skills/`
2. Marks the project trusted in `~/.pi/agent/trust.json` (PI won’t load `.pi` resources
   without trust on stricter paths)
3. Prefills `/setup-matt-pocock-skills` in the composer (you send it; PIE does not auto-run)

Manual equivalent if you prefer the CLI:

```sh
# in the target project — may prompt for agent targets; PIE’s button writes `.pi/skills` directly
npx skills@latest add mattpocock/skills
```

**Optional:** if you personally use the same Matt set across every repo, you may instead
install on the PI agent globally (`pi install npm:pi-matt-pocock-skills` → `~/.pi/agent`).
That is a power-user choice, not the default docs path.

Upstream skill names evolve. Starters currently match the engineering set
(`/grill-with-docs`, `/to-spec`, …). If a slash 404s, adjust
`pages/agent-workspace/workflow/playbooks.ts` or reinstall.

Engineering path is optional: you can use PIE as a plain chat + Diff Review app without it.

## Conventions

1. Keep `shared/ui` as the only place that wraps Ark primitives.
2. Keep product surfaces styled with Orbit tokens.
3. Replace `pages/agent-workspace/model.ts` mock data with real session/runtime data.
4. Move page UI to `features/` only after a second page needs the same capability.
5. Treat `DiffPreview` and `TerminalPreview` as visual placeholders; vet production diff or terminal libraries before adopting them.

## Design Reference

The original static reference is stored at `docs/design-reference/orbit-v1/demo.html`.
It is not production code and is not part of the app build.
