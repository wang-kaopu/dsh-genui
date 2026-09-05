import type { GenuiChart, GenuiList, GenuiNode, GenuiPlot, GenuiPlotSeries } from '../../spec.ts'
import { GENUI_LIMITS, color, nestedSchemaEnum, num, obj, opt, repairItems, str, type RepairCtx } from './helpers.ts'

/** Repair a bounded list of strings, accepting common object-shaped options. */
export function repairStrings(value: unknown, cap: number, stringCap: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const output: string[] = []
  for (const item of value) {
    if (output.length >= cap) break
    if (typeof item === 'string') {
      output.push(item.slice(0, stringCap))
      continue
    }
    if (item !== null && typeof item === 'object') {
      const record = item as Record<string, unknown>
      const text = typeof record.label === 'string' ? record.label
        : typeof record.value === 'string' ? record.value
          : typeof record.title === 'string' ? record.title
            : JSON.stringify(item)
      output.push(text.slice(0, stringCap))
    }
  }
  return output
}

/** Repair a list of string/number table rows under both row and column limits. */
export function repairRows(value: unknown, rowCap: number, columnCap: number): Array<Array<string | number>> | undefined {
  if (!Array.isArray(value)) return undefined
  const output: Array<Array<string | number>> = []
  for (const row of value) {
    if (output.length >= rowCap) break
    if (!Array.isArray(row)) continue
    const cells: Array<string | number> = []
    for (const cell of row) {
      if (cells.length >= columnCap) break
      if (typeof cell === 'string') cells.push(cell.slice(0, 256))
      else if (typeof cell === 'number' && Number.isFinite(cell)) cells.push(cell)
    }
    if (cells.length > 0) output.push(cells)
  }
  return output
}

/** Repair chart data points and discard incomplete records. */
export function repairChartData(value: unknown, cap: number): Array<{ label: string; value: number; color?: string }> | undefined {
  if (!Array.isArray(value)) return undefined
  const output: Array<{ label: string; value: number; color?: string }> = []
  for (const datum of value) {
    if (output.length >= cap) break
    const record = obj(datum)
    const label = record === undefined ? undefined : str(record.label, 128)
    const pointValue = record === undefined ? undefined : num(record.value, -1e12, 1e12)
    if (label === undefined || pointValue === undefined) continue
    output.push({ label, value: pointValue, ...opt('color', color(record!.color)) })
  }
  return output
}

/** Repair chart series and their nested point data. */
export function repairSeries(value: unknown, cap: number, pointCap: number): Array<{ label: string; color?: string; data: Array<{ label: string; value: number; color?: string }> }> | undefined {
  if (!Array.isArray(value)) return undefined
  const output: Array<{ label: string; color?: string; data: Array<{ label: string; value: number; color?: string }> }> = []
  for (const series of value) {
    if (output.length >= cap) break
    const record = obj(series)
    const label = record === undefined ? undefined : str(record.label, 128)
    const data = record === undefined ? undefined : repairChartData(record.data, pointCap)
    if (label === undefined || data === undefined) continue
    output.push({ label, data, ...opt('color', color(record!.color)) })
  }
  return output
}

/** Repair canonical tabs after normalize has adopted any declared aliases. */
export function repairTabs(value: unknown, ctx: RepairCtx, depth: number, path: string): Array<{ label: string; items: GenuiNode[] }> | undefined {
  if (!Array.isArray(value)) return undefined
  const output: Array<{ label: string; items: GenuiNode[] }> = []
  for (let index = 0; index < value.length; index++) {
    const tab = value[index]
    if (output.length >= GENUI_LIMITS.maxTabs) break
    const record = obj(tab)
    const label = record === undefined ? undefined : str(record.label, 128)
    if (label === undefined || record === undefined) continue
    output.push({ label, items: repairItems(record.items, ctx, depth + 1, `${path}[${index}].items`) })
  }
  return output
}

/** Extract readable headers from object-shaped table columns. */
export function columnHeaderText(value: unknown): string {
  const record = obj(value)
  if (record === undefined) return String(value)
  for (const key of ['title', 'label', 'key', 'dataIndex'] as const) {
    const text = record[key]
    if (typeof text === 'string' && text !== '') return text
  }
  return JSON.stringify(value)
}

/** Extract the row lookup key matching the table header conversion. */
export function columnKeyOf(value: unknown): string | undefined {
  const record = obj(value)
  if (record === undefined) return undefined
  for (const key of ['key', 'dataIndex', 'title', 'label'] as const) {
    const text = record[key]
    if (typeof text === 'string' && text !== '') return text
  }
  return undefined
}

/** Keep table cell alignment when converting object-shaped rows. */
export function cellText(value: unknown): string | number {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value === null || value === undefined) return ''
  return JSON.stringify(value)
}

