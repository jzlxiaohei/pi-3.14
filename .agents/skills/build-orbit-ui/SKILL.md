---
name: build-orbit-ui
description: Design, implement, extend, or review desktop Code Agent interfaces using the Orbit design system—including layout, tokens, components, and motion/animation. Use for agent workspaces, task and session lists, chat or execution timelines, plans, tool-call states, code diffs, terminals, file inspectors, settings, hover/focus/open-close transitions, and related developer-product UI in any frontend framework.
---

# Build Orbit UI

Create calm, compact Code Agent interfaces with pale-blue workspace surfaces, clear execution state, and a single semantic token source.

## Workflow

1. Read `references/design-guidelines.md`.
2. If the change adds or adjusts motion (hover, focus, open/close, expand/collapse, enter/exit, loading, streaming), also read `references/motion.md` and follow it before writing CSS/JS animation.
3. If the change uses Dialog, Tooltip, Portal, or other overlays, read `references/pitfalls.md` first.
4. Inspect the target project and reuse compatible components and conventions.
5. Use `assets/tokens.css` as the visual source of truth. Copy it into a new project or map its semantic roles onto an existing token system. In this repo, keep `apps/desktop/src/renderer/src/styles/tokens.css` in sync when extending tokens.
6. Implement the layout appropriate to the task. Treat the four-zone Code Agent shell as a default, not a mandatory template.
7. Use semantic tokens for color, spacing, radius, border, shadow, gradient, motion, and layout values.
8. If a required value is missing, extend the token system before hard-coding it inside a component.
9. Implement the interactions and states needed by the primary workflow.
10. Review against the checklist in `references/design-guidelines.md` and, when motion changed, the checklist in `references/motion.md`.

## Rules

- Keep the design system framework-neutral and use the project's existing component architecture.
- Orbit owns the visual language. Do not add a styled kit, theme, or parallel token system.
- Prefer Phosphor or another consistent rounded line-icon library supported by the framework.
- Do not draw substitute icons with CSS, text characters, or handcrafted SVG.
- Reuse existing visual patterns before creating variants.
- Switch themes through semantic token overrides, not component-specific theme selectors.
- Components must consume **semantic** tokens (`--text-*`, `--surface-*`, `--border-*`, `--action-*`, `--status-*`). Do not use primitive palette tokens (`--ink-*`, `--blue-*`, `--red-100`, raw hex) in page/feature CSS—they do not flip with `[data-theme="dark"]` and break dark mode. If a role is missing, add a semantic token to `tokens.css` first.
- Motion is part of Orbit, not optional polish: use `--duration-fast` / `--duration-base` / `--ease-standard`; no `transition: all`, zoom bounce, or spring. Details in `references/motion.md`.

## Resources

- `assets/tokens.css`: canonical tokens and dark-theme overrides.
- `references/design-guidelines.md`: visual language, layout patterns, component behavior, accessibility, and completion checklist.
- `references/motion.md`: required motion/animation rules for UI transitions and status signals.
- `references/pitfalls.md`: traffic-light hit targets, Dialog/Select/Tooltip Portal stacking, Solid composition traps.
