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