/** Repair plot series, including bounded numeric animation parameters. */
export function repairPlotSeries(value: unknown, cap: number): GenuiPlot['series'] | undefined {
  if (!Array.isArray(value)) return undefined
  const output: GenuiPlot['series'] = []
  for (const series of value) {
    if (output.length >= cap) break
    const record = obj(series)
    const expr = record === undefined ? undefined : str(record.expr, 512)
    if (expr === undefined || record === undefined) continue
    const params: NonNullable<GenuiPlotSeries['params']> = []
    if (Array.isArray(record.params)) {
      for (const parameter of record.params) {
        if (params.length >= GENUI_LIMITS.maxPlotParams) break
        const parameterRecord = obj(parameter)
        const name = parameterRecord === undefined ? undefined : str(parameterRecord.name, 64)
        const valueNumber = parameterRecord === undefined ? undefined : num(parameterRecord.value, -1e9, 1e9)
        if (name === undefined || valueNumber === undefined) continue
        params.push({
          name,
          value: valueNumber,
          ...opt('min', num(parameterRecord!.min, -1e9, 1e9)),
          ...opt('max', num(parameterRecord!.max, -1e9, 1e9)),
          ...opt('step', num(parameterRecord!.step, 1e-9, 1e9)),
          ...opt('animateTo', num(parameterRecord!.animateTo, -1e9, 1e9)),
          ...opt('durationMs', num(parameterRecord!.durationMs, 1, 120_000)),
          ...opt('loop', parameterRecord!.loop === true ? true : undefined),
        })
      }
    }
    output.push({
      expr,
      ...opt('label', str(record.label, 128)),
      ...opt('color', color(record.color)),
      ...opt('kind', nestedSchemaEnum<NonNullable<GenuiPlotSeries['kind']>>('plot', 'series', 'kind', record.kind)),
      ...opt('params', params.length > 0 ? params : undefined),
    })
  }
  return output
}

/** Repair bounded step records. */
export function repairSteps(value: unknown): Array<{ title: string; desc?: string }> | undefined {
  if (!Array.isArray(value)) return undefined
  const output: Array<{ title: string; desc?: string }> = []
  for (const step of value) {
    if (output.length >= GENUI_LIMITS.maxSteps) break
    const record = obj(step)
    const title = record === undefined ? undefined : str(record.title, 256)
    if (title === undefined) continue
    output.push({ title, ...opt('desc', str(record!.desc, GENUI_LIMITS.maxString)) })
  }
  return output
}

/** Repair bounded key/value records. */
export function repairPairs(value: unknown, cap: number): Array<{ key: string; value: string }> | undefined {
  if (!Array.isArray(value)) return undefined
  const output: Array<{ key: string; value: string }> = []
  for (const pair of value) {
    if (output.length >= cap) break
    const record = obj(pair)
    const key = record === undefined ? undefined : str(record.key, 256)
    const pairValue = record === undefined ? undefined : str(record.value, GENUI_LIMITS.maxString)
    if (key === undefined || pairValue === undefined) continue
    output.push({ key, value: pairValue })
  }
  return output
}

/** Repair bounded diff records. */
export function repairDiffs(value: unknown): Array<{ path: string; oldText: string | null; newText: string }> | undefined {
  if (!Array.isArray(value)) return undefined
  const output: Array<{ path: string; oldText: string | null; newText: string }> = []
  for (const diff of value) {
    if (output.length >= 24) break
    const record = obj(diff)
    const path = record === undefined ? undefined : str(record.path, 1024)
    const newText = record === undefined ? undefined : str(record.newText, 20_000)
    if (path === undefined || newText === undefined) continue
    output.push({ path, newText, oldText: record!.oldText === null || typeof record!.oldText !== 'string' ? null : record!.oldText.slice(0, 20_000) })
  }
  return output
}

/** Repair accordion records and recursively sanitize their child nodes. */
export function repairAccordion(value: unknown, ctx: RepairCtx, depth: number, path: string): Array<{ title: string; items: GenuiNode[] }> | undefined {
  if (!Array.isArray(value)) return undefined
  const output: Array<{ title: string; items: GenuiNode[] }> = []
  for (let index = 0; index < value.length; index++) {
    if (output.length >= GENUI_LIMITS.maxAccordionItems) break
    const record = obj(value[index])
    const title = record === undefined ? undefined : str(record.title, 256)
    if (title === undefined || record === undefined) continue
    output.push({ title, items: repairItems(record.items, ctx, depth + 1, `${path}[${index}].items`) })
  }
  return output
}

/** Repair timeline records. */
export function repairTimeline(value: unknown, cap: number): Array<{ title: string; desc?: string; time?: string }> | undefined {
  if (!Array.isArray(value)) return undefined
  const output: Array<{ title: string; desc?: string; time?: string }> = []
  for (const item of value) {
    if (output.length >= cap) break
    const record = obj(item)
    const title = record === undefined ? undefined : str(record.title, 256)
    if (title === undefined) continue
    output.push({ title, ...opt('desc', str(record!.desc, GENUI_LIMITS.maxString)), ...opt('time', str(record!.time, 128)) })
  }
  return output
}

/** Repair quiz options and migrate the common top-level answer shorthand. */
export function repairQuizOptions(value: unknown, answer?: unknown): Array<{ label: string; correct?: boolean; feedback?: string }> | undefined {
  if (!Array.isArray(value)) return undefined
  const output: Array<{ label: string; correct?: boolean; feedback?: string }> = []
  for (const option of value) {
    if (output.length >= GENUI_LIMITS.maxQuizOptions) break
    const record = obj(option)
    const label = typeof option === 'string' ? str(option, 512) : record === undefined ? undefined : str(record.label, 512)
    if (label === undefined) continue
    output.push({ label, ...opt('correct', record?.correct === true ? true : undefined), ...opt('feedback', str(record?.feedback, GENUI_LIMITS.maxString)) })
  }
  if (output.length === 0) return undefined
  if (output.some(option => option.correct === true)) return output
  const answerIndex = typeof answer === 'number' && Number.isFinite(answer)
    ? Math.trunc(answer)
    : typeof answer === 'string' ? output.findIndex(option => option.label === answer.slice(0, 512)) : -1
  if (answerIndex < 0 || answerIndex >= output.length) return output
  return output.map((option, index) => index === answerIndex ? { ...option, correct: true } : option)
}

/** Keep the list type visible to callers that use the shared helper. */
export type { GenuiChart, GenuiList }
