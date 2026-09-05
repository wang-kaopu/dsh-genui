/** Runtime source of truth for the GenUI protocol. */
import { validateChartNode } from './validators/chart.ts'
import { validateTableNode } from './validators/table.ts'
import type { GenuiDiagnostic } from './types.ts'
import { GENUI_LIMITS } from './limits.ts'
import { advancedSanitizers } from './sanitizers/advanced.ts'
import { containerSanitizers } from './sanitizers/containers.ts'
import { dataSanitizers } from './sanitizers/data.ts'
import type { ComponentSanitizerFn } from './sanitizers/helpers.ts'

export const TEXT_SIZES = ['h1', 'h2', 'h3', 'body', 'muted', 'caption'] as const
export const BUTTON_TONES = ['primary', 'danger', 'success', 'ghost'] as const
export const BADGE_TONES = ['success', 'warn', 'danger', 'accent'] as const
export const INPUT_TYPES = ['text', 'email', 'password'] as const
export const CALLOUT_TONES = ['info', 'success', 'warning', 'error'] as const
export const CHART_KINDS = ['bars', 'line', 'donut'] as const
export const PLOT_KINDS = ['line', 'area', 'scatter'] as const
export const MEDIA_ASPECT_RATIOS = ['16:9', '4:3', '1:1', '9:16'] as const
export const MESH_SHAPES = ['box', 'sphere', 'cone', 'cylinder', 'torus'] as const
export const FILE_TYPES = ['file', 'dir'] as const
export const DIAGRAM_KINDS = [
  'architecture', 'it-state', 'flowchart', 'sequence', 'state', 'er', 'timeline',
  'swimlane', 'quadrant', 'radar', 'loop', 'nested', 'tree', 'org-chart', 'layers',
  'venn', 'pyramid', 'bar', 'line', 'gantt', 'scatter', 'high-level', 'process',
  'medallion', 'data-flow', 'dp-integration', 'dp-security-matrix',
] as const
export const DIAGRAM_NODE_TYPES = ['focal', 'backend', 'store', 'external', 'input', 'optional', 'security'] as const
export const DIAGRAM_VARIANTS = ['light', 'dark', 'editorial'] as const
export const DIAGRAM_EDGE_KINDS = ['solid', 'dashed', 'accent', 'link'] as const
export const DIAGRAM_ROUTES = ['auto', 'orthogonal', 'straight'] as const
export const ECHART_PRESETS = ['bar', 'line', 'area', 'pie', 'scatter'] as const

/** Primitive and structural field kinds understood by the runtime. */
export type FieldType = 'string' | 'string-or-null' | 'number' | 'boolean' | 'nodes' | 'array' | 'object' | 'unknown'

/** Context supplied to a field sanitizer. */
export interface FieldSanitizerContext {
  readonly path: string
  readonly component?: string
  readonly field?: string
}

/** Optional field-level security or normalization hook. */
export type FieldSanitizer = (value: unknown, context: FieldSanitizerContext) => unknown

/** Declarative field contract used by validation and sanitization. */
export interface FieldSchema {
  readonly type: FieldType
  readonly required?: boolean
  /** Whether invalid values should produce a security diagnostic when dropped. */
  readonly securitySensitive?: boolean
  readonly aliases?: readonly string[]
  readonly enum?: readonly unknown[]
  readonly min?: number
  readonly max?: number
  /** Whether finite numeric values are truncated to integers during repair. */
  readonly integer?: boolean
  /** Whether an out-of-range value is invalid instead of clampable. */
  readonly rangeError?: boolean
  readonly maxLength?: number
  /** Whether strings over maxLength are truncated; false rejects the field. */
  readonly truncate?: boolean
  readonly nested?: RecordSchema
  readonly sanitize?: FieldSanitizer
}

/** Schema for records nested inside a native component field. */
export interface RecordSchema {
  readonly fields: Readonly<Record<string, FieldSchema>>
  readonly required?: readonly string[]
  readonly nested?: Readonly<Record<string, RecordSchema>>
  readonly aliases?: Readonly<Record<string, string>>
}

/** Optional component-level semantic validation hook. */
export type ComponentValidator = (node: Record<string, unknown>, context: { readonly path: string }) => readonly GenuiDiagnostic[]

