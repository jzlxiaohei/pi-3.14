---
status: accepted
---

# Session Map v1

Executable specification for **Session Map**: a professional, Orbit-native visualization of a PI Session’s in-file entry tree, with a linked **context projection** panel that answers “what would the model see if this leaf were active?”

Aligns with [`CONTEXT.md`](../../CONTEXT.md), [`packages/session/README.md`](../../packages/session/README.md), and the existing Branches / Timeline / Context Inspector surfaces. Does **not** redefine Task / Agent ownership; it visualizes the **Active Agent’s PI Session** only.

Unreleased product: additive UI + IPC is OK. **Do not delete or rewrite PI Session JSONL.**

## Problem Statement

PI Sessions are **trees** (`id` / `parentId` per entry). PIE’s primary chat UI correctly shows a **linear timeline** of the **active path**, and the **Branches** dialog shows a **coarse** flow (user / turn summary / compaction) for navigation. Neither is a faithful, teachable map of JSONL structure, and neither makes the PI context rule obvious:

> For a chosen leaf, model-facing history is the **root → leaf path**, after **compaction** folding—not the union of sibling branches, and not the whole file.

Users (and implementers) need:

1. A **structure map** of the session tree that remains readable on long sessions.
2. An explicit **context-for-selection** view: path, effective messages, compaction exclusions, and JSONL gaps (system / tools / skills).
3. Clear separation from **Chat timeline** (work surface) and **Branches** (fast fork switch).
4. Visual quality at **product** standard (Orbit tokens, hierarchy, density)—not an engineering dagre sketch.

Hand-rolled Branch canvas already uses `@dagrejs/dagre` + custom pan/zoom. “Not professional” is primarily **information architecture + visual system**, not the absence of React Flow. v1 **does not** introduce a heavy graph framework (Cytoscape / XYFlow). Layout stays **dagre** (or drop-in ELK later if needed); rendering is **custom Orbit HTML/SVG** shared with a refactored graph canvas primitive.

## Solution

Add **Session Map** as a first-class workspace surface for the Active Agent’s open PI Session:

| Layer | Behavior |
|---|---|
| **Entry** | Chat chrome control (same family as Branches): opens a **large dialog / slide-over** titled Session Map. Does **not** replace the main chat route. |
| **Layout** | **Two panes**: left **Structure map**, right **Selection detail** (context projection + actions). |
| **Default density** | **Turn** aggregation (readable). Optional **Entry** density for JSONL truth. |
| **Data** | Main builds structure + analysis from session file via `@pi-3.14/session`; selection computes `buildPiContextProjection(snapshot, leafId)` for a resolved leaf. |
| **Selection** | Click map node → detail pane updates (**preview** by default). Explicit **Switch to this branch** navigates the live host leaf (same family as Branches). |
| **Live sync** | While open, refresh on session inspect token / turn end; selection preserved by entry id when still present. |
| **Tech** | No new heavy graph dependency in v1. Extract reusable canvas (viewport, edges, fit) from Branches; Session Map owns denser nodes + dual pane. |

## Glossary (product + PI)

Use these terms in UI copy and code comments:

| Term | Meaning |
|---|---|
| **Session Map** | This surface: structure + context projection for one PI Session. |
| **Entry** | One JSONL record with `id` / `parentId` (message, compaction, model_change, …). |
| **Active path** | Entries from session root(s) down to the **current live leaf** (host-navigated). |
| **Selected node** | Map focus for the detail pane; may be off the active path. |
| **Resolved leaf** | The leaf used for context projection for the current selection (see [Selection → leaf resolution](#selection--leaf-resolution)). |
| **Path** | `root → … → resolved leaf` via `parentId` (chronological after reverse-walk). |
| **Effective context** | Path after compaction rules (`buildPiContextProjection`); this is what JSONL can prove about model history. |
| **Excluded by compaction** | Path entries not in `effectiveEntryIds`. |
| **Sibling / side branch** | Entries not on the active path (or not on the selected path). Never part of that leaf’s model history. |
| **Turn (map unit)** | Product aggregation: a **user** entry plus the contiguous non-user descendants on the same parent-chain until the next user (or branch) — see [Turn aggregation](#turn-aggregation). |
| **Branches (existing)** | Coarse fork navigator. Remains; Session Map does not replace it. |
| **Chat timeline** | Linear messages for the **active path only**. Unchanged as primary work surface. |

### PI facts implementers must honor

1. **Tree storage, path context.** Context for a leaf = ancestors + self, not siblings.
2. **Compaction.** Latest compaction on the path folds earlier messages per `firstKeptEntryId`; UI must show both path-full intent and effective set.
3. **Leaf is runtime state.** JSONL has no durable leaf pointer; parse `leafId` is often “last entry”. Live leaf comes from host / navigate. Map **active path** must use **live** leaf when host is open.
4. **Unavailable from JSONL.** `systemPrompt`, `tools`, `skills` are not reconstructible from the file alone. Detail pane must say so and optionally append **live** inspect when available.
5. **Cross-session.** `header.parentSession` is a file path, not stable lineage. v1 **does not** draw multi-session graphs.
6. **Entry ≠ one API message.** Compaction / branch_summary become summary roles; tool calls may be nested in assistant entries. Detail lists **effective messages**, map nodes are **entries or turns**.

## User Stories

### Discoverability & framing

1. As a PIE user, I want a Session Map control near Branches, so that I can open structure without hunting settings.
2. As a PIE user, I want Session Map labeled so I understand it is the session tree / model path tool—not a second chat.
3. As a PIE user, I want a one-line legend (active path / side branch / compaction / effective), so that the map is self-explanatory.
4. As a PIE user, I want Chinese primary chrome consistent with nearby desktop copy, so that the surface matches the shell.

### Structure map

5. As a PIE user, I want the full in-session branch structure visible (not only the active path), so that edit/fork history is understandable.
6. As a PIE user, I want the **active path** strongly highlighted, so that I see what chat is currently following.
7. As a PIE user, I want **side branches** visually de-emphasized (not deleted), so that I know they exist but are not in current context.
8. As a PIE user, I want **fork parents** marked when a node has multiple children, so that branch points are obvious.
9. As a PIE user, I want **compaction** nodes distinct, so that I see where history was summarized.
10. As a PIE user, I want default **Turn** density, so that long sessions stay scannable.
11. As a PIE user, I want to switch to **Entry** density, so that I can audit raw JSONL nodes when debugging.
12. As a PIE user, I want pan / zoom / fit-to-view, so that large trees remain usable.
13. As a PIE user, I want keyboard focus and click selection with visible selected state, so that the map feels product-grade.

### Context for selection

14. As a PIE user, I want selecting a node to show the **resolved leaf** and **path length**, so that I know what projection I am inspecting.
15. As a PIE user, I want a ordered list of **path entries** (or turns), so that “ancestors + self” is concrete.
16. As a PIE user, I want **effective messages** listed (role + truncated text + tool summary), so that I see JSONL-recoverable model history.
17. As a PIE user, I want entries **excluded by compaction** called out, so that I understand path ≠ what the model still sees.
18. As a PIE user, I want an explicit callout that **system / tools / skills** are live-only, so that I do not think JSONL is the full request.
19. As a PIE user, when the host is ready, I want optional **live** system / skills / tools summary in the same pane, so that “full request shape” is available without leaving Map.
20. As a PIE user, I want model + thinking level resolved on the path, so that runtime state from JSONL is visible.

### Navigation actions

21. As a PIE user, I want selection to **preview** by default without changing chat leaf, so that exploring history is safe.
22. As a PIE user, I want **Switch to this branch** when the selection’s resolved leaf is not the live leaf, so that I can continue chatting there (same semantics as Branches switch).
23. As a PIE user, I want **Scroll in chat** when the selection maps to a timeline message on the **current** active path, so that map and timeline stay linked.
24. As a PIE user, I want Switch disabled/explained when the session host is unavailable or busy in a way that blocks navigate, so that I do not get silent no-ops.

### Quality & trust

25. As a PIE user, I want diagnostics from parse/projection surfaced when present (missing parent, bad compaction anchor), so that corrupt tails are not silent.
26. As a PIE user, I want empty / loading / error states that match Orbit patterns, so that the surface never feels broken without copy.
27. As an implementer, I want all tree/context math in `@pi-3.14/session` (or thin main adapters), so that the renderer does not re-implement parent walks.
28. As an implementer, I want package boundaries preserved (renderer → preload → main → session package), so that filesystem stays main-side.
29. As an implementer, I want no React Flow / Cytoscape in v1, so that Orbit ownership and Solid stack stay clean.

## Implementation Decisions

### Surface & chrome

1. **Host:** Modal dialog (preferred) or right slide-over **≥ 960px** wide content area when viewport allows; on narrow widths stack panes vertically (map on top, detail below). Reuse `Dialog` primitive; new size class e.g. `orbit-dialog__content--session-map`.
2. **Open control:** Agent workspace **chat header** (same strip as Branches / session chrome—not Rail, not sidebar). Icon + label **Session Map** (中文 UI: **会话图**). Tooltip: explains tree + model path.
3. **Close:** Esc / header close; does not navigate away from Task/Agent.
4. **Scope:** Always the **Active Agent**’s bound session. If no host / unavailable session → empty state with reason (same family as timeline unavailable).
5. **Not a Rail primary page.** Unlike Templates/Paths, Map does not replace the workspace route.

### Relationship to other surfaces

| Surface | Role after Session Map ships |
|---|---|
| **Chat timeline** | Primary work. Still **active-path only**. Map does not embed full chat. |
| **Branches** | Keep. Coarse fork switch + short labels. May later deep-link “Open in Session Map” (optional v1.1). |
| **Context Inspector** | Live assembled prompt / wire / usage. Map’s detail is **JSONL path projection** + optional live summary—not a second full wire dump. |
| **Fork banner** | Unchanged; Map is complementary education + power tool. |

Do **not** remove Branches in v1. Do **not** merge Map into the small Branches dialog.

### Architecture

```text
@pi-3.14/session
  parse / index / buildStructureGraph / buildPiContextProjection / analyze…
        ↑
main (runtime-manager / inspect extension or dedicated session-map IPC)
  snapshot + live leaf id + optional live hud fields
        ↑
preload contracts
        ↑
renderer Session Map UI
  structure view-model (turn aggregation)
  dagre layout
  canvas (shared primitive)
  detail pane (context projection VM)
```

6. **Source of truth for structure:** `parsePiSessionJsonl` / `readPiSessionFile` snapshot of the Agent’s `sessionPath`.
7. **Active path:** Resolve with **live leaf entry id** from host when available; fall back to snapshot `leafId` only when host cannot provide leaf.
8. **Projection for selection:** Always `buildPiContextProjection(snapshot, resolvedLeafId)` in main or pure package call from a main-built payload. Renderer must not re-walk parents for truth.
9. **Optional live HUD:** When host ready, detail may request `inspect({ detail: "summary" })` (or existing light inspect) for system/skills/tools **counts and names only**—never block map open on full transcript convert.

### IPC / contracts

10. Prefer **extend** session inspect **or** add dedicated:

```ts
// Conceptual contract — names may match existing inspect shape
type PiSessionMapSnapshot = {
  sessionId: string | null;
  sessionPath: string | null;
  liveLeafId: string | null;
  /** Structure for map; entry-granularity nodes + parent edges. */
  structure: PiSessionGraph; // projection: "structure"
  analysis: {
    branchPointCount: number;
    entryCount: number;
    messageCount: number;
    compactionCount: number;
  };
  diagnostics: PiSessionDiagnostic[];
};

type PiSessionMapContextRequest = {
  /** Entry id selected on the map (turn root or entry). */
  selectionEntryId: string;
};

type PiSessionMapContextResult = {
  selectionEntryId: string;
  resolvedLeafId: string;
  projection: PiContextProjection;
  /** True when resolvedLeafId === liveLeafId */
  isLiveLeaf: boolean;
};
```

11. **Context on demand:** Detail pane loads projection when selection changes (debounce ≤ 50ms). Do not ship full effective message bodies for every node in the initial map payload.
12. **Switch branch:** Reuse existing `navigateTree` / session navigate IPC; Map does not invent a second navigation protocol.
13. **Payload size:** Structure nodes must **not** embed full `raw` message content. Labels/previews ≤ fixed char budget (e.g. 120). Full text only in context result messages (and still truncatable in UI with expand).

### Turn aggregation

Default density **Turn**. Algorithm (normative):

14. Consider only **map-eligible** entries for turn bodies:  
    `user` | `assistant` | `toolResult` | `compaction` | `branch_summary` | `custom_message`.  
    Pure metadata (`model_change`, `thinking_level_change`, `label`, `session_info`, `custom` without message) is:
    - **Entry density:** shown as small metadata nodes on the parent edge chain.
    - **Turn density:** **folded** into the nearest following turn node as a badge count (or omitted from geometry if zero user-facing impact). Prefer badge “+N meta” on the turn when any folded.
15. **Turn root:** every `user` message entry starts a turn node `turn:{userEntryId}`.
16. **Turn members:** walk the unique child chain while there is a single primary continuation; include assistant / toolResult / custom_message / branch_summary / compaction that lie on paths descending from that user **until** the next user entry that is a descendant-or-sibling branch root.  
    Practical v1 rule used by layout:

    - Build the entry tree via `parentId`.
    - A **turn node** is created for each `user` entry.
    - Non-user map-eligible entries are **assigned** to the nearest ancestor `user` on their path; if none, they become standalone nodes (e.g. leading compaction).
    - **Layout edges (Turn mode):**
      - Edge from turn A → turn B if B’s user entry’s parent chain first hits A’s user entry (B is a user-child branch of A’s subtree) **or** B’s user `parentId` chain reaches a member of turn A and B is a direct user fork under that region.
      - Simpler acceptable v1: layout graph = **user entries only** as nodes; each user node’s parent is the nearest ancestor user (or null). Non-user entries appear only inside the node chrome (counts, last assistant preview). Compaction between users: attach as a **child chip** on the parent user or a thin compaction node on the edge.

17. **Fork geometry in Turn mode:** If a user entry has multiple user-descendant branches (multiple child users with that user as nearest ancestor user), draw multiple child edges—this is the edit/fork UX users care about.
18. **Entry density:** One node per map-eligible entry (+ metadata if toggle “Show metadata” on). Parent edges = JSONL `parentId`. Active path stroke on edges whose both ends are on active path.
19. **Toggle:** Segmented control **回合 / 条目** (Turn / Entry). **v1 does not persist** density preference; each open defaults to **Turn**.

### Selection → leaf resolution

When the user selects map node N:

20. If N is an **entry** node: `selectionEntryId = N.entryId`.
21. If N is a **turn** node: `selectionEntryId = turn’s user entry id` (stable).
22. **`resolvedLeafId`** for projection:
    - Default: **deepest entry on the active path that is in the subtree of `selectionEntryId`**, if that subtree intersects the active path.
    - Else: **a canonical leaf of the subtree**—the leaf with maximum append-index (or max timestamp) among descendants of `selectionEntryId`, including itself. This matches “inspect this branch tip.”
    - Never use a sibling outside the subtree.
23. Detail pane header shows: selection label, `resolvedLeafId` short id, badges: `当前分支` if `resolvedLeafId === liveLeafId`, else `预览`.
24. Changing selection does **not** call `navigateTree` until the user clicks **切换到此分支**.

### Selection detail pane (normative sections)

Order top → bottom:

1. **Header** — kind, title, time, badges (active path / side / live / preview).
2. **Actions** — `切换到此分支` (if not live leaf), `在对话中定位` (if on active path and timeline can scroll), secondary `复制 entry id`.
3. **Path** — ordered list root → leaf (entry id + kind + one-line preview). Highlight selection. Mark compaction-excluded with muted style + tag `已压缩排除`.
4. **Effective messages** — from projection `messages` (role, text clamp, tool names). Empty state if none.
5. **Compaction** — if `latestCompaction`, show entry id + `firstKeptEntryId` + tokensBefore when known.
6. **Runtime from JSONL** — model, thinking level.
7. **Not in JSONL** — fixed callout: system prompt / tools / skills. If live summary present, show collapsible lists (names only).
8. **Diagnostics** — projection + snapshot diagnostics filtered to path when possible.

### Structure map visual system (quality bar)

These are acceptance criteria, not suggestions:

25. **Layout:** TB dagre; `nodesep` / `ranksep` tuned for Turn cards (~240×88) and Entry chips (~200×56). Shared layout helper module (generalize `branches-flow-layout.ts`).
26. **Viewport:** pan (pointer), zoom (wheel, clamp), fit on open and on density toggle, “Fit” button, **minimap** (see below). Do not lose selection off-screen without a “Reveal selection” affordance.
26a. **Minimap (required in v1):** Small overview in a map-chrome corner (default bottom-right). Shows full laid-out graph bounds, a viewport rectangle, and enough contrast to distinguish active-path stroke vs side branches at overview scale. Interactions: drag the viewport rect (or click minimap) to pan the main view; optional wheel-zoom on minimap may no-op (main canvas owns zoom). Minimap must use the same semantic tokens (not a third palette). Hide minimap only when node count is 0.
27. **Edges:**
    - Active path: solid, higher contrast token (`--action-primary` mix or dedicated `--session-map-path`).
    - Side: muted dashed or low-opacity solid.
    - Orthogonal or smoothstep **consistent** with Branches refactor (pick one system for both).
28. **Nodes (Turn):**
    - Left kind bar (user accent).
    - Title: user preview (single line).
    - Subtitle: `assistant · tools · N` counts; error badge if any tool/assistant error in members.
    - Path state: full opacity + path ring if any member on active path; else muted.
    - Fork: small badge with child count when >1 user-child.
29. **Nodes (Entry):**
    - Kind color + icon (user / assistant / tool / compaction / meta).
    - Label from package `entryLabel` rules; mono short id on hover.
30. **Selected:** clear focus ring; not the same as path highlight (path = blue/teal continuum; selection = stronger ring / elevation).
31. **Legend:** compact, always visible in map chrome footer or header.
32. **Performance:** target **≤ 500** visible layout nodes without jank on desktop mid hardware. If entry count > 500, default Turn mode and warn in chrome “条目过多，已建议回合视图”; Entry mode still available but may virtualize later (v1 may hard-cap render with “too large” empty partial + message if > 1500 nodes—must not freeze main).
33. **No foreign design language.** No default Cytoscape theme, no React Flow chrome. Tokens from `tokens.css` / workspace patterns only.
34. **Dark mode:** all colors via semantic tokens.

### Shared canvas refactor

35. Extract from Branches a presentational primitive, e.g. `features/session-graph-canvas/` or `pages/agent-workspace/ui/session-graph/`:
    - viewport state
    - edge drawing
    - fit/zoom helpers
    - pointer handling
36. Branches reuses the primitive with **coarse** node types (existing).
37. Session Map uses the same primitive with Turn/Entry nodes + dual-pane shell.
38. Do not fork two incompatible pan/zoom implementations.

### Actions semantics

39. **切换到此分支:** `navigateTree({ entryId: resolvedLeafId })` (or the navigate id Branches already uses for leaf resolution—must match product behavior in `findBranchLeaf` / host API). On success: live leaf updates, map active path refreshes, timeline reloads active path; keep Map open; selection retained.
40. **在对话中定位:** if selection’s primary message entry is on active path, close optional; scroll timeline to `data-timeline-entry-id` / existing scroll API. If not on active path, disable with reason “不在当前对话路径上；请先切换分支”.
41. **Busy turn:** if a turn is active, Switch either waits/disabled with copy “等待当前回合并完成后可切换” matching existing navigate rules—**do not** invent abort-on-switch unless already product behavior.

### Non-goals (v1)

- Multi-session / `parentSession` graph.
- Editing JSONL, deleting entries, or rewriting history from the Map.
- File/worktree checkpoint / rewind (separate concept).
- Full provider wire payload browser (stays Context Inspector).
- Generic subagent graph across Agents (Agent Tree is a different product object).
- Real-time collaborative cursors.
- Cytoscape / XYFlow / React embedding.
- Replacing Chat timeline with the map.

### Testing & verification

42. **Pure logic:** turn aggregation + leaf resolution unit tests in desktop or session package (stable, no UI).
43. **Package:** existing session tests remain green; add cases if new exported helpers appear.
44. **Manual:**
    - Linear session: map is a spine; selection path = timeline order.
    - Edit-fork: two user children; side branch muted; preview effective messages exclude sibling.
    - Compaction on path: excluded ids tagged; effective list shorter than path.
    - Switch branch: timeline follows; Map path highlight moves.
    - Preview without switch: timeline leaf unchanged while detail shows other branch.
    - Host down: structured empty state.
45. **Typecheck** clean for contracts + UI. No new tests required for Solid chrome unless pure helpers are extracted (per project test policy).

### Implementation plan (single ship, ordered)

Implement as **one feature branch / one product slice**, in this order so the quality bar is not “graph first, context never”:

| Step | Deliverable |
|---|---|
| S1 | Contracts + main snapshot/context IPC + live leaf wiring |
| S2 | Turn aggregation + leaf resolution pure helpers + tests |
| S3 | Shared session-graph canvas extract; Branches still works |
| S4 | Session Map shell: dual pane, density toggle, legend, states; **header open control** |
| S5 | Structure rendering Turn + Entry densities + **minimap** |
| S6 | Detail pane all sections + live HUD optional |
| S7 | Actions: switch / scroll / copy; refresh lifecycle |
| S8 | Visual polish pass (tokens, edges, selection vs path, empty) |
| S9 | Manual verification checklist + README/screenshot optional follow-up |

Do not merge a map that only draws boxes without context pane—that fails the product goal.

## Acceptance Checklist

- [ ] Open Session Map from workspace chrome on Active Agent with session.
- [ ] Dual pane: structure + detail; Chinese chrome.
- [ ] Open control lives in the **chat header**.
- [ ] Default Turn density; Entry density toggle works; density **not** persisted across sessions.
- [ ] **Minimap** present when the graph is non-empty; drags/clicks pan the main viewport.
- [ ] Active path highlighted; side branches visible but muted.
- [ ] Fork points recognizable.
- [ ] Compaction recognizable; excluded path entries marked in detail.
- [ ] Selection previews context without navigate.
- [ ] Effective messages match `buildPiContextProjection` for resolved leaf.
- [ ] JSONL gaps (system/tools/skills) explicitly disclosed; live summary when ready.
- [ ] Switch updates live leaf + timeline + map path.
- [ ] Scroll-in-chat only on active path.
- [ ] No full raw blobs in structure payload; UI remains responsive on medium sessions.
- [ ] Branches dialog still works; chat timeline still primary.
- [ ] No new heavy graph dependency; Orbit tokens only.
- [ ] No JSONL deletion or rewrite.

## Resolved product choices

| # | Topic | Decision |
|---|--------|----------|
| 1 | Open control placement | **Chat header** (alongside Branches / session chrome). |
| 2 | Minimap | **Required in v1** (overview + pan main viewport). |
| 3 | Persist density toggle | **No** for v1; each open defaults to Turn. |
| 4 | Deep link from Branches | **Out of v1** (optional later). Meaning: a button on the existing Branches dialog like “在会话图中查看”, which would open Session Map focused on the same fork/node. Not needed to ship Map; user can open Map from the header independently. |

## References

- [`packages/session/README.md`](../../packages/session/README.md) — JSONL facts, context projection, graph DTOs  
- [`packages/session/src/context.ts`](../../packages/session/src/context.ts) — path + compaction + effective messages  
- [`packages/session/src/graphs.ts`](../../packages/session/src/graphs.ts) — structure / execution / context graphs  
- Existing UI: `branches-flow-*.tsx`, timeline, `context-preview.tsx`  
- Product language: [`CONTEXT.md`](../../CONTEXT.md) — PI Session, Active Agent  
