# Orbit UI Pitfalls

## macOS traffic lights cover Dialog / Review chrome

Near-fullscreen Dialogs (and `hiddenInset` windows) sit under the system traffic lights. Controls in the **top-left** look missing or “won’t open” because clicks hit the native buttons, not the trigger.

**Confirmed case:** Review `branch → base` Select was under lights at `trafficLightPosition: { x: 16, y: 18 }`. Inflating header padding fixed hit-testing but looked broken.

**Do**

- **Dialog-hosted Review:** offset the modal below the titlebar (`positioner` `padding-top: var(--topbar-height)`, shorter height). Keep **normal** header padding inside the modal.
- **Standalone `#/review` window:** header keeps left inset (~`78px`) for that window’s own traffic lights.
- Before blaming Select/Portal/z-index: check whether the trigger clears the lights.

**Verify**

Modal top edge is below the titlebar; header padding looks even; Select opens normally.

## Overlay stacking (Dialog + Select / Menu / Tooltip)

Still follow Ark/Zag nesting rules so portalled layers aren’t *under* the Dialog — but “no dropdown” in Review was **not** this; it was traffic lights.

Ark/Zag: one shared base z-index; nest with `--layer-index`. Positioner uses *inline* `z-index: var(--z-index)` synced from **Content**’s computed z-index — set z-index on Content, not only on Positioner.

**Also**

1. Prefer Ark Select/Menu + Portal inside Dialog; hand-rolled absolute menus get clipped by `overflow: hidden` / modal pointer blocking.
2. Until placement runs, floating styles may sit off-screen (`translate3d(0, -100vh, 0)`); don’t default Content to `opacity: 0` or it looks never-open.
3. Solid `asChild`: pass props via `props()` onto `ark.span` / `ark.div`.
4. Do not “fix” visibility with Dialog `modal={false}` (clicks fall through the overlay).
5. Keep `document.documentElement.dataset.theme` for portalled surfaces.

```css
.orbit-dialog__content {
  z-index: calc(var(--z-modal) + var(--layer-index, 0));
}
.orbit-dialog__positioner {
  z-index: var(--z-index, var(--z-modal));
}
.orbit-dialog__backdrop {
  z-index: calc(var(--z-index, var(--z-modal)) - 1);
}
.orbit-select__content,
.orbit-tooltip__content,
.orbit-popover__content {
  z-index: calc(var(--z-modal) + var(--layer-index, 0));
}
```

Wrappers: `shared/ui/dialog.tsx`, `shared/ui/select.tsx`, `shared/ui/tooltip.tsx`, `shared/ui/popover.tsx`.

## Tooltip placement notes

- Prefer `placement: "top"` for dense lists (paths, rows).
- Style tooltip content visible when mounted; let Ark `hidden` / presence handle closed state.