/** Human-readable metadata for a component semantic validator. */
export interface ComponentSemanticMetadata { readonly validator: string }

/** Declarative metadata naming the sanitizer policy for a component. */
export interface ComponentSanitizerMetadata { readonly name: string }

/** Child location declared by a component definition. */
export interface ChildTraversalDefinition {
  readonly field: string
  readonly kind: 'nodes' | 'records'
  readonly childrenField?: string
}

/** Complete runtime definition for one native component. */
export interface ComponentDefinition {
  readonly fields: Readonly<Record<string, FieldSchema>>
  readonly required: readonly string[]
  readonly aliases: Readonly<Record<string, string>>
  readonly enums: Readonly<Record<string, readonly unknown[]>>
  readonly nested: Readonly<Record<string, RecordSchema>>
  readonly oneOfRequired?: readonly (readonly string[])[]
  readonly conditionalRequired?: readonly { readonly field: string; readonly equals: unknown; readonly required: readonly string[] }[]
  readonly children?: readonly ChildTraversalDefinition[]
  readonly semantic?: ComponentSemanticMetadata
  readonly sanitizer?: ComponentSanitizerMetadata
  readonly validate?: ComponentValidator
  /** Specialized repair hook owned by this component definition. */
  readonly sanitize?: ComponentSanitizerFn
}

const stringField = (maxLength: number = GENUI_LIMITS.maxString): FieldSchema => ({ type: 'string', maxLength })
const colorField = (): FieldSchema => ({ type: 'string', maxLength: 64, sanitize: sanitizeColorField })
const stringArrayField = (): FieldSchema => ({ type: 'array', sanitize: sanitizeStringArrayField })
const urlField = (kind: 'href' | 'media' = 'media'): FieldSchema => ({
  ...stringField(2048),
  securitySensitive: true,
  truncate: false,
  sanitize: kind === 'href' ? sanitizeHrefField : sanitizeMediaField,
})
const nodeField = { type: { type: 'string' } } as const

function sanitizeHrefField(value: unknown): unknown {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return /^https?:\/\//i.test(normalized) || /^mailto:[^@\s]+@[^@\s]+$/i.test(normalized) ? normalized : undefined
}

