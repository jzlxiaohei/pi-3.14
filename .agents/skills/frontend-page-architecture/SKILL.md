---
name: frontend-page-architecture
description: >
  Framework-agnostic, page-first frontend architecture covering directory boundaries, state
  ownership, API/query placement, viewmodels, component reuse, and build-vs-adopt decisions.
  Use when adding, refactoring, or reviewing pages, routes, features, API/query code, state
  ownership, derived data, or component structure（组件抽象、自研还是用库、前端架构、目录结构）.
---

# Frontend Page Architecture

Build frontend code around the nearest useful business boundary. Prefer page-local code by default, extract feature/shared modules only when real reuse or complexity justifies it, and keep server state, URL state, client state, and view-local state separate.

## First Pass

Before changing code:

- Inspect `agent.md`, `package.json`, routes, query providers, page folders, tests, and existing shared UI.
- Follow the repo's established patterns when they are coherent. Use this skill to fill gaps, prevent over-globalization, and resolve unclear boundaries.
- Use the stack and related skills pinned by the project. Do not assume a framework, store, styled UI kit, or second design system.

## Directory Strategy

Use page-first structure as the default:

```text
src/
  app/       providers, router, app shell, app-wide setup
  pages/     default business boundaries
  shared/    truly cross-page reusable code
```

Keep a page self-contained while it is local to that route:

```text
src/pages/project-detail/
  route.tsx
  api.ts
  queries.ts
  state.ts
  model.ts
  viewmodel.ts
  ui/
  __tests__/
```

Use `features/` only when a page boundary is too coarse or one capability is used by multiple pages:

```text
src/
  app/
  pages/
  features/
  shared/
```

Promotion ladder:

1. Keep code inside the component if it is tiny and purely local.
2. Move code into the page folder when multiple components in the same page need it.
3. Move code into `features/` when multiple pages share the same business capability.
4. Move code into `shared/` only when it is domain-neutral or broadly reused.
5. Move code into a package only when independent versioning or cross-repo reuse is real.

Do not create global folders such as `api/`, `query/`, `store/`, `viewmodel/`, or `ui/` for every new concept by default. Create global/shared areas only when the reuse is already visible. Exception: the shared UI primitive layer (see Component Strategy).

## State Ownership

Choose the smallest durable owner for state:

- Component state: draft input, hover/open state, ephemeral display toggles, uncontrolled UI details that no other module reads.
- URL state: tab, filters, sorting, pagination, search, selected IDs, and other state that should be shareable, bookmarkable, or back/forward aware.
- Server/async cache (project query client): server state, loading, error, retry, caching, invalidation, optimistic mutation coordination, and background refresh.
- Page/feature state: client-only business state shared by multiple components inside one page or feature.
- Global app state: authentication/session shell, app-level preferences, cross-feature workflow state, and state that truly spans multiple business areas.

Rules:

- Do not mirror server data into a client store just to make it easier to access. Read it from the query client.
- Do not put business state in a presentational component if sibling or descendant components depend on it.
- Do not add a global store for a single page. Start page-local, then promote when cross-page use appears.
- Use the project's framework-state conventions when related fields form one domain concept.

## Data And API

Keep network access out of UI components.

- Components must not call `fetch` or axios directly.
- Put shared HTTP infrastructure in `shared/api/` only when needed: base URL handling, auth headers, error normalization, request helpers.
- Keep concrete endpoint functions and query helpers inside the owning page/feature while they have one owner.
- Promote endpoint functions or query helpers to `features/` or `shared/` only when multiple pages use them.
- Type DTOs at the network boundary. Prefer `unknown` plus narrowing/parsing over `any`.
- Use stable query keys, colocated near query helpers or in a local query key factory when a page/feature has several related queries.
- Mutations should invalidate or update the minimal relevant query keys. Avoid broad invalidation unless the domain really requires it.

## Derived Data And Viewmodels

Use a viewmodel or model helper when it removes meaningful render complexity:

- Combine query results, URL/page state, and derived display data in a page-local model/viewmodel.
- Move filtering, grouping, sorting, parsing, permission shaping, and display-specific aggregation out of JSX when it becomes non-trivial.
- Keep simple `.map()` rendering in components. Do not create a viewmodel for every small component.
- Prefer pure helpers for deterministic transformations; use framework-reactive units only for live inputs.

## Components

- Keep route/page entry files thin: read params/search state, call page-level models, and compose UI.
- Separate container behavior from reusable presentation when it improves readability or testability.
- Keep components cohesive. Around 150 lines is a useful smell, not a hard limit.
- Handle loading, error, empty, disabled, and optimistic states where the user can encounter them.
- Do not duplicate an established primitive or meaningful business logic. Small incidental markup may stay local until a reusable boundary appears.

## Component Strategy

Three tiers, three different rules. This section is the exception to the general promotion ladder above.

### 1. Generic primitives: abstract early

For genuinely generic, cross-page UI vocabulary (button, input, select, modal/dialog, tooltip, table, tabs, card, toast, form field, etc.), abstract into the shared UI layer proactively — do NOT wait for a second consumer. This is the one deliberate exception to the "promote only after real reuse" rule.

- Put them in the shared UI layer (e.g. `src/shared/ui/`).
- Keep them presentational and prop-driven: no page-specific business logic, no direct data fetching.
- Wrap the project's headless primitives and visual tokens behind `shared/ui`; page/feature code consumes those wrappers.

### 2. Page-specific components: stay local

If a component encodes one page's layout/behavior and reuse is not yet obvious, keep it under that page's `ui/` folder. Do not globalize speculatively. When unsure whether something is a "generic primitive" or "page-specific", keep it local and promote when a second real consumer appears.

When meaningful markup or behavior repeats, extract page-locally first, then promote when use becomes cross-page.

### 3. Large/complex widgets: adopt a mature library first

For large or complex widgets, do NOT hand-build from scratch first. Examples: code review / diff viewer, rich text / markdown editor, data grid / virtualized table, charts, calendar / scheduler, date-time picker, drag-and-drop, file uploader, code editor.

- Vet candidates with the `dependency-vetting` skill before adopting: prefer mature, maintained, widely-adopted, well-typed libraries; respect its hard gates (license, maintenance, security, bus factor).
- Only build in-house when vetting shows no suitable library, or the fit/constraints clearly justify it. State the reason.
- Wrap the chosen library behind a thin project component so the rest of the app depends on our API, not the library directly.

## Testing And Refactoring

- Prefer tests at the same boundary as the behavior: pure transform tests for model/viewmodel helpers, component tests for interaction, route/page tests for integrated flows.
- Keep page-local tests beside the page or feature. Promote shared test helpers only after repetition is real.
- When changing shared code, search for every consumer and run the smallest meaningful test set plus any affected broader checks.

## Delivery Checklist

Before finishing frontend work:

- Page/feature code is self-contained unless reuse is real.
- Established primitives and meaningful logic are not duplicated.
- Generic primitives live in `shared/ui`; page-specific components stay local.
- Complex widgets use a vetted library behind a project wrapper unless building in-house is justified.
- No raw network calls in components.
- State ownership is explicit; server data is not mirrored into client stores.
- Complex derived data is outside JSX.
- Loading, error, empty, disabled, and success states are handled.
- Tests or manual verification match the risk of the change.
