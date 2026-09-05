import type { GenuiChart } from '../../spec.ts'
import { GENUI_LIMITS, int, num, opt, schemaEnum, str } from './helpers.ts'
import {
  cellText,
  columnHeaderText,
  columnKeyOf,
  repairChartData,
  repairDiffs,
  repairPairs,
  repairPlotSeries,
  repairRows,
  repairSeries,
  repairQuizOptions,
  repairSteps,
  repairStrings,
  repairTimeline,
} from './collections.ts'
import type { ComponentSanitizerFn } from './helpers.ts'

/** Component-specific sanitizers for structured data and form values. */
export const dataSanitizers: Readonly<Record<string, ComponentSanitizerFn>> = {
  table: value => {
    let rawColumns: unknown = value.columns
    let rawRows: unknown = value.rows !== undefined ? value.rows : value.data
    // Accept common antd-shaped columns and object rows without losing the table.
    if (Array.isArray(rawColumns) && rawColumns.length > 0 && typeof rawColumns[0] === 'object' && rawColumns[0] !== null) {
      rawColumns = rawColumns.map(columnHeaderText)
    }
    if (Array.isArray(rawRows) && rawRows.length > 0 && typeof rawRows[0] === 'object' && rawRows[0] !== null && !Array.isArray(rawRows[0])) {
      const keys = Array.isArray(value.columns) && value.columns.length > 0 && typeof value.columns[0] === 'object' && value.columns[0] !== null
        ? value.columns.map(columnKeyOf).filter((key): key is string => key !== undefined)
        : Object.keys(rawRows[0] as Record<string, unknown>)
      rawRows = rawRows.map(row => keys.map(key => cellText((row as Record<string, unknown>)[key])))
    }
    const columns = repairStrings(rawColumns, GENUI_LIMITS.maxTableCols, 128)
    const rows = repairRows(rawRows, GENUI_LIMITS.maxTableRows, GENUI_LIMITS.maxTableCols)
    return columns === undefined || rows === undefined ? null : { type: 'table', columns, rows }
  },
  chart: value => {
    const data = repairChartData(value.data, GENUI_LIMITS.maxChartPoints)
    const series = Array.isArray(value.series) ? repairSeries(value.series, GENUI_LIMITS.maxPlotSeries, GENUI_LIMITS.maxChartPoints) : undefined
    // Grouped bars may contain series without a top-level data array.
    if (data === undefined && series === undefined) return null
    return { type: 'chart', data: data ?? [], ...opt('kind', schemaEnum<NonNullable<GenuiChart['kind']>>('chart', 'kind', value.kind)), ...opt('series', series) }
  },
  plot: value => {
    const series = repairPlotSeries(value.series, GENUI_LIMITS.maxPlotSeries)
    if (series === undefined) return null
    return {
      type: 'plot',
      series,
      ...opt('xMin', num(value.xMin, -1e6, 1e6)),
      ...opt('xMax', num(value.xMax, -1e6, 1e6)),
      ...opt('yMin', num(value.yMin, -1e9, 1e9)),
      ...opt('yMax', num(value.yMax, -1e9, 1e9)),
      ...opt('title', str(value.title, GENUI_LIMITS.maxString)),
    }
  },
  steps: value => {
    const steps = repairSteps(value.steps)
    return steps === undefined ? null : { type: 'steps', steps, ...opt('current', int(value.current, 0, steps.length)) }
  },
  keyvalue: value => {
    const pairs = repairPairs(value.pairs, GENUI_LIMITS.maxKeyValuePairs)
    return pairs === undefined ? null : { type: 'keyvalue', pairs }
  },
  diff: value => {
    const diffs = repairDiffs(value.diffs)
    return diffs === undefined ? null : { type: 'diff', diffs }
  },
  radio: value => {
    const options = repairStrings(value.options, GENUI_LIMITS.maxOptions, GENUI_LIMITS.maxString)
    if (options === undefined) return null
    const answer = typeof value.answer === 'number' && Number.isFinite(value.answer) && value.answer >= 0 && value.answer < options.length
      ? Math.trunc(value.answer)
      : typeof value.answer === 'string' ? value.answer.slice(0, 512) : undefined
    return {
      type: 'radio',
      options,
      ...opt('label', str(value.label, GENUI_LIMITS.maxString)),
      ...opt('selected', int(value.selected, 0, options.length - 1)),
      ...opt('action', str(value.action, 200)),
      ...opt('group', str(value.group, 200)),
      ...opt('answer', answer),
      ...opt('explanation', str(value.explanation, GENUI_LIMITS.maxString)),
    }
  },
  submit: value => {
    const label = str(value.label, GENUI_LIMITS.maxString)
    if (label === undefined) return null
    return {
      type: 'submit',
      label,
      ...opt('action', str(value.action, 200)),
      ...opt('resetAction', str(value.resetAction, 200)),
      ...opt('groups', repairStrings(value.groups, GENUI_LIMITS.maxOptions, 200)),
    }
  },
  slider: value => {
    const min = num(value.min, -1e9, 1e9) ?? 0
    const max = num(value.max, -1e9, 1e9) ?? 100
    const lo = Math.min(min, max)
    const hi = Math.max(min, max)
    return {
      type: 'slider',
      min: lo,
      max: hi,
      ...opt('step', num(value.step, 1e-9, Math.max(hi - lo, 1e-9))),
      value: num(value.value, lo, hi) ?? lo,
      ...opt('label', str(value.label, GENUI_LIMITS.maxString)),
      ...opt('action', str(value.action, 200)),
      ...opt('id', str(value.id, 200)),
    }
  },
  timeline: value => {
    const items = repairTimeline(value.items, GENUI_LIMITS.maxTimelineItems)
    return items === undefined ? null : { type: 'timeline', items }
  },
  breadcrumb: value => {
    const items = repairStrings(value.items, GENUI_LIMITS.maxBreadcrumbItems, GENUI_LIMITS.maxString)
    return items === undefined ? null : { type: 'breadcrumb', items }
  },
  quiz: value => {
    const question = str(value.question, GENUI_LIMITS.maxString)
    const options = repairQuizOptions(value.options, value.answer)
    return question === undefined || options === undefined ? null : {
      type: 'quiz',
      question,
      options,
      ...opt('explanation', str(value.explanation, GENUI_LIMITS.maxString)),
      ...opt('id', str(value.id, 200)),
      ...opt('action', str(value.action, 200)),
    }
  },
}
