import assert from "node:assert/strict";
import test from "node:test";
import { parseQuestionnaire } from "./questionnaire";

const TWELVE_QUESTION_REPLY = `我先按当前工作区代码和本机现有数据做了梳理，未修改代码。

## 当前存储现状

### 1. PIE 自有持久数据

当前实现会重写整个 JSON。

### 2. Renderer 浏览器存储

偏好状态分散在多处。

### 3. PI Session 文件

PI Session 继续作为唯一事实来源。

### 4. 其他写入

这些不属于应用数据库。

## 第一轮需要确认的关键决策

请按编号回答即可；括号内是建议默认值。

### 1. SQLite 首期范围

选择：

- **A**：只迁移 Task
- **B**：迁移 Task 和偏好
- **C**：还要存更多数据

### 2. PI Session 的写入边界

是否接受以上规则？

### 3. Task 与 Session 的关系

未来是否需要一个 Task 关联多个 Session？

### 4. Session 文件不存在时怎么办

希望选择 A、B 还是 C？

### 5. JSON → SQLite 迁移策略

是否接受建议方案？

### 6. Task 排序语义

SQLite 后希望使用哪种排序？

### 7. 异常退出后的运行状态

启动时遇到 running Task 应变成什么？

### 8. 哪些偏好需要跨重启

请从列表中勾选。

### 9. 删除与保留规则

是否确认归档不删除 Session？

### 10. 隐私与加密

是否接受首期不做数据库加密？

### 11. 是否需要索引 Session 内容

近期是否有全文搜索需求？

### 12. 平台和多实例

请确认首期支持的平台。
`;

test("prefers the versioned questionnaire envelope and preserves surrounding prose", () => {
  const result = parseQuestionnaire(`前置分析。

<pie-questionnaire version="1">
{
  "version": 1,
  "title": "需要确认",
  "questions": [
    {
      "id": "scope",
      "type": "single_choice",
      "prompt": "首期范围？",
      "details": "选择一个方案。",
      "options": [
        { "value": "A", "label": "只迁移 Task" },
        { "value": "B", "label": "迁移 Task 和偏好" }
      ],
      "allowOther": true
    },
    {
      "id": "features",
      "type": "multi_choice",
      "prompt": "需要哪些能力？",
      "options": [
        { "value": "search", "label": "搜索" },
        { "value": "stats", "label": "统计" }
      ],
      "allowOther": true
    },
    {
      "id": "notes",
      "type": "text",
      "prompt": "还有其他要求吗？"
    }
  ]
}
</pie-questionnaire>

后续说明。`);

  assert.ok(result);
  assert.equal(result.title, "需要确认");
  assert.equal(result.intro, "前置分析。");
  assert.equal(result.outro, "后续说明。");
  assert.deepEqual(result.questions[0], {
    id: "scope",
    number: 1,
    type: "single_choice",
    title: "首期范围？",
    markdown: "选择一个方案。",
    options: [
      { value: "A", label: "只迁移 Task" },
      { value: "B", label: "迁移 Task 和偏好" },
    ],
    allowOther: true,
  });
  assert.equal(result.questions[1]?.type, "multi_choice");
  assert.equal(result.questions[2]?.type, "text");
});

test("detects the 12-question section without treating earlier numbered analysis as questions", () => {
  const result = parseQuestionnaire(TWELVE_QUESTION_REPLY);

  assert.ok(result);
  assert.equal(result.questions.length, 12);
  assert.equal(result.questions[0]?.title, "SQLite 首期范围");
  assert.deepEqual(result.questions[0]?.options, [
    { value: "A", label: "只迁移 Task" },
    { value: "B", label: "迁移 Task 和偏好" },
    { value: "C", label: "还要存更多数据" },
  ]);
  assert.doesNotMatch(result.questions[0]?.markdown ?? "", /\*\*A\*\*/);
  assert.equal(result.questions[11]?.title, "平台和多实例");
  assert.match(result.intro, /当前存储现状/);
  assert.match(result.intro, /第一轮需要确认的关键决策/);
});

test("detects a follow-up questionnaire introduced as key questions with nested numbering", () => {
  const result = parseQuestionnaire(`大部分约束已经明确，但还有几个会影响数据模型的问题。

## 第二轮关键问题

### 1. Subagent 的上下游是树还是依赖图？

请确认：

1. 每个 Subagent Session 都自动成为 Task 吗？
2. 子 Task 是否显示在主侧边栏？
3. Archive 父 Task 时如何处理？

### 2. Session 丢失后能否新建 Session？

是否确认新建 Session 应创建新 Task？

### 3. 手动排序的具体范围

以上规则是否符合预期？
`);

  assert.ok(result);
  assert.equal(result.questions.length, 3);
  assert.match(result.questions[0]?.markdown ?? "", /1\. 每个 Subagent/);
});

test("does not turn a numbered explanatory FAQ into an answer form", () => {
  const result = parseQuestionnaire(`## Storage notes

### 1. What data is stored?

Only task metadata is stored.

### 2. How is it migrated?

The migration runs in a transaction.

### 3. Should sessions be copied?

No. Sessions stay in JSONL files.
`);

  assert.equal(result, null);
});
