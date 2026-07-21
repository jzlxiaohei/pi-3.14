---
name: build-orbit-ui
description: Design, implement, extend, or review desktop Code Agent interfaces using the Orbit design system. Use for agent workspaces, task and session lists, chat or execution timelines, plans, tool-call states, code diffs, terminals, file inspectors, settings, and related developer-product UI in any frontend framework.
---

# Build Orbit UI

Create calm, compact Code Agent interfaces with pale-blue workspace surfaces, clear execution state, and a single semantic token source.

## Workflow

1. Read `references/design-guidelines.md`.
2. Inspect the target project and reuse compatible components and conventions.
3. Use `assets/tokens.css` as the visual source of truth. Copy it into a new project or map its semantic roles onto an existing token system.
4. Implement the layout appropriate to the task. Treat the four-zone Code Agent shell as a default, not a mandatory template.
5. Use semantic tokens for color, spacing, radius, border, shadow, gradient, motion, and layout values.
6. If a required value is missing, extend the token system before hard-coding it inside a component.
7. Implement the interactions and states needed by the primary workflow.
8. Review the result against the checklist in `references/design-guidelines.md`.

## Rules

- Keep the design system framework-neutral and use the project's existing component architecture.
- Orbit owns the visual language. Do not add a styled kit, theme, or parallel token system.
- Prefer Phosphor or another consistent rounded line-icon library supported by the framework.
- Do not draw substitute icons with CSS, text characters, or handcrafted SVG.
- Reuse existing visual patterns before creating variants.
- Switch themes through semantic token overrides, not component-specific theme selectors.

## Resources

- `assets/tokens.css`: canonical tokens and dark-theme overrides.
- `references/design-guidelines.md`: visual language, layout patterns, component behavior, accessibility, and completion checklist.
