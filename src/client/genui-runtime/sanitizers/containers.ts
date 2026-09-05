import { GENUI_LIMITS, int, num, opt, repairItems, repairListItems, str, type ComponentSanitizerFn } from './helpers.ts'
import { repairAccordion, repairTabs } from './collections.ts'

/** Component-specific sanitizers for native containers. */
export const containerSanitizers: Readonly<Record<string, ComponentSanitizerFn>> = {
  row: (value, ctx, depth, path) => ({
    type: 'row',
    items: repairItems(value.items, ctx, depth + 1, `${path}.items`),
    ...opt('wrap', value.wrap === true ? true : undefined),
    ...opt('spacer', value.spacer === true ? true : undefined),
  }),
  col: (value, ctx, depth, path) => ({
    type: 'col',
    items: repairItems(value.items, ctx, depth + 1, `${path}.items`),
    ...opt('gap', num(value.gap, 0, 96)),
  }),
  grid: (value, ctx, depth, path) => ({
    type: 'grid',
    cols: int(value.cols, 1, GENUI_LIMITS.maxGridCols) ?? 1,
    items: repairItems(value.items, ctx, depth + 1, `${path}.items`),
  }),
  card: (value, ctx, depth, path) => ({
    type: 'card',
    items: repairItems(value.items, ctx, depth + 1, `${path}.items`),
    ...opt('title', str(value.title, GENUI_LIMITS.maxString)),
  }),
  list: (value, ctx, depth, path) => {
    const items = repairListItems(value.items, GENUI_LIMITS.maxListItems, ctx, depth + 1, `${path}.items`)
    return items === undefined ? null : { type: 'list', items }
  },
  tabs: (value, ctx, depth, path) => {
    const tabs = repairTabs(value.tabs, ctx, depth, `${path}.tabs`)
    return tabs === undefined ? null : { type: 'tabs', tabs }
  },
  accordion: (value, ctx, depth, path) => {
    const items = repairAccordion(value.items, ctx, depth, `${path}.items`)
    return items === undefined ? null : { type: 'accordion', items }
  },
}