function sanitizeMediaField(value: unknown): unknown {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (normalized === '' || normalized.length > 2048 || /^[/\\]{2}/.test(normalized)) return undefined
  if (/^https?:\/\//i.test(normalized)) return normalized
  return /^[a-z][a-z0-9+.-]*:/i.test(normalized) ? undefined : normalized
}

function sanitizeColorField(value: unknown): unknown {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length <= 64 && /^(?:#[\da-fA-F]{3,8}|rgba?\([^)]{0,64}\)|hsla?\([^)]{0,64}\)|var\(--dsw-[\w-]+(?:,\s*#[0-9a-fA-F]{3,8})?\))$/.test(normalized)
    ? normalized
    : undefined
}

function sanitizeStringArrayField(value: unknown): unknown {
  if (!Array.isArray(value)) return undefined
  return value.slice(0, GENUI_LIMITS.maxOptions).flatMap(item => {
    if (typeof item === 'string') return [item.slice(0, GENUI_LIMITS.maxString)]
    if (item === null || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const label = typeof record.label === 'string' ? record.label
      : typeof record.value === 'string' ? record.value
      : typeof record.title === 'string' ? record.title
      : JSON.stringify(item)
    return [label.slice(0, GENUI_LIMITS.maxString)]
  })
}

function recordSchema(
  required: readonly string[],
  fields: Readonly<Record<string, FieldSchema>>,
  nested: Readonly<Record<string, RecordSchema>> = {},
  aliases: Readonly<Record<string, string>> = {},
): RecordSchema {
  const normalized = Object.fromEntries(Object.entries(fields).map(([field, definition]) => [field, required.includes(field) ? { ...definition, required: true } : definition]))
  return {
    fields: normalized,
    ...(required.length === 0 ? {} : { required }),
    ...(Object.keys(nested).length === 0 ? {} : { nested }),
    ...(Object.keys(aliases).length === 0 ? {} : { aliases }),
  }
}

function componentSchema(
  required: readonly string[],
  fields: Readonly<Record<string, FieldSchema>>,
  aliases: Readonly<Record<string, string>> = {},
  options: {
    enums?: Readonly<Record<string, readonly unknown[]>>
    nested?: Readonly<Record<string, RecordSchema>>
    children?: readonly ChildTraversalDefinition[]
    semantic?: ComponentSemanticMetadata
    sanitizer?: ComponentSanitizerMetadata
    oneOfRequired?: readonly (readonly string[])[]
    conditionalRequired?: readonly { readonly field: string; readonly equals: unknown; readonly required: readonly string[] }[]
    validate?: ComponentValidator
    sanitize?: ComponentSanitizerFn
  } = {},
): ComponentDefinition {
  const normalized = Object.fromEntries(Object.entries(fields).map(([field, definition]) => {
    const fieldAliases = Object.entries(aliases).filter(([, canonical]) => canonical === field).map(([alias]) => alias)
    const nested = options.nested?.[field]
    return [field, {
      ...definition,
      ...(required.includes(field) ? { required: true } : {}),
      ...(fieldAliases.length === 0 ? {} : { aliases: fieldAliases }),
      ...(options.enums?.[field] === undefined ? {} : { enum: options.enums[field] }),
      ...(nested === undefined ? {} : { nested }),
    }]
  })) as Record<string, FieldSchema>
  return {
    fields: normalized,
    required,
    aliases,
    enums: options.enums ?? {},
    nested: options.nested ?? {},
    ...(options.oneOfRequired === undefined ? {} : { oneOfRequired: options.oneOfRequired }),
    ...(options.conditionalRequired === undefined ? {} : { conditionalRequired: options.conditionalRequired }),
    ...(options.children === undefined ? {} : { children: options.children }),
    ...(options.semantic === undefined ? {} : { semantic: options.semantic }),
    ...(options.sanitizer === undefined ? {} : { sanitizer: options.sanitizer }),
    ...(options.validate === undefined ? {} : { validate: options.validate }),
    ...(options.sanitize === undefined ? {} : { sanitize: options.sanitize }),
  }
}

const chartDatumSchema = recordSchema(['label', 'value'], { label: stringField(128), value: { type: 'number' }, color: stringField(64) })
const chartSeriesSchema = recordSchema(['label', 'data'], { label: stringField(128), color: stringField(64), data: { type: 'array' } }, { data: chartDatumSchema })
const stepsRecordSchema = recordSchema(['title'], { title: stringField(256), desc: stringField() })
const keyValueRecordSchema = recordSchema(['key', 'value'], { key: stringField(256), value: stringField() })
const timelineRecordSchema = recordSchema(['title'], { title: stringField(256), desc: stringField(), time: stringField(128) })
const diffRecordSchema = recordSchema(['path', 'newText'], { path: stringField(1024), oldText: { type: 'string-or-null', maxLength: 20_000 }, newText: stringField(20_000) })
const plotParamSchema = recordSchema(['name', 'value'], { name: stringField(64), value: { type: 'number' }, min: { type: 'number' }, max: { type: 'number' }, step: { type: 'number' }, animateTo: { type: 'number' }, durationMs: { type: 'number' }, loop: { type: 'boolean' } })
const plotSeriesSchema = recordSchema(['expr'], { expr: stringField(512), label: stringField(128), color: stringField(64), kind: { type: 'string', enum: PLOT_KINDS, maxLength: GENUI_LIMITS.maxString }, params: { type: 'array' } }, { params: plotParamSchema })
const sceneMeshSchema = recordSchema(['shape'], { shape: { type: 'string', enum: MESH_SHAPES, maxLength: GENUI_LIMITS.maxString }, color: stringField(64), position: { type: 'array' }, rotation: { type: 'array' }, scale: { type: 'unknown' }, size: { type: 'unknown' } })

function fileTreeRecordSchema(depth: number): RecordSchema {
  return recordSchema(['name'], { name: stringField(256), type: { type: 'string', enum: FILE_TYPES, maxLength: GENUI_LIMITS.maxString }, children: { type: 'array' } }, depth > 0 ? { children: fileTreeRecordSchema(depth - 1) } : {})
}

const fileTreeNodeSchema = fileTreeRecordSchema(GENUI_LIMITS.maxTreeDepth)
const tabHolderSchema = recordSchema(['label', 'items'], { label: stringField(128), items: { type: 'nodes' }, content: { type: 'nodes' } }, {}, { content: 'items' })
const accordionHolderSchema = recordSchema(['title', 'items'], { title: stringField(256), items: { type: 'nodes' } })
const diagramNodeSchema = recordSchema(['id', 'label'], { id: stringField(128), label: stringField(), sub: stringField(256), type: { type: 'string', enum: DIAGRAM_NODE_TYPES, maxLength: GENUI_LIMITS.maxString }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }, tag: stringField(32) })
const diagramEdgeSchema = recordSchema(['from', 'to'], { from: stringField(128), to: stringField(128), label: stringField(GENUI_LIMITS.maxDiagramLabel), kind: { type: 'string', enum: DIAGRAM_EDGE_KINDS, maxLength: GENUI_LIMITS.maxString }, route: { type: 'string', enum: DIAGRAM_ROUTES, maxLength: GENUI_LIMITS.maxString } })
const diagramZoneSchema = recordSchema(['label'], { label: stringField(64), x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } })
const diagramThemeSchema = recordSchema([], { paper: colorField(), 'paper-2': colorField(), ink: colorField(), muted: colorField(), soft: colorField(), rule: colorField(), accent: colorField(), 'accent-tint': colorField(), link: colorField() })

/** Root specification fields in the same runtime format as native components. */
export const SPEC_SCHEMA = componentSchema(['items'], { title: stringField(), gap: { type: 'number', min: 0, max: 96 }, panel: { type: 'boolean' }, append: { type: 'boolean' }, items: { type: 'nodes' } })

/** Explicit long-form root schema name retained for compatibility facades. */
export const GENUI_SPEC_SCHEMA = SPEC_SCHEMA

/** Native component definitions; every protocol rule is declared in this registry. */
const RAW_COMPONENT_SCHEMAS: Readonly<Record<string, ComponentDefinition>> = {
  accordion: componentSchema(['items'], { ...nodeField, items: { type: 'array' } }, {}, { nested: { items: accordionHolderSchema }, children: [{ field: 'items', kind: 'records', childrenField: 'items' }] }),
  audio: componentSchema(['src'], { ...nodeField, src: urlField('media'), alt: stringField(), loop: { type: 'boolean' } }),
  avatar: componentSchema(['name'], { ...nodeField, name: stringField(64), color: colorField() }),
  badge: componentSchema(['label'], { ...nodeField, label: stringField(), tone: stringField(), icon: stringField(64) }, { text: 'label', value: 'label' }, { enums: { tone: ['success', 'warn', 'danger', 'accent'] } }),
  breadcrumb: componentSchema(['items'], { ...nodeField, items: { type: 'array' } }),
  button: componentSchema(['label'], { ...nodeField, label: stringField(), tone: stringField(), full: { type: 'boolean' }, small: { type: 'boolean' }, icon: stringField(64), action: stringField(200) }, {}, { enums: { tone: BUTTON_TONES } }),
  callout: componentSchema(['content'], { ...nodeField, title: stringField(), content: stringField(), tone: stringField() }, { kind: 'tone' }, { enums: { tone: CALLOUT_TONES } }),
  card: componentSchema(['items'], { ...nodeField, title: stringField(), items: { type: 'nodes' } }, { label: 'title', content: 'items' }, { children: [{ field: 'items', kind: 'nodes' }] }),
  chart: componentSchema([], { ...nodeField, kind: stringField(), data: { type: 'array' }, series: { type: 'array' } }, {}, { oneOfRequired: [['data', 'series']], conditionalRequired: [{ field: 'kind', equals: 'line', required: ['data'] }, { field: 'kind', equals: 'donut', required: ['data'] }], nested: { data: chartDatumSchema, series: chartSeriesSchema }, enums: { kind: CHART_KINDS }, semantic: { validator: 'chart-renderability' }, sanitizer: { name: 'field-limits-and-safe-values' }, validate: (node, context) => validateChartNode(node, context.path) }),
  checkbox: componentSchema(['label'], { ...nodeField, label: stringField(), checked: { type: 'boolean' }, action: stringField(200) }),
  code: componentSchema(['code'], { ...nodeField, lang: stringField(64), code: { type: 'string', maxLength: GENUI_LIMITS.maxCode } }),
  col: componentSchema(['items'], { ...nodeField, items: { type: 'nodes' }, gap: { type: 'number', min: 0, max: 96 } }, {}, { children: [{ field: 'items', kind: 'nodes' }] }),
  copy: componentSchema(['text'], { ...nodeField, label: stringField(128), text: { type: 'string', maxLength: GENUI_LIMITS.maxCode } }),
  diagram: componentSchema(['kind', 'nodes'], { ...nodeField, kind: stringField(), variant: stringField(), title: stringField(256), nodes: { type: 'array' }, edges: { type: 'array' }, zones: { type: 'array' }, theme: { type: 'object' } }, {}, { nested: { nodes: diagramNodeSchema, edges: diagramEdgeSchema, zones: diagramZoneSchema, theme: diagramThemeSchema }, enums: { kind: DIAGRAM_KINDS, variant: DIAGRAM_VARIANTS } }),
  diff: componentSchema(['diffs'], { ...nodeField, diffs: { type: 'array' } }, {}, { nested: { diffs: diffRecordSchema } }),
  divider: componentSchema([], nodeField),
  echart: componentSchema([], { ...nodeField, title: stringField(), height: { type: 'number', min: 100, max: 800, integer: true }, preset: stringField(), data: { type: 'array' }, series: { type: 'array' }, option: { type: 'object' } }, {}, { oneOfRequired: [['option', 'data', 'series']], enums: { preset: ECHART_PRESETS } }),
  'file-tree': componentSchema(['items'], { ...nodeField, items: { type: 'array' } }, {}, { nested: { items: fileTreeNodeSchema }, sanitizer: { name: 'bounded-file-tree-records' } }),
  grid: componentSchema(['items'], { ...nodeField, cols: { type: 'number', min: 1, max: GENUI_LIMITS.maxGridCols }, items: { type: 'nodes' } }, {}, { children: [{ field: 'items', kind: 'nodes' }] }),
  image: componentSchema(['src'], { ...nodeField, src: urlField('media'), alt: stringField() }),
  input: componentSchema([], { ...nodeField, label: stringField(), placeholder: stringField(), value: stringField(), inputType: stringField(), action: stringField(200), id: stringField(200) }, {}, { enums: { inputType: INPUT_TYPES } }),
  json: componentSchema(['value'], { ...nodeField, value: { type: 'unknown' } }),
  keyvalue: componentSchema(['pairs'], { ...nodeField, pairs: { type: 'array' } }, {}, { nested: { pairs: keyValueRecordSchema } }),
  link: componentSchema(['label'], { ...nodeField, label: stringField(), href: urlField('href') }),
  list: componentSchema(['items'], { ...nodeField, items: { type: 'array' } }, {}, { children: [{ field: 'items', kind: 'nodes' }] }),
  mermaid: componentSchema(['code'], { ...nodeField, code: { type: 'string', maxLength: GENUI_LIMITS.maxMermaid } }),
  plot: componentSchema(['series'], { ...nodeField, series: { type: 'array' }, xMin: { type: 'number' }, xMax: { type: 'number' }, yMin: { type: 'number' }, yMax: { type: 'number' }, title: stringField() }, {}, { nested: { series: plotSeriesSchema } }),
  progress: componentSchema(['value'], { ...nodeField, value: { type: 'number', min: 0, max: 100, rangeError: true }, label: stringField(), valueLabel: stringField(64) }),
  quiz: componentSchema(['question', 'options'], { ...nodeField, question: stringField(), options: { type: 'array' }, explanation: stringField(), id: stringField(200), action: stringField(200) }),
  radio: componentSchema(['options'], { ...nodeField, label: stringField(), options: stringArrayField(), selected: { type: 'number' }, action: stringField(200), group: stringField(200), answer: { type: 'unknown' }, explanation: stringField() }),
  row: componentSchema(['items'], { ...nodeField, items: { type: 'nodes' }, wrap: { type: 'boolean' }, spacer: { type: 'boolean' } }, {}, { children: [{ field: 'items', kind: 'nodes' }] }),
  scene3d: componentSchema(['meshes'], { ...nodeField, title: stringField(), meshes: { type: 'array' }, ambient: { type: 'number', min: 0, max: 2 }, background: colorField() }, {}, { nested: { meshes: sceneMeshSchema } }),
  select: componentSchema(['options'], { ...nodeField, label: stringField(), options: stringArrayField(), action: stringField(200), selected: { type: 'number' }, id: stringField(200) }),
  slider: componentSchema([], { ...nodeField, label: stringField(), min: { type: 'number' }, max: { type: 'number' }, step: { type: 'number' }, value: { type: 'number' }, action: stringField(200), id: stringField(200) }),
  spacer: componentSchema([], nodeField),
  stat: componentSchema(['label', 'value'], { ...nodeField, label: stringField(), value: stringField(128), delta: stringField(64) }),
  steps: componentSchema(['steps'], { ...nodeField, steps: { type: 'array' }, current: { type: 'number' } }, { items: 'steps' }, { nested: { steps: stepsRecordSchema } }),
  submit: componentSchema(['label'], { ...nodeField, label: stringField(), action: stringField(200), resetAction: stringField(200), groups: { type: 'array' } }),
  switch: componentSchema(['label'], { ...nodeField, label: stringField(), checked: { type: 'boolean' }, action: stringField(200) }),
  table: componentSchema(['columns', 'rows'], { ...nodeField, columns: { type: 'array' }, rows: { type: 'array' } }, { headers: 'columns', data: 'rows' }, { semantic: { validator: 'table-row-values' }, validate: (node, context) => validateTableNode(node, context.path) }),
  tabs: componentSchema(['tabs'], { ...nodeField, tabs: { type: 'array' } }, {}, { nested: { tabs: tabHolderSchema }, children: [{ field: 'tabs', kind: 'records', childrenField: 'items' }] }),
  text: componentSchema(['content'], { ...nodeField, content: stringField(), size: stringField(), center: { type: 'boolean' } }, { text: 'content' }, { enums: { size: TEXT_SIZES } }),
  textarea: componentSchema([], { ...nodeField, label: stringField(), placeholder: stringField(), rows: { type: 'number', min: 1, max: 30, integer: true }, value: stringField(), action: stringField(200), id: stringField(200) }),
  timeline: componentSchema(['items'], { ...nodeField, items: { type: 'array' } }, {}, { nested: { items: timelineRecordSchema } }),
  video: componentSchema(['src'], { ...nodeField, src: urlField('media'), alt: stringField(), poster: urlField('media'), loop: { type: 'boolean' }, muted: { type: 'boolean' }, aspectRatio: stringField() }, {}, { enums: { aspectRatio: MEDIA_ASPECT_RATIOS } }),
} as const

const COMPONENT_SANITIZERS: Readonly<Record<string, ComponentSanitizerFn>> = {
  ...containerSanitizers,
  ...dataSanitizers,
  ...advancedSanitizers,
}

/**
 * Complete native registry. Specialized repair behavior is attached to the
 * same definition that declares the component fields, so a component cannot
 * silently be added without its repair policy.
 */
export const COMPONENT_SCHEMAS: Readonly<Record<string, ComponentDefinition>> = Object.fromEntries(
  Object.entries(RAW_COMPONENT_SCHEMAS).map(([type, definition]) => [
    type,
    COMPONENT_SANITIZERS[type] === undefined
      ? definition
      : { ...definition, sanitize: COMPONENT_SANITIZERS[type] },
  ]),
) as Readonly<Record<string, ComponentDefinition>>

export const GENUI_NATIVE_TYPES: ReadonlySet<string> = new Set(Object.keys(COMPONENT_SCHEMAS))

/** Return the runtime definition for a native type, if it is registered. */
export function getComponentDefinition(type: string): ComponentDefinition | undefined {
  return COMPONENT_SCHEMAS[type]
}
