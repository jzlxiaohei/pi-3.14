# Orbit Motion

Use motion only to communicate state. Prefer stillness. Paper does not bounce.

## When this applies

Any new or changed UI that adds hover, focus, open/close, expand/collapse, enter/exit, loading, or streaming indicators.

## Tokens (required)

| Role | Token | Value |
|------|--------|--------|
| Hover / color | `--duration-fast` | 120ms |
| Panel / overlay | `--duration-base` | 180ms |
| Slightly longer UI | `--duration-normal` | 200ms |
| Rare large shift | `--duration-slow` | 320ms |
| Easing | `--ease-standard` | `cubic-bezier(.2, 0, 0, 1)` |

Do not invent new durations or easings in components. Extend `assets/tokens.css` (and the app `tokens.css`) first if a new semantic role is truly needed.

## Rules

1. **Quiet fade, no bounce.** Overlays and menus: `opacity` fade, optional ≤2px `translate` slide. Ban zoom scale-pop, spring, and overshoot.
2. **Short.** Prefer fast/base. Avoid 300ms+ decorative motion.
3. **Name properties.** Never `transition: all`. List only what changes, e.g. `color`, `background`, `border-color`, `box-shadow`, `opacity`, `transform`, `width` / `flex-basis`.
4. **State, not decoration.** Motion marks open/close, selection, running, streaming. Do not animate for flourish.
5. **Running signals.** Agent/work-in-progress may use a calm breathe/pulse. Prefer that over a decorative spinner for agent execution; reserve spinners for plain data loading.
6. **Reduced motion.** Rely on the app global `@media (prefers-reduced-motion: reduce)` base rule. Do not add one-off reduced-motion blocks unless a custom animation bypasses transitions.

## Patterns

```css
/* Hover / color */
transition:
  color var(--duration-fast) var(--ease-standard),
  background var(--duration-fast) var(--ease-standard);

/* Panel width + fade */
transition:
  width var(--duration-base) var(--ease-standard),
  flex-basis var(--duration-base) var(--ease-standard),
  opacity var(--duration-fast) var(--ease-standard);
```

Keep panels mounted when animating open/close (toggle `data-open` + width/opacity). Avoid mount/unmount `Show` if you need a transition.

## Checklist

- [ ] Uses `--duration-*` and `--ease-standard` only
- [ ] No `transition: all`, zoom bounce, or spring
- [ ] Duration matches interaction class (fast vs base)
- [ ] Motion explains a state change
- [ ] Still acceptable under reduced-motion (global base covers transitions)
