# dsh-genui GenUI 核心协议重构方案

## 1. 背景

目前 dsh-genui 的 GenUI 核心逻辑已经承担了较多职责，包括：

* 模型输出字段兼容与 alias 修复
* GenUI spec 结构校验
* 组件字段校验
* renderer 语义校验
* 安全过滤
* 资源限制
* repair / sanitize
* 节点计数
* 自定义组件兼容
* `validate_dsh_ui`
* `render_ui`
* fence renderer
* panel 渲染

这些能力本身是合理的，但当前实现中，同一套 GenUI 协议知识分散在多个位置：

```text
spec.ts
component-schema.ts
guard.ts
chart-contract.ts
fence-render.tsx
plugin/tool.ts
renderer
```

因此一个组件的真实协议往往无法通过阅读单个文件确定。

例如 `callout.tone`：

```text
spec.ts
  ↓
知道它是 string 类型

component-schema.ts
  ↓
知道 tone 是合法字段

guard.ts
  ↓
CALLOUT_TONES 定义合法枚举值

repairNode()
  ↓
决定非法 tone 如何被处理

processGenuiSpec()
  ↓
决定是否产生错误

fence / render_ui
  ↓
决定最终是否允许渲染
```

这种结构已经导致过类似 issue #102 的问题：

```text
validator 认为合法
        ↓
repair 静默删除字段
        ↓
renderer 得到空壳或降级组件
```

同时也增加了人工维护和 Codex 等代码 Agent 理解仓库的成本。

本次重构目标不是简单拆分大文件，而是建立一套清晰、单向、可验证的 GenUI runtime protocol。

---

# 2. 重构目标

完成重构后，GenUI 数据流应固定为：

```text
Raw model output
        ↓
normalize
        ↓
validate
        ↓
sanitize / repair
        ↓
process result
        ↓
render_ui / fence / panel
```

核心约束：

```text
任何 renderer 不自行解释原始 spec。

任何 tool 不自行实现组件校验。

任何组件 alias 不在 schema 之外声明。

任何字段约束不通过错误字符串反向判断。

所有 GenUI 消费入口最终依赖同一个 processGenuiSpec()。
```

最终希望达到：

```text
一套协议定义
一套 traversal
一套 structured diagnostics
一套 processing pipeline
多个消费端
```

---

# 3. 建议目录结构

建议把目前集中在 `guard.ts` 中的 GenUI protocol 能力独立成一个内部模块：

```text
src/client/genui-runtime/
├── index.ts
├── types.ts
├── schema.ts
├── normalize.ts
├── traverse.ts
├── validate.ts
├── sanitize.ts
├── diagnostics.ts
├── process.ts
└── validators/
    ├── chart.ts
    ├── table.ts
    ├── diagram.ts
    └── media.ts
```

原来的 `src/client/guard.ts` 与 `src/client/component-schema.ts` 在迁移完成后删除。
所有源码和测试直接依赖 `src/client/genui-runtime/index.ts`，不保留源码级兼容导出层。

---

# 4. 第一阶段：建立结构化 Diagnostic

这是最优先建议处理的部分。

目前很多逻辑使用：

```ts
errors: string[]
```

然后其他模块再：

```ts
error.startsWith(...)
error.includes(...)
regex.test(error)
```

例如：

```ts
processed.errors.filter(error =>
  /series is only supported for bars/.test(error)
)
```

这种实现的问题是，错误文案已经变成业务协议的一部分。

一旦修改：

```text
data is required for line
```

为：

```text
line chart requires data
```

其他逻辑可能直接失效。

建议改成：

```ts
export interface GenuiDiagnostic {
  severity: 'error' | 'warning'

  code:
    | 'UNKNOWN_FIELD'
    | 'FIELD_TYPE'
    | 'FIELD_REQUIRED'
    | 'FIELD_ENUM'
    | 'FIELD_ALIAS'
    | 'NODE_DROPPED'
    | 'NODE_LIMIT'
    | 'MAX_DEPTH'
    | 'CHART_EMPTY'
    | 'CHART_SERIES_UNSUPPORTED'
    | 'UNSAFE_VALUE'

  path: string

  component?: string
  field?: string

  expected?: unknown
  actual?: unknown

  alias?: string
  canonical?: string
}
```

例如：

```ts
{
  severity: 'error',
  code: 'FIELD_TYPE',
  path: 'items[0].title',
  component: 'card',
  field: 'title',
  expected: 'string',
  actual: 'number',
}
```

或者：

```ts
{
  severity: 'warning',
  code: 'FIELD_ALIAS',
  path: 'items[0].label',
  component: 'card',
  field: 'label',
  alias: 'label',
  canonical: 'title',
}
```

