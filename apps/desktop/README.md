# Pi 3.14 Desktop Template

Reusable Electron + SolidJS + Orbit template for code-agent desktop interfaces.

## Stack

- Electron 42 with `contextIsolation`, `sandbox`, and `nodeIntegration: false`
- electron-vite 5 for main, preload, and renderer builds
- electron-builder 26 for local packaging
- SolidJS + `@solidjs/router` + `@tanstack/solid-query`
- Ark UI wrapped behind `src/renderer/src/shared/ui`
- Orbit tokens in `src/renderer/src/styles/tokens.css`
- `lucide-solid` icons

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

## Reusing The Template

1. Keep `shared/ui` as the only place that wraps Ark primitives.
2. Keep product surfaces styled with Orbit tokens.
3. Replace `pages/agent-workspace/model.ts` mock data with real session/runtime data.
4. Move page UI to `features/` only after a second page needs the same capability.
5. Treat `DiffPreview` and `TerminalPreview` as visual placeholders; vet production diff or terminal libraries before adopting them.

## Design Reference

The original static reference is stored at `docs/design-reference/orbit-v1/demo.html`.
It is not production code and is not part of the app build.
