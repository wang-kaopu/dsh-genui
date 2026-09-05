import type { EChartPreset, GenuiDiagram, GenuiDiagramEdge, GenuiDiagramKind, GenuiDiagramNodeType, GenuiDiagramTheme, GenuiDiagramVariant, GenuiFileTreeNode, GenuiScene3D } from '../../spec.ts'
import { GENUI_LIMITS, color, nestedSchemaEnum, num, obj, opt, schemaEnum, str } from './helpers.ts'
import { repairChartData, repairSeries } from './collections.ts'
import type { ComponentSanitizerFn } from './helpers.ts'

/** Repair advanced visual components whose payloads have specialized limits. */
export const advancedSanitizers: Readonly<Record<string, ComponentSanitizerFn>> = {
  copy: value => {
    const text = str(value.text, GENUI_LIMITS.maxCode)
    return text === undefined ? null : { type: 'copy', text, ...opt('label', str(value.label, 128)) }
  },
  mermaid: value => {
    const code = str(value.code, GENUI_LIMITS.maxMermaid)
    return code === undefined ? null : { type: 'mermaid', code }
  },
  scene3d: value => {
    const meshes = repairMeshes(value.meshes)
    return meshes === undefined ? null : {
      type: 'scene3d',
      meshes,
      ...opt('title', str(value.title, GENUI_LIMITS.maxString)),
      ...opt('ambient', num(value.ambient, 0, 2)),
      ...opt('background', color(value.background)),
    }
  },
  diagram: value => repairDiagram(value),
  'file-tree': value => {
    const items = repairTree(value.items, GENUI_LIMITS.maxListItems)
    return items === undefined ? null : { type: 'file-tree', items }
  },
  echart: value => {
    const data = value.data !== undefined ? repairChartData(value.data, GENUI_LIMITS.maxChartPoints) : undefined
    const series = value.series !== undefined && Array.isArray(value.series)
      ? repairSeries(value.series, GENUI_LIMITS.maxPlotSeries, GENUI_LIMITS.maxChartPoints)
      : undefined
    const sanitizedOption = value.option !== undefined
      ? sanitizeEChartOption(value.option, 0, { count: GENUI_LIMITS.maxEChartOptionNodes })
      : undefined
    const option: Record<string, unknown> | undefined = sanitizedOption !== undefined
      && typeof sanitizedOption === 'object'
      && sanitizedOption !== null
      && !Array.isArray(sanitizedOption)
      ? sanitizedOption as Record<string, unknown>
      : undefined
    if (option === undefined && data === undefined && series === undefined) return null
    return {
      type: 'echart',
      ...opt('title', str(value.title, GENUI_LIMITS.maxString)),
      ...opt('height', int(value.height, 100, 800)),
      ...opt('preset', schemaEnum<EChartPreset>('echart', 'preset', value.preset)),
      ...opt('data', data),
      ...opt('series', series),
      ...opt('option', option),
    }
  },
}

/** Repair scene3d mesh records and their bounded vectors. */
function repairMeshes(value: unknown): GenuiScene3D['meshes'] | undefined {
  if (!Array.isArray(value)) return undefined
  const output: GenuiScene3D['meshes'] = []
  for (const mesh of value) {
    if (output.length >= GENUI_LIMITS.maxMeshes) break
    const record = obj(mesh)
    const shape = record === undefined ? undefined : nestedSchemaEnum<'box' | 'sphere' | 'cone' | 'cylinder' | 'torus'>('scene3d', 'meshes', 'shape', record.shape)
    if (shape === undefined) continue
    const scale = record === undefined ? undefined : num(record.scale, -1e6, 1e6) ?? tuple3(record.scale)
    const size = record === undefined ? undefined : num(record.size, -1e6, 1e6) ?? tuple3(record.size)
    output.push({
      shape,
      ...opt('color', color(record!.color)),
      ...opt('position', tuple3(record!.position)),
      ...opt('rotation', tuple3(record!.rotation)),
      ...opt('scale', scale),
      ...opt('size', size),
    })
  }
  return output
}