只有最终展示的时候才格式化：

```ts
formatDiagnostic(diagnostic, 'zh-CN')
```

这样：

```text
validate_dsh_ui
fence fallback
render_ui
测试
日志
```

都消费同一种结构化结果。

---

# 5. 第二阶段：让 Component Schema 成为真正的 runtime source of truth

目前已经有 `COMPONENT_SCHEMAS`，这是正确方向，但应该继续增强。

现在字段通常只是：

```ts
title: 'string'
tone: 'string'
```

建议升级为真正的字段 schema：

```ts
interface FieldSchema {
  type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'array'
    | 'nodes'
    | 'object'
    | 'unknown'

  required?: boolean

  aliases?: readonly string[]

  enum?: readonly unknown[]

  min?: number
  max?: number

  integer?: boolean

  maxLength?: number

  /** URL 等字段超限时拒绝，而不是截断后继续渲染 */
  truncate?: boolean

  nested?: RecordSchema

  sanitize?: FieldSanitizer
}
```

例如：

```ts
callout: {
  fields: {
    content: {
      type: 'string',
      required: true,
      maxLength: GENUI_LIMITS.maxString,
    },

    title: {
      type: 'string',
      maxLength: GENUI_LIMITS.maxString,
    },

    tone: {
      type: 'string',
      enum: ['info', 'success', 'warning', 'error'],
      aliases: ['kind'],
    },
  },
}
```

这样：

```text
字段是否合法
字段有哪些 alias
字段是不是 required
字段允许哪些 enum
字段如何限制长度
```

全部来自一个地方。

不再出现：

```text
component-schema.ts: tone 是 string
guard.ts: CALLOUT_TONES
repairNode: 再判断一次 tone
```

---

# 6. 第三阶段：区分通用规则与组件语义规则

不是所有规则都适合声明式 schema。

例如 chart：

```text
data OR series 至少有一个
line 必须有 data
donut 必须有 data
series 只能用于 bars
data 不能为空
series.data 不能为空
```

这些属于组件级 semantic validator。

因此 Component Definition 推荐变成：

```ts
interface ComponentDefinition {
  fields: Record<string, FieldSchema>

  validate?: ComponentValidator

  sanitize?: ComponentSanitizer

  children?: ChildTraversalDefinition
}
```

例如：

```ts
chart: {
  fields: {
    kind: {
      type: 'string',
      enum: ['bars', 'line', 'donut'],
    },
    data: {
      type: 'array',
      nested: chartDatumSchema,
    },
    series: {
      type: 'array',
      nested: chartSeriesSchema,
    },
  },

  validate(node, ctx) {
    // chart-specific semantic rules
  },

  sanitize(node, ctx) {
    // maxChartPoints
  },
}
```

于是：

```text
基础字段协议 → schema
复杂业务约束 → validate()
资源 / 安全处理 → sanitize()
```

职责边界会非常清楚。

---

# 7. 第四阶段：统一 Tree Traversal

目前多个地方都有类似：

```ts
if (type === 'tabs') ...
else if (type === 'accordion') ...
else if (type === 'card') ...
else if (type === 'list') ...
```

这会造成新的协议漂移。

例如一个新 container 类型加入以后，很容易出现：

```text
renderer 支持了
validator 没遍历
node count 没遍历
unknown-field diagnostics 没遍历
```

建议把 child traversal 同样写入 component definition。

例如：

```ts
card: {
  children: [
    { field: 'items', kind: 'nodes' },
  ],
}
```

tabs：

```ts
tabs: {
  children: [
    {
      field: 'tabs',
      kind: 'records',
      childrenField: 'items',
    },
  ],
}
```

accordion：

```ts
accordion: {
  children: [
    {
      field: 'items',
      kind: 'records',
      childrenField: 'items',
    },
  ],
}
```

然后所有逻辑统一调用：

```ts
visitGenuiNodes(spec, visitor)
```

节点计数：

```ts
visitGenuiNodes(spec, () => count++)
```

unknown-field：

```ts
visitGenuiNodes(spec, validateFields)
```

validation：

```ts
visitGenuiNodes(spec, validateNode)
```

这样：

```text
tree traversal
```

也只有一份实现。

---

# 8. 第五阶段：normalize 与 sanitize 必须彻底分离

当前 repair 很容易同时承担：

```text
字段兼容
alias
安全过滤
类型修复
资源截断
节点删除
```

建议严格区分。

## normalize

normalize 只能做：

```text
等价、无损、确定性的协议转换
```

例如：

```text
card.label   → title
card.content → items
table.data   → rows
text.text    → content
tabs.content → items
```

