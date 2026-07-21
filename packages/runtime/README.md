# `@pi-3.14/runtime`

Node-only 的 PI Host 基座，保留 PI session、entry、fork 与 stopReason 语义。

- `@pi-3.14/runtime/embedded`：同进程持有 `AgentSessionRuntime`，支持函数型 custom tools
  和自定义 runtime factory。
- `@pi-3.14/runtime/rpc`：通过 PI `RpcClient` 启动隔离子进程，显式解析 PI CLI 路径，
  并补充 turn timeout、进程退出探测和 SIGTERM/SIGKILL 清理。

两种实现共享 `PiHost`：

```ts
interface PiHost {
  prompt(input: string | PiPromptInput): PiTurnHandle;
  steer(input: string | PiPromptInput): Promise<void>;
  followUp(input: string | PiPromptInput): Promise<void>;
  abort(): Promise<void>;
  getState(): Promise<PiHostState>;
  newSession(options?: { parentSession?: string }): Promise<{ cancelled: boolean }>;
  switchSession(sessionPath: string): Promise<{ cancelled: boolean }>;
  fork(entryId: string): Promise<PiForkResult>;
  dispose(): Promise<void>;
}
```

`PiTurnHandle.events` 是 JSON-safe 事件流，`result` 以 assistant `stopReason` 为终态依据。
PI 0.80.3 尚未在所有 Host 暴露统一 `agent_settled`，RPC 实现会结合 `willRetry`、队列状态与
进程健康检查判断结束；`capabilities.settledEvent` 因此为 `false`。

## Host helpers

`createEmbeddedPiHost` 会在加载 session 前调用 `repairOrphanedToolCalls`，避免 Codex 重放
aborted tool turn 时出现 `No tool call found for function call output`。

工具审批相关能力也放在本包，避免各宿主重复实现：

- `toolNeedsApproval`：读类工具自动放行
- `raceApproval`：turn abort 时 fail-closed
- `createSessionAutoApprove`：首次 Allow 后本 binding 内自动放行（切换 session 时 `reset()`）

详见 skill `pi-3-14-usage` 的 Host Pitfalls 一节。
