---
name: pi-3-14-usage
description: >
  Project conventions for using PI through the @pi-3.14 wrapper packages. Use
  when writing or reviewing PI runtime hosts, session parsing, subagent
  orchestration, Electron PI integration, tool gating, fork/resume behavior, or
  any code importing @pi-3.14/* or @earendil-works/pi-coding-agent.
---

# PI 3.14 Usage

Use the local `@pi-3.14/*` packages as the application boundary. Do not let app
or feature code depend directly on `@earendil-works/pi-coding-agent` unless you
are maintaining the wrapper packages themselves.

## Package Boundaries

- `@pi-3.14/model`: JSON-safe contracts and shared event/result/model types.
- `@pi-3.14/runtime`: Node-only PI host boundary. Prefer `runtime/embedded` for
  in-process SDK access and `runtime/rpc` when a PI CLI process boundary is
  explicitly needed.
- `@pi-3.14/subagents`: parent/child subagent orchestration, concurrency,
  cancellation propagation, event forwarding, and subagent tool registration.
- `@pi-3.14/session`: read-only PI Session JSONL parsing, context projection,
  analysis, and graph DTOs.

## Default Choices

- App code consumes `PiHost`, JSON-safe events, and package DTOs from
  `@pi-3.14/*`; it should not subscribe to raw SDK events directly.
- Keep official SDK semantics inside `@pi-3.14/runtime` and
  `@pi-3.14/subagents`.
- Use `@pi-3.14/session` for persisted JSONL analysis. Do not reconstruct
  session trees by ad hoc line scanning.
- Use `@pi-3.14/subagents` for concurrent child agents instead of spawning
  unmanaged PI sessions.

## Electron Integration

Electron defaults to embedded PI, but the embedded host must still be isolated
from the renderer and from the main process critical path:

```text
renderer
  -> preload typed bridge
  -> main IPC / runtime manager
  -> utilityProcess or worker
  -> @pi-3.14/runtime/embedded
  -> @earendil-works/pi-coding-agent
```

Rules:

- Renderer never imports `@earendil-works/pi-coding-agent`,
  `@pi-3.14/runtime`, or Node-only modules.
- Preload exposes only narrow, typed IPC. Do not expose raw Electron, Node, PI
  session, or SDK objects.
- Main owns runtime lifecycle and IPC, but long-running agent work should run in
  `utilityProcess`, worker, or another subprocess.
- Keep `sandbox`, `contextIsolation`, and `nodeIntegration: false`. PI needing
  Node access is not a reason to loosen renderer security.
- Window close, session switch, abort, and app shutdown must cancel streams,
  unsubscribe listeners, abort active sessions, and dispose hosts.
- Tool approval fails closed when no interactive UI can answer, the window is
  gone, the session is tearing down, or the request times out.
- Session lifetime belongs to the runtime manager, not to a renderer component.
  Windows are views over resumable sessions.
- Use `runtime/rpc` only as a deliberate fallback or stronger process boundary,
  such as PI CLI compatibility, migration comparison, or out-of-process
  deployment.

## When Maintaining Wrapper Internals

Read [reference.md](reference.md) before changing code that directly imports
`@earendil-works/pi-coding-agent`, maps raw SDK events, resumes/forks sessions,
or gates tool calls.
