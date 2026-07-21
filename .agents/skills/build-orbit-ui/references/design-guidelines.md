# Orbit Design Guidelines

## Product character

Orbit is a desktop-first interface for supervising a coding agent. It should feel calm, precise, lightweight, and operational. Use pale blue-gray surfaces, white working areas, fine borders, diffuse shadows, and concentrated cyan-blue actions.

Visual reference: https://cumora.ai/assets/product-screenshot.png

Use the reference for atmosphere and density, not for copied branding or a mandatory page structure.

## Layout

Use the four-zone shell when the workflow needs all four responsibilities:

1. Global rail for product-level navigation.
2. Task sidebar for workspace, search, and sessions.
3. Main workspace for conversation, plans, tool execution, results, and composer.
4. Inspector for changes, diff, terminal, tests, and files.

Keep the main workspace dominant. Start around 68px rail, 240–280px sidebar, flexible main area, and 340–420px inspector. Below 1100px, collapse the inspector before shrinking the main reading area below 430px.

## Visual language

- Use one strong blue action per local region.
- Separate major zones with hairline borders before adding cards.
- Use cards for meaningful units such as plans, tool calls, and results.
- Keep metadata smaller and lower contrast than task content.
- Anchor the composer near the bottom of the main workspace.
- Reserve blue for active, focused, selected, linked, and primary-action states.
- Reserve green, amber, and red for semantic status.
- Use system sans for UI and system mono for code or terminal output.
- Use 8–16px radii for controls and cards; reserve larger radii for the outer shell.
- Keep shadows soft and low contrast.
- Use gradients only for canvas atmosphere, primary actions, selected surfaces, and terminal surfaces.
- Use 120ms motion for hover, 200ms for common transitions, and 320ms for larger state changes.
- Respect `prefers-reduced-motion`.

## Component behavior

- Task rows show state, title, repository, and relative time. Selection uses the selected-surface token, blue-tinted border, and subtle shadow.
- Task headers show execution state, title, repository, branch, and the primary review action.
- Agent timelines distinguish user requests from agent execution without imitating a social chat app.
- Plans show checklist progress. Tool calls show action, result summary, and explicit state.
- Composers use a multiline field with context, model, and send controls, including focused and disabled states.
- Inspectors use tabs when changes, terminal, tests, or preview compete for space.
- Primary buttons use the primary gradient; secondary buttons use a panel surface and border; icon buttons remain quiet until hover or selection.
- Empty states explain the next useful action and provide one CTA. Loading states preserve layout and state what is running.

## Token usage

- Use semantic roles such as `--surface-panel` inside components, not primitive colors such as `--blue-100`.
- Use the 4px spacing scale.
- Add a semantic token before introducing a new visual value.
- Do not create local component shadows, gradients, or theme colors.
- Implement dark mode by overriding semantic tokens.

## Accessibility

- Use native buttons, links, inputs, textareas, and landmarks.
- Give icon-only controls accessible names.
- Keep focus visible with `--shadow-focus` and `--border-focus`.
- Pair status color with text or an icon.
- Maintain WCAG AA contrast for primary reading text in both themes.

## Completion checklist

- The layout supports the main task without unnecessary panels.
- Main content remains readable at the target viewport.
- Components consume semantic tokens and both themes are complete.
- Navigation, selection, inputs, and main actions work.
- Relevant hover, focus, selected, loading, success, error, disabled, and empty states exist.
- Keyboard interaction works for the primary workflow.
- Icon source, spacing, borders, radii, and shadows are consistent.
- No important content or action is clipped.
- Build and relevant tests pass.
