# chat 的高级功能
核心不是简单的用，而是要让使用者可以掌控一切。
1. chat还是UI和UX的核心
2. 增加 chat 的revert功能，参考cursor。用户可以改最新的一条user message，这时候直接提示用户确认revert吗
3. 提供tree （branch的功能）。如何可视化branch？在一个session里，还是branch后再来一个session，从PI的功能上说，应该是一个session（待确认）。感觉是不是 改非最新的 user message，就相当于 tree里。这样交互上可以和revert一样
4. system prompt , history message 等都要展示出来，让使用者（主要是我啦），能非常清楚的知道，给到llm的内容（json）是什么。
5. 我有packages 是用来解析 pi session jsonl, 能不能分析一下有用的信息
6. chat里提供更多的有用信息：token总数，各个模块的占比等，这里希望可以帮我想想还有哪些有用信息。

---

## Branches Graph = session JSONL 的可视化子集

Graph 不是另一套分支系统，而是**同一个 session 文件（JSONL）的树投影**，产品向裁切后的可读视图：

| JSONL 真相 | Graph 子集 |
|---|---|
| 全量 entry（message / tool / compaction / branch_summary / label…） | 主要是 user + 折叠后的 turn |
| `parentId` 拓扑 | 边 ≈ 父子（summary 等可透传不画） |
| 当前 leaf / active path | 高亮 spine |
| 分叉点多 child | Fork 标记 |

和 Timeline / Context 读的是同一份真相，切片不同：

- **Timeline**：当前路径上的对话体验  
- **Graph**：整棵树的拓扑地图  
- **Context**：送给模型的有效切片  

因此 Graph 适合 **看结构 / Goto**，不适合塞「生成摘要、带入旁支」等写操作。写 JSONL 的动作应发生在 chat / 明确的离开路径上。

## 分支摘要（已定）

- **顶栏 path 摘要入口已删**（无独立产品价值）。
- **只在 edit 分叉**：内联勾选「生成下方内容摘要并带入新路径」→ leave-time 总结 abandon 段。
- 新 path = 上方共享 messages +（可选）下方摘要；旧 path 仍可 Branches 切回继续聊。
