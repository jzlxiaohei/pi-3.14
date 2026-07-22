# Coding preferences

- Avoid over-defensive programming. Handle inputs and states that can occur on normal product paths. Do not re-check invariants already guaranteed by the runtime, types, or trusted internal callers. Skip DevTools / tampered-request / handcrafted-type attack cases on the frontend. Add validation only for untrusted external input, permission boundaries, irreversible actions, or failures that would cause clear data loss.
- Do not add tests by default while the product is still in early flux. Prefer typecheck and manual verification. Only add or update tests when explicitly asked, or when changing stable pure contract/parsing logic in `@pi-3.14/*` that can break silently.

# Frontend constraints

For all new or modified frontend work:

- Architecture and component boundaries: $frontend-page-architecture
- SolidJS client state: $solidjs-state-management
- Product UI, tokens, and motion: $build-orbit-ui (read `references/motion.md` when adding hover/open/close/expand/loading transitions; component CSS must use semantic tokens so dark mode works)
- Dependency decisions: $dependency-vetting

Default stack; change only through an explicit project decision:

- Vite + SolidJS + TypeScript
- Routing: `@solidjs/router`
- Server/async state: `@tanstack/solid-query`
- Headless UI primitives: `@ark-ui/solid`
- Visual system: Orbit tokens only
- Page/feature code consumes Orbit-styled `shared/ui` wrappers, not raw Ark primitives

# PI runtime constraints

For PI runtime, session, subagent, Electron integration, or tool-gating work:

- PI package boundaries and Electron embedding: $pi-3-14-usage