normalize 不应该：

```text
删除非法 node
truncate 字符串
过滤 URL
clamp 数字
```

其返回：

```ts
interface NormalizeResult {
  value: unknown
  diagnostics: GenuiDiagnostic[]
}
```

并保证：

```ts
normalize(normalize(x)) === normalize(x)
```

---

## sanitize

sanitize 才负责：

```text
security filtering
resource limits
clamping
truncation
dropping
```

例如：

```text
javascript: URL → 删除
过长字符串 → truncate
节点超过 200 → tail drop
数值超过范围 → clamp
```

其返回也应该带变化信息：

```ts
interface SanitizeResult {
  spec: GenuiSpec | null
  diagnostics: GenuiDiagnostic[]
}
```

如果删除了 node：

```ts
{
  code: 'NODE_DROPPED',
  severity: 'error',
  path: 'items[4]',
}
```

不再通过：

```text
repair 前节点数量
vs
repair 后节点数量
```

反推“可能有节点被删”。

这样甚至可以逐个准确指出：

```text
items[2] 被删除
items[7].tabs[1].items[0] 被删除
```

比目前 count comparison 精确很多。

---

# 9. 第六阶段：processGenuiSpec 成为唯一 runtime API

最终外部模块不应该分别知道：

```text
normalizeGenuiSpec
validateGenuiSpec
sanitizeGenuiSpec
chart validator
drop detector
```

而应该主要依赖：

```ts
processGenuiSpec(raw)
```

推荐返回：

```ts
export interface GenuiProcessResult {
  raw: unknown

  normalized: unknown

  spec: GenuiSpec | null

  errors: GenuiDiagnostic[]

  warnings: GenuiDiagnostic[]

  stats: {
    declaredNative: number
    renderedNative: number
    renderedTotal: number
  }
}
```

内部固定：

```ts
export function processGenuiSpec(raw: unknown): GenuiProcessResult {
  const normalized = normalizeGenuiSpec(raw)

  const validation = validateGenuiSpec(normalized.value)

  if (validation.errors.length > 0) {
    return ...
  }

  const sanitized = sanitizeGenuiSpec(normalized.value)

  return ...
}
```

这样所有入口：

```text
validate_dsh_ui
render_ui
fence
panel
tests
```

只需要理解这一套 API。

---

# 10. 第七阶段：统一 Renderability 判断

当前多个地方容易分别出现：

```ts
processed.errors.length === 0
```

或者：

```ts
isIntentionalBudgetCut(processed)
```

或者其他例外。

建议定义统一函数：

```ts
export function isRenderableGenuiResult(
  result: GenuiProcessResult,
): result is RenderableGenuiResult
```

例如：

```ts
return result.spec !== null
  && result.errors.every(isNonBlockingDiagnostic)
```

然后：

```text
fence renderer
render_ui.execute
presentationMeta
presentCall
panel
```

全部调用同一函数。

禁止自己再写：

```ts
if (processed.errors.length ...)
```

这样不会出现：

```text
execute 认为失败
presentationMeta 却仍返回 spec
```

这种行为不一致。

---

# 11. 第八阶段：把 guard.ts 拆掉，但不要按组件拆成几十个文件

不建议：

```text
card-validator.ts
card-repair.ts
card-schema.ts
table-validator.ts
table-repair.ts
...
```

这样文件会过碎，Codex 反而需要跳更多文件。

建议按“处理阶段”拆：

```text
schema.ts
normalize.ts
validate.ts
sanitize.ts
traverse.ts
diagnostics.ts
process.ts
```

只有特别复杂的组件语义：

```text
chart
diagram
echart
media
```

才放进：

```text
validators/
```

这样 Agent 想知道：

> 一个 raw spec 如何变成 rendered spec？

只需要按：

```text
process.ts
→ normalize.ts
→ validate.ts
→ sanitize.ts
```

顺序阅读。

---

# 12. 第九阶段：补一份 AGENTS.md

这个成本很低，但对 Codex 收益非常高。

仓库根目录增加：

```text
AGENTS.md
```

内容不需要详细介绍整个项目，只记录核心架构约束。

建议包括：

