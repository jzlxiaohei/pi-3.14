# PI SDK Reference Notes

These notes are for wrapper internals only. App code should usually consume
`@pi-3.14/*` contracts instead of raw SDK APIs.

## Raw SDK References

When the official package is installed, prefer the bundled source of truth:

- `node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`
- `node_modules/@earendil-works/pi-coding-agent/examples/sdk/`
- `node_modules/@earendil-works/pi-coding-agent/examples/extensions/`

## Session Lifecycle

Always clean up all three layers:

```ts
const unsubscribe = session.subscribe(listener);

try {
  await session.prompt("...");
} finally {
  unsubscribe();
  await session.abort().catch(() => {});
  session.dispose();
}
```

`createAgentSession()` defaults to reading `~/.pi/agent` through the default
resource loader. Pass auth/model resources explicitly only when using a custom
auth location or runtime-only API key.

## Event Semantics

Use `message_end.message.stopReason` and host-level settled logic as the source
of truth:

| stopReason | Meaning | Status |
|---|---|---|
| `toolUse` | intermediate assistant step; tool call follows | completed node |
| `stop` | final answer | completed turn |
| `aborted` | user abort, dispose, or signal | cancelled |
| `error` | model/network failure | error unless `agent_end.willRetry` follows |

Pitfalls:

- Do not assume every `message_start` receives a matching `message_end`. Abort
  and error paths may emit a separate failure message.
- `agent_end` is not terminal when `willRetry` is true.
- A tool result with `isError: true` is not a definitive run failure. Later
  assistant steps may recover.
- Surface `compaction_start` and retry states so long silent periods are not
  mistaken for hangs.

## Custom Tools

Register tools through `customTools` or wrapper package APIs. Give the model
both prompt context and constraints:

```ts
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const statusTool = defineTool({
  name: "status",
  label: "Status",
  description: "Get process status.",
  promptSnippet: "Use status to report uptime for this process.",
  promptGuidelines: ["Call status only when the user asks about process health."],
  parameters: Type.Object({ verbose: Type.Optional(Type.Boolean()) }),
  execute: async (_id, params) => ({
    content: [{ type: "text", text: `uptime=${process.uptime()} verbose=${params.verbose ?? false}` }],
    details: params,
  }),
});
```

There is no `extensions` option on `createAgentSession()`. Extension reuse goes
through resource loader / extension runtime paths; verify against bundled SDK
docs before adding one.

If a `tools` allowlist is set, include every custom or extension tool name that
must stay active.

## Tool Gate

Chain PI's own `beforeToolCall` hook. Call the prior hook first and honor an
upstream block:

```ts
const prior = session.agent.beforeToolCall?.bind(session.agent);

session.agent.beforeToolCall = async (ctx, signal) => {
  const upstream = prior ? await prior(ctx, signal) : undefined;
  if (upstream?.block) return upstream;
  return upstream;
};
```

Fail closed for write or destructive calls when the host cannot obtain a clear
approval decision.

Prefer the packaged helpers instead of re-implementing gates:

```ts
import {
  createEmbeddedPiHost,
  createSessionAutoApprove,
  repairOrphanedToolCalls,
  toolNeedsApproval,
} from "@pi-3.14/runtime/embedded";

const approve = createSessionAutoApprove(async (request) => {
  // interactive UI decision
  return { approved: true };
});

const host = await createEmbeddedPiHost({
  cwd,
  sessionPath,
  toolApproval: approve,
});
```

`createEmbeddedPiHost` already runs `repairOrphanedToolCalls` before the session
is loaded into the agent.

## Host Pitfalls (desktop / out-of-process)

These bit PIE desktop and should stay encoded in `@pi-3.14/runtime`, not re-learned
in each host:

1. **Codex aborted tool turns**  
   OpenAI Codex / Responses skips `stopReason: aborted|error` assistant messages on
   replay, but still emits following `toolResult`s as `function_call_output`. That
   yields `No tool call found for function call output`.  
   **Do not** append a synthetic toolResult after an aborted assistant.  
   **Do** `repairOrphanedToolCalls` → `SessionManager.branch` to the parent of the
   broken assistant (already done inside `createEmbeddedPiHost`).

2. **Approval must race AbortSignal**  
   `beforeToolCall` can wait on UI forever. If the turn aborts (user stop, host
   dispose, process death), resolve the gate fail-closed via `raceApproval` /
   packaged `toolApproval` wiring. Reject pending UI approvals on abort too.

3. **First-allow session unlock**  
   Use `createSessionAutoApprove` so one Allow covers the rest of the host binding.
   Call `reset()` when creating or switching sessions.

4. **utilityProcess message shape**  
   Child `parentPort` messages arrive as `{ data }`; parent `child.on("message")`
   receives the payload directly. Unwrap defensively on the child side.

Desktop-only (keep in `PiRuntimeManager`, not `@pi-3.14/runtime`): make
`activateTask` idempotent for the already-bound task, and re-present any pending
approval to a new renderer subscription. Vite HMR while dogfooding this repo can
trigger that path, but the guard is general remount/re-subscribe hygiene — do not
gate it on `DEV`.

## SessionManager And Fork

Resume by ID means list metadata, then open by path. There is no stable
`openById` shortcut:

```ts
const sessions = await SessionManager.list(cwd);
const match = sessions.find((session) => session.id === sessionId);
const manager = match
  ? SessionManager.open(match.path, undefined, cwd)
  : SessionManager.create(cwd, undefined, { id: sessionId });
```

`SessionManager.list(cwd)` returns metadata records, not managers. Use
`SessionInfo.path` with `SessionManager.open()`.

Fork by durable `entryId`, not by matching message text:

```ts
const messages = session.getUserMessagesForForking();
await session.navigateTree(entryId, { summarize: true });
```

After runtime replacement such as new session, switch session, or fork, old
subscriptions are dead. Re-subscribe and re-bind extensions if used.
