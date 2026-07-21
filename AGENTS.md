# Frontend constraints

For all new or modified frontend work:

- Architecture and component boundaries: $frontend-page-architecture
- SolidJS client state: $solidjs-state-management
- Product UI and tokens: $build-orbit-ui
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