```text
# GenUI Architecture

Canonical pipeline:

raw model output
→ normalizeGenuiSpec
→ validateGenuiSpec
→ sanitizeGenuiSpec
→ processGenuiSpec
→ renderer

Rules:

1. processGenuiSpec is the canonical runtime entry point.

2. Native component definitions live in:
   src/client/genui-runtime/schema.ts

3. Do not add aliases outside the runtime component schema.

4. Do not implement component-tree traversal manually.
   Use visitGenuiNodes().

5. Custom renderer node types are opaque.
   Never inspect or sanitize their payload.

6. file-tree items are data records, not GenUI component nodes.

7. Errors must use structured GenuiDiagnostic codes.
   Do not parse human-readable error strings.

8. render_ui, fence renderer and panel must use
   isRenderableGenuiResult().

9. normalize must be deterministic and lossless.
   Security filtering and limits belong to sanitize.

10. When changing a component protocol:
    - update schema
    - update semantic validator if needed
    - update protocol tests
    Do not patch individual consumers.
```

Codex 在第一次进入项目时看到这份文件，就能少走大量代码路径。

---

# 13. 测试结构也应同步重构

建议把当前测试按 protocol stage 分开：

```text
tests/genui-runtime/
├── schema.spec.ts
├── normalize.spec.ts
├── validate.spec.ts
├── sanitize.spec.ts
├── traversal.spec.ts
├── diagnostics.spec.ts
├── process.spec.ts
└── consistency.spec.ts
```

其中 `consistency.spec.ts` 非常重要。

它负责保证：

```text
validate_dsh_ui
render_ui
fence
panel
```

面对同一个 spec 的结论一致。

例如：

```ts
const result = processGenuiSpec(raw)

expect(
  resolveGenuiSpec(JSON.stringify(raw))
).toEqual(
  isRenderableGenuiResult(result)
    ? result.spec
    : null
)
```

再验证：

```ts
render_ui presentationMeta
```

同样返回完全相同的 canonical spec。

---

# 14. 重构实施顺序

不建议直接一次 PR 把 `guard.ts` 全部拆掉。

推荐分阶段进行。

| 阶段      | 内容                                 | 风险 |
| ------- | ---------------------------------- | -: |
| Phase 1 | Structured diagnostics             |  低 |
| Phase 2 | Schema 支持 enum / nested validation |  低 |
| Phase 3 | 抽统一 traversal                      |  中 |
| Phase 4 | 分离 normalize / sanitize            |  中 |
| Phase 5 | processGenuiSpec 成为唯一入口            |  中 |
| Phase 6 | 删除 consumer 侧重复判断                  |  低 |
| Phase 7 | 拆分 guard.ts                        |  中 |
| Phase 8 | 添加 AGENTS.md / architecture docs   |  低 |

关键原则是：

```text
先统一行为
再移动代码
```

不要：

```text
边改变行为
边大规模移动文件
边重写 API
```

否则 reviewer 很难判断 regression。

---

# 15. 建议的最终数据结构

重构完成后，理想的调用代码应该非常简单。

validate tool：

```ts
const result = processGenuiSpec(parsed)

return formatValidationResult(result)
```

render_ui：

```ts
const result = processGenuiSpec(spec)

if (!isRenderableGenuiResult(result)) {
  throw new GenuiSpecError(result.errors)
}

return render(result.spec)
```

fence：

```ts
const result = processGenuiSpec(parsed)

if (!isRenderableGenuiResult(result)) {
  return null
}

return result.spec
```

而不是每个入口分别理解：

```text
alias
chart
drop count
native count
custom node
budget
repair
validation
```

---

# 16. 重构完成标准

本次重构不应以“guard.ts 变短了”为完成标准。

真正的完成标准应该是：

```text
新增一个 native component，
只需要修改 component schema / semantic validator，
不需要修改 validate_dsh_ui、render_ui、fence、node counter。

新增一个 container component，
只需要声明其 child traversal，
所有 count / validate / diagnostics 自动支持。

修改一个字段 alias，
所有入口自动获得相同行为。

修改一个错误文案，
不会影响任何业务判断。

非法字段无法再出现：
validator ✅
但 repair 静默删除。

同一 raw spec 在：
validate_dsh_ui
render_ui
fence
panel
中具有相同 renderability 结论。
```

如果这几条成立，就说明这次重构真正解决了目前最核心的维护性问题。

---

# 17. 最终架构

目标状态可以概括为：

```text
                   ┌─────────────────────┐
                   │ Component Registry  │
                   │ fields / aliases    │
                   │ enum / children     │
                   │ validators          │
                   └──────────┬──────────┘
                              │
                              ↓
Raw Spec
   │
   ↓
Normalize
   │
   ↓
Validate
   │
   ↓
Sanitize
   │
   ↓
processGenuiSpec
   │
   ├─────────────┬─────────────┬─────────────┐
   ↓             ↓             ↓             ↓
validate_dsh_ui render_ui     fence         panel
```

整个系统只允许“向下消费”，而不允许 renderer/tool 再反向补协议规则。

这也是最适合人类维护和 Codex 阅读的结构。