/** Repair a bounded numeric vector. */
function tuple3(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined
  const [a, b, c] = value
  if (typeof a !== 'number' || !Number.isFinite(a) || typeof b !== 'number' || !Number.isFinite(b) || typeof c !== 'number' || !Number.isFinite(c)) return undefined
  return [num(a, -1e6, 1e6)!, num(b, -1e6, 1e6)!, num(c, -1e6, 1e6)!]
}

/** Clamp editorial diagram coordinates to a four-pixel grid. */
function grid4(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value / 4) * 4))
}

/** Repair diagram nodes, deduplicating ids and clamping editorial geometry. */
function repairDiagramNodes(value: unknown): GenuiDiagram['nodes'] | undefined {
  if (!Array.isArray(value)) return undefined
  const output: GenuiDiagram['nodes'] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (output.length >= GENUI_LIMITS.maxDiagramNodes) break
    const record = obj(raw)
    if (record === undefined) continue
    const id = str(record.id, 128)
    const label = str(record.label, GENUI_LIMITS.maxString)
    if (id === undefined || label === undefined || seen.has(id)) continue
    seen.add(id)
    const nodeType = nestedSchemaEnum<GenuiDiagramNodeType>('diagram', 'nodes', 'type', record.type)
    const x = record.x === undefined ? undefined : grid4(num(record.x, -1e6, 1e6) ?? 0, 0, 1e6)
    const y = record.y === undefined ? undefined : grid4(num(record.y, -1e6, 1e6) ?? 0, 0, 1e6)
    const width = record.w === undefined ? undefined : grid4(num(record.w, -1e6, 1e6) ?? 96, 40, 2000)
    const height = record.h === undefined ? undefined : grid4(num(record.h, -1e6, 1e6) ?? 48, 24, 1200)
    output.push({ id, label, ...opt('sub', str(record.sub, 256)), ...opt('type', nodeType), ...opt('x', x), ...opt('y', y), ...opt('w', width), ...opt('h', height), ...opt('tag', str(record.tag, 32)) })
  }
  return output
}

/** Repair diagram edges and keep only bounded endpoint records. */
function repairDiagramEdges(value: unknown): GenuiDiagram['edges'] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const output: GenuiDiagram['edges'] = []
  for (const raw of value) {
    if (output.length >= GENUI_LIMITS.maxDiagramEdges) break
    const record = obj(raw)
    if (record === undefined) continue
    const from = str(record.from, 128)
    const to = str(record.to, 128)
    if (from === undefined || to === undefined) continue
    output.push({
      from,
      to,
      ...opt('label', str(record.label, GENUI_LIMITS.maxDiagramLabel)),
      ...opt('kind', nestedSchemaEnum<NonNullable<GenuiDiagramEdge['kind']>>('diagram', 'edges', 'kind', record.kind)),
      ...opt('route', nestedSchemaEnum<NonNullable<GenuiDiagramEdge['route']>>('diagram', 'edges', 'route', record.route)),
    })
  }
  return output
}

/** Sanitize the diagram theme through the shared color policy. */
function repairDiagramTheme(value: unknown): GenuiDiagramTheme | undefined {
  const record = obj(value)
  if (record === undefined) return undefined
  const output: GenuiDiagramTheme = {}
  for (const key of ['paper', 'paper-2', 'ink', 'muted', 'soft', 'rule', 'accent', 'accent-tint', 'link'] as const) {
    const safeColor = color(record[key])
    if (safeColor !== undefined) output[key] = safeColor
  }
  return Object.keys(output).length === 0 ? undefined : output
}

/** Repair optional diagram zones and clamp their geometry. */
function repairDiagramZones(value: unknown): GenuiDiagram['zones'] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const output: GenuiDiagram['zones'] = []
  for (const raw of value) {
    if (output.length >= GENUI_LIMITS.maxDiagramZones) break
    const record = obj(raw)
    const label = record === undefined ? undefined : str(record.label, 64)
    if (record === undefined || label === undefined) continue
    output.push({ label, ...opt('x', record.x === undefined ? undefined : grid4(num(record.x, -1e6, 1e6) ?? 0, 0, 1e6)), ...opt('y', record.y === undefined ? undefined : grid4(num(record.y, -1e6, 1e6) ?? 0, 0, 1e6)), ...opt('w', record.w === undefined ? undefined : grid4(num(record.w, -1e6, 1e6) ?? 100, 40, 2000)), ...opt('h', record.h === undefined ? undefined : grid4(num(record.h, -1e6, 1e6) ?? 100, 40, 1200)) })
  }
  return output
}

