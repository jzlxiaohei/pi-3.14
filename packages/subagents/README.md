# `@pi-3.14/subagents`

跨项目复用的 PI subagent 编排层。它负责父子执行关系、并发上限、取消传播、事件转发和清理，
但不绑定数据库、任务模型、进程池或容器平台。

## 选择执行边界

- `createInProcessSubagentExecutor()`：每个 subagent 在当前 Node 进程创建独立 PI session。
  启动快、可注入函数型 custom tools，适合可信宿主和测试。
- `createProcessSubagentExecutor()`：每个 subagent 使用 PI RPC 子进程。提供崩溃和阻塞边界，
  适合 coding agent 的生产默认值。

子进程不是安全沙箱。多租户文件系统、网络、凭据和资源限制仍需容器或 OS policy。

## 直接调度

```ts
import {
  SubagentOrchestrator,
  createProcessSubagentExecutor,
} from "@pi-3.14/subagents";

const orchestrator = new SubagentOrchestrator({
  executor: createProcessSubagentExecutor(),
  maxConcurrency: 4,
});

const handle = orchestrator.spawn({
  cwd: "/path/to/repository",
  prompt: "检查认证模块并返回风险清单，不要修改文件。",
});

for await (const event of handle.events) {
  // queued / started / host_event / finished
}

const result = await handle.result;
await orchestrator.dispose();
```

## 注册为父 Agent 工具

```ts
import { createEmbeddedPiHost } from "@pi-3.14/runtime/embedded";
import {
  SubagentOrchestrator,
  createProcessSubagentExecutor,
  createSubagentTool,
} from "@pi-3.14/subagents";

const orchestrator = new SubagentOrchestrator({
  executor: createProcessSubagentExecutor(),
  maxConcurrency: 4,
});
const subagentTool = createSubagentTool(orchestrator, {
  defaultCwd: process.cwd(),
});
const host = await createEmbeddedPiHost({
  session: { customTools: [subagentTool] },
});

const turn = host.prompt("并行检查 API 与数据库层，然后汇总结论。");
const result = await turn.result;

await host.dispose();
await orchestrator.dispose();
```

`createSubagentTool()` 声明为 PI parallel tool；模型在一次响应中发出多个互不依赖的 tool call
时，编排器会在 `maxConcurrency` 范围内并行执行。
