---
name: solidjs-state-management
description: >
  SolidJS client-state conventions using factory functions, composition, Context, signals,
  stores, and memos. Use when writing or reviewing SolidJS pages, components, page/feature
  state, viewmodels, or domain logic—not only when state management is explicitly requested
  （Solid 状态、factory、信号、领域对象）.
---

# SolidJS State Management

## Scope

This skill covers client-owned component, page, feature, and app state.

- Server/async state belongs in `@tanstack/solid-query`; do not mirror it into a client store.
- Shareable/bookmarkable state belongs in `@solidjs/router`.
- Directory and ownership boundaries follow `frontend-page-architecture`.
- Visual behavior and components are outside this skill.

## Default Pattern

Co-locate related state and behavior in a factory. Keep components focused on rendering and orchestration.

```ts
import { createSignal } from "solid-js"

function createTodo(initialText: string) {
  const [text, setText] = createSignal(initialText)
  const [done, setDone] = createSignal(false)

  return {
    text,
    done,
    update(value: string) { setText(value) },
    toggle() { setDone(value => !value) },
  }
}
```

- Prefer factories and composition over classes and inheritance.
- Expose accessors by default: they remain reactive when destructured or composed with object spread.
- Use small `withX()` factories when behavior genuinely repeats; compose their accessors and methods.
- Keep deterministic transforms as plain functions.
- Use a plain derived accessor for cheap calculations; use `createMemo` when work is expensive, read repeatedly, or equality should shield downstream updates.
- Do not synchronize derived state with `createEffect` plus another signal.

## Reactive Ownership

Create page/feature factories under a Solid owner so owned computations and cleanup follow the UI lifetime:

- Component or Provider body for page/feature state.
- `createRoot` for an intentional singleton that creates memos, effects, or cleanup; retain and manage its disposer.

- Signals and stores do not require an owner. Module-level signals/stores are allowed only as intentional client-wide singletons.
- Never keep request- or user-specific state in a module singleton during SSR.
- Memos, effects, context lookup, and cleanup do depend on owner/lifetime semantics.

## Reactive Access

Accessors are safe to destructure and compose:

```ts
const { text } = todo
text() // tracked when read in JSX, createMemo, createEffect, etc.
```

An accessor only establishes a dependency when called inside a tracking scope. Reading it at component initialization produces no subscription.

Property getters are an optional domain-object style:

```ts
return {
  get text() { return text() },
}
```

Getter-backed fields stay reactive when read through the object inside a tracking scope, but destructuring or object spread evaluates them immediately and copies a snapshot. Do not destructure or spread getter-backed objects. Reactive props and store fields have the same destructuring hazard: use `splitProps` for props, or preserve direct property/accessor reads.

## Signal, Store, and Context

- Use `createSignal` inside a factory for small independent values.
- Use `createStore` inside a factory for nested object state with independently updated fields.
- Create the factory once in a Provider and expose it through Context when a subtree shares it.
- Throw a clear error when a required context is missing; do not use a non-null assertion.
- Do not add another global state library unless project constraints justify it.

## State Placement

| State | Owner |
|---|---|
| Input draft, open/hover state | Component |
| Related client business state | Page/feature factory |
| Cross-subtree client state | Factory + Context |
| Derived reactive display data | Derived accessor, `createMemo`, or viewmodel |
| Server data and mutations | solid-query |
| Filters, tabs, selected IDs that belong in links | router |

## Anti-patterns

- Many related signals and business handlers scattered through a component.
- Copying query results into a factory for convenient access.
- Module-level reactive state with an accidental process lifetime.
- Destructuring reactive fields and silently losing tracking.
- Putting page-specific state in a global store.
- Creating a factory, context, or viewmodel for trivial local state.

## Delivery Check

- State has the smallest durable owner.
- Related client state and behavior are grouped coherently.
- Server and URL state are not duplicated.
- Reactive values retain tracking and have a correct disposal lifetime.
