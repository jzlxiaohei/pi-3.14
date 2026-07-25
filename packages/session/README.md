·# `@pi-3.14/session`

通用、只读的 PI Session JSONL 解析与分析包。它把 append-only JSONL 转成可序列化快照，
并提供上下文、执行过程、用量和图投影，不依赖任何应用层数据模型。

## 事实边界

- `header.id` 是当前 Session ID。
- `header.parentSession` 是可选的父 Session **文件路径**，不是稳定 ID。本包将其原样投影为
  `parentSessionPath`，不据此实现跨 Session 血缘。
- entry 的 `id` / `parentId` 构成单 Session 内部树。
- JSONL 可精确还原消息、分支、模型变更、thinking level、usage、compaction 和 custom entry。
- 历史 system prompt、tools 与 Skill 选择不在 JSONL 中，本包会在 context projection 的
  `recoverability.unavailableFromJsonl` 中明确标注。

## 读取

纯解析入口不依赖 Node：

```ts
import { parsePiSessionJsonl } from "@pi-3.14/session";

const snapshot = parsePiSessionJsonl(jsonl);
```

文件读取使用独立 Node 子入口：

```ts
import { readPiSessionFile } from "@pi-3.14/session/node";

const snapshot = await readPiSessionFile("/path/to/session.jsonl");
```

解析器允许正在追加的文件存在残缺尾行，但不会静默吞掉中间坏行。所有问题通过
`snapshot.diagnostics` 返回；未知 entry 会保留原始 JSON 和结构关系。

当前结构分析支持 PI Session v2-v3。无 `version` 的 v1 线性格式会返回
`unsupported_version`，应先由 PI 自身迁移，避免分析包自行生成不稳定 entry ID。

## 分析与上下文

```ts
import {
  analyzePiSession,
  buildPiContextProjection,
} from "@pi-3.14/session";

const context = buildPiContextProjection(snapshot);
const analysis = analyzePiSession(snapshot);
```

`buildPiContextProjection()`：

- 从 leaf 沿 `parentId` 还原活跃路径；
- 按最新 compaction 的 `firstKeptEntryId` 计算有效上下文；
- 输出每条有效消息的来源 entry ID；
- 输出被 compaction 排除的 entry；
- 还原当前 model / thinking level。

`analyzePiSession()`：

- 聚合 turn、assistant call、tool call/result；
- 汇总 provider 返回的 token usage 与 cost；
- 统计分支点、最大深度、compaction 和工具错误；
- 对缺失 tool result、孤立 result、重复 call ID 等返回 diagnostics。

JSONL 没有 tool execution start 事件；`durationMsEstimate` 仅表示 assistant message 时间到
tool result 时间，并通过 `timingBasis` 明确标注，不能当作精确工具耗时。

## Graph/ViewModel

本包只输出无坐标、JSON-safe 的 Graph DTO，不提供 React 组件或布局实现：

```ts
import {
  buildContextGraph,
  buildExecutionGraph,
  buildStructureGraph,
} from "@pi-3.14/session";

const structure = buildStructureGraph(snapshot);
const execution = buildExecutionGraph(snapshot);
const context = buildContextGraph(snapshot);
```

- Structure：完整 entry 树、分支和 active path。
- Execution：user / assistant / toolCall / toolResult 及调用关系。
- Context：指定 leaf 的路径、compaction 和有效上下文范围。

上层可以将这些 DTO 映射到 React Flow、Cytoscape、D3、Canvas 或其他渲染器。
