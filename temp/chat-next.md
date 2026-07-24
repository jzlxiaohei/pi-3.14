# Chat 之后怎么走

chat 已基本能用。本地闭环；审阅在应用内 Diff。

## 里程碑顺序

1. **稳定当前 chat** — 已 commit（`13c37f2`）
2. **Diff / Changes 审阅** — 弹窗 + 左右分栏 + reviewed 进度（暂 sessionStorage）
3. **本地持久化（SQLite）** — 替代 sessionStorage / 零散 JSON；先吃 reviewed 进度、task 元数据等
4. **工作流引入**（两套，别混成一个系统）
   - **工程主路径**：新建 Task 时选 playbook 或跳过；步骤右侧悬浮 + Next/Skip；进度与 chat 解耦；Next 预填 `/skill` starter。Matt 安装已撤出 chat（归未来 Skills 页）。
     - 已上：`feature-default` / `small-tdd` / `bugfix`
     - 后置：`feature-tickets` / `feature-wayfinder` + 跨 Session implement（等 Subagent）
   - **可复用能力** — **取消「配方」产品概念**。不另做 recipe 库/启动器；复用 = PI Skill（`SKILL.md` + 可选脚本）。
5. **Subagent** — Diff + 工作流薄引入稳了再接

## 「工作流」指什么（已澄清）

不是 Git/CI/审批心智，而是：

| 类型 | 例子 | 形态 |
|---|---|---|
| 多步工程 SOP | Matt wayfinder 链 | 步有顺序、产物槽、按步挂 Skill |
| 可复用能力 | 周报 / 爬数 / 固定流程 | 抽成 **Skill**（必要时带脚本），下次 `/slash` |

Agent Fly 里已有 Task + SOP（五步四槽）可作参考，但 **PIE 先薄引入，不先搬整套引擎**。

## 可复用能力 = Skill（已定，无配方）

**不做什么**：独立 Recipes 产品、recipe JSON 双轨、编排/cron/DAG。

**聊天里就两件事（也差不多只能做成这样）**：

1. **协助抽取**：用户触发（或接受提示后）→ 协助写成 `SKILL.md`（+ 可选脚本）→ 落到 `{cwd}/.pi/skills` 或全局 skills → rebind 后可用 `/name`。
2. **提示发现**：standing 指示（`AGENTS.md` / 短 append）——LLM 若发现稳定可复用模式，**提示用户**可抽象成 Skill；人确认后再抽，不静默写盘。

脚本仍是 Skill 的降本手段，不是并列产品名。**Recipes 代码已删**（无历史负担）。

**已定落盘**：抽取默认进 **用户 PI 个人 skills 库**（跟 PI 互通）；PIE 自有空间只存分类/选用等管理态。抽取输入默认整段 transcript，支持框选。

**抽取第一刀已上**：composer「协助抽取 Skill」→ 全量/区间 → 独立 Task 起草 → banner 预览/确认写入 `~/.pi/agent/skills`（不自动写盘）。管理 UI / chat 选用 skill 仍后置。

## Chat 冻结原则

大改停；只修 blocker。其余 UI 进 backlog。

## Backlog（已记，未做）

### 工程路径：一键安装 Matt skills 到当前项目（已挂）

- **默认**：项目内装，不默认全局；PIE 不 vendor skills。
- **入口**：Engineering path「安装 skills」→ 确认弹窗 → 一键安装。
- **落盘**：`{cwd}/.pi/skills/`（git clone `mattpocock/skills` engineering；勿只装到 `.agents/skills`）。
- **装完**：不自动跑 `/setup-matt-pocock-skills`；预填 prompt + `rebindActiveTask` 重载 session。
- **是否已装**：以磁盘为准探测 `{cwd}/.pi/skills`（setup + grill-with-docs / to-spec / implement / tdd / code-review / diagnosing-bugs）；UI 显示「skills 已装」，可重装覆盖。不另写 sessionStorage 旗标。
- **是否已 setup**：另探 `/setup-matt-pocock-skills` 产物——`docs/agents/issue-tracker.md` + `domain.md` +（有 triage 时）`triage-labels.md`，以及 `CLAUDE.md`/`AGENTS.md` 的 `## Agent skills`。已装未齐 → UI「待 setup」、可预填 `/setup-matt-pocock-skills`。
- **授权 / 信任**：无额外 OS 权限；确认即同意联网 + 写仓库；一并写 `~/.pi/agent/trust.json`（cwd → trusted）。不碰全局 agent skills。

### 想法：每步 = 独立 session / subagent（可自带 system prompt）

**方向有意义**（与「一 Ticket 一 Session」、避免中途热改 system prompt 同向），但 **连续性应靠产物，不靠共用长 transcript**。

- 适合：中大路径、to-tickets 之后的 implement、要强角色隔离的步。
- 不默认：小任务 `tdd → code-review`（开销大）。
- 升级「其实是大需求」：加重 playbook + **新开后续步的 session**；已有 grilling session 作档案保留；**不要**把多步硬揉回同一个 session 共用上下文。
- 主坑：handoff（缺 spec/ticket 文件会失忆/打架）、Task 下多 session 导航 UX、subagent 编排 vs 并列 session 两种模型别混、冷启动重读代码。
- 与当前第一刀关系：先薄导航（同 session + starter）；此想法进 Subagent / 多 session 里程碑再设计。

**交互仍 chat-first（已定）**：主舞台一直是当前步的 chat；步骤条 = 面包屑/导航；多 session = 次级列表可切回；flow graph 非默认、可后置。不要做成 graph-first。