/** Repair a coordinate-based diagram. */
function repairDiagram(value: unknown): GenuiDiagram | null {
  const record = obj(value)
  if (record === undefined) return null
  const kind = schemaEnum<GenuiDiagramKind>('diagram', 'kind', record.kind)
  const nodes = repairDiagramNodes(record.nodes)
  const edges = repairDiagramEdges(record.edges)
  const zones = repairDiagramZones(record.zones)
  if (kind === undefined || nodes === undefined || edges === undefined || zones === undefined) return null
  return {
    type: 'diagram',
    kind,
    nodes,
    edges,
    zones,
    ...opt('variant', schemaEnum<GenuiDiagramVariant>('diagram', 'variant', record.variant)),
    ...opt('title', str(record.title, 256)),
    ...opt('theme', repairDiagramTheme(record.theme)),
  }
}

/** Repair bounded file-tree records without treating them as GenUI nodes. */
/** Repair the bounded root list of file-tree records. */
function repairTree(value: unknown, cap: number): GenuiFileTreeNode[] | undefined {
  return walkTree(value, cap, GENUI_LIMITS.maxTreeDepth)
}

/** Recursively repair file-tree records up to the configured depth. */
function walkTree(value: unknown, cap: number, depthLeft: number): GenuiFileTreeNode[] | undefined {
  if (!Array.isArray(value)) return undefined
  const output: GenuiFileTreeNode[] = []
  for (const item of value) {
    if (output.length >= cap) break
    const record = obj(item)
    const name = record === undefined ? undefined : str(record.name, 256)
    if (name === undefined) continue
    const children = depthLeft > 0 && Array.isArray(record!.children) ? walkTree(record!.children, cap, depthLeft - 1) : undefined
    output.push({ name, ...opt('type', nestedSchemaEnum<NonNullable<GenuiFileTreeNode['type']>>('file-tree', 'items', 'type', record!.type)), ...opt('children', children) })
  }
  return output
}

interface EChartSanitizeBudget { count: number }

const ECHART_HTML_DANGER_RE = /<(?:script|img|svg|iframe|video|audio|object|embed|source)\b|on[a-z]+\s*=|javascript:/i

/** Sanitize an ECharts option with depth, size, and unsafe-string limits. */
/** Recursively sanitize an ECharts option under depth and node budgets. */
function sanitizeEChartOption(value: unknown, depth: number, budget: EChartSanitizeBudget): unknown {
  if (budget.count <= 0) return undefined
  budget.count -= 1
  if (depth > GENUI_LIMITS.maxEChartOptionDepth) return undefined
  if (typeof value === 'string') {
    const text = value.slice(0, GENUI_LIMITS.maxString)
    return text.toLowerCase().includes('url(') || ECHART_HTML_DANGER_RE.test(text) ? undefined : text
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) {
    const output: unknown[] = []
    for (let index = 0; index < Math.min(value.length, GENUI_LIMITS.maxEChartArrayLen); index++) {
      const sanitized = sanitizeEChartOption(value[index], depth + 1, budget)
      if (sanitized !== undefined) output.push(sanitized)
    }
    return output.length > 0 ? output : undefined
  }
  const record = obj(value)
  if (record === undefined) return undefined
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(record)) {
    const sanitized = sanitizeEChartOption(child, depth + 1, budget)
    if (sanitized === undefined) continue
    if (key === 'tooltip' && typeof sanitized === 'object' && sanitized !== null && !Array.isArray(sanitized)) {
      (sanitized as Record<string, unknown>).renderMode = 'richText'
    }
    output[key] = sanitized
  }
  return Object.keys(output).length > 0 ? output : undefined
}

/** Clamp a number to an integer range for the ECharts height field. */
/** Clamp a finite number to an integer range for ECharts dimensions. */
function int(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : undefined
}
