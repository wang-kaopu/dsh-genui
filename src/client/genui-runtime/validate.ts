/** Schema-driven structural and semantic validation for canonical GenUI values. */
import { COMPONENT_SCHEMAS, SPEC_SCHEMA, type ComponentDefinition, type FieldSchema, type RecordSchema } from './schema.ts'
import type { GenuiDiagnostic } from './types.ts'
import { visitGenuiNodes } from './traverse.ts'
import { GENUI_LIMITS } from './limits.ts'
import { normalizeGenuiSpec } from './normalize.ts'

/** Result of validation before sanitization. */
export interface ValidateResult {
  readonly ok: boolean
  readonly errors: readonly GenuiDiagnostic[]
  readonly warnings: readonly GenuiDiagnostic[]
}

/** Validate a raw or canonical value using the runtime schema and component hooks. */
export function validateGenuiSpec(value: unknown): ValidateResult {
  // Keep the stage convenient to call directly while processGenuiSpec still
  // passes its already-normalized value. Normalization is idempotent, so this
  // does not create a second behavioral path.
  const canonical = normalizeGenuiSpec(value).value
  const errors: GenuiDiagnostic[] = []
  const warnings: GenuiDiagnostic[] = []
  const root = record(canonical)
  if (root === undefined) {
    errors.push(diagnostic('ROOT_SHAPE', 'spec', 'spec root must be an object'))
    return { ok: false, errors, warnings }
  }

  if (typeof root.type === 'string') {
    validateNodeFields(root, 'spec', COMPONENT_SCHEMAS[root.type], errors, warnings)
    visitGenuiNodes(canonical, entry => {
      if (entry.path === 'spec') return
      validateNodeFields(entry.node, entry.path, entry.component, errors, warnings, entry.depth)
    }, { maxNodes: GENUI_LIMITS.maxNodes + 1 })
  } else if (Array.isArray(root.items)) {
    validateFields(root, 'spec', SPEC_SCHEMA.fields, errors, warnings)
    visitGenuiNodes(canonical, entry => {
      validateNodeFields(entry.node, entry.path, entry.component, errors, warnings, entry.depth)
    }, { maxNodes: GENUI_LIMITS.maxNodes + 1 })
  } else {
    errors.push(diagnostic('ROOT_SHAPE', 'spec.items', 'spec.items must be an array'))
  }

  return { ok: errors.length === 0, errors, warnings }
}

/**
 * Collect only unknown-field warnings after canonical alias normalization.
 * This is the structured replacement for the legacy schema diagnostic helper.
 */
export function diagnoseUnknownGenuiFields(value: unknown): GenuiDiagnostic[] {
  const normalized = normalizeGenuiSpec(value)
  return validateGenuiSpec(normalized.value).warnings.filter(diagnostic => diagnostic.code === 'UNKNOWN_FIELD')
}

function validateNodeFields(
  node: Record<string, unknown>,
  path: string,
  definition: ComponentDefinition | undefined,
  errors: GenuiDiagnostic[],
  warnings: GenuiDiagnostic[],
  depth = 0,
): void {
  if (depth > GENUI_LIMITS.maxDepth) {
    errors.push(diagnostic('MAX_DEPTH', path, `${path}: exceeds max depth ${GENUI_LIMITS.maxDepth}`, undefined, undefined, GENUI_LIMITS.maxDepth, depth))
    return
  }
  if (definition === undefined) return
  // Semantic hooks run first so component-level contract failures remain in
  // tree order before primitive field diagnostics for the same node.
  if (definition.validate !== undefined) errors.push(...definition.validate(node, { path }))
  validateFields(node, path, definition.fields, errors, warnings)
  for (const fields of definition.oneOfRequired ?? []) {
    if (fields.every(field => node[field] === undefined)) {
      errors.push(diagnostic('FIELD_REQUIRED', path, `${path}: requires one of ${fields.join(' or ')}`, String(node.type), undefined, fields))
    }
  }
  for (const rule of definition.conditionalRequired ?? []) {
    if (node[rule.field] !== rule.equals) continue
    for (const field of rule.required) {
      if (node[field] === undefined) {
        errors.push(diagnostic('FIELD_REQUIRED', `${path}.${field}`, `${path}: type '${String(node.type)}' requires ${field}`, String(node.type), field))
      }
    }
  }
}

function validateFields(
  value: Record<string, unknown>,
  path: string,
  fields: Readonly<Record<string, FieldSchema>>,
  errors: GenuiDiagnostic[],
  warnings: GenuiDiagnostic[],
  componentName?: string,
): void {
  const component = componentName ?? (typeof value.type === 'string' ? value.type : undefined)
  for (const [field, schema] of Object.entries(fields)) {
    const candidate = value[field]
    if (candidate === undefined) {
      if (schema.required) errors.push(diagnostic('FIELD_REQUIRED', `${path}.${field}`, `${path}: requires ${field} (${fieldLabel(schema.type)})`, component, field, fieldLabel(schema.type)))
      continue
    }
    if (!fieldMatches(candidate, schema.type)) {
      errors.push(diagnostic('FIELD_TYPE', `${path}.${field}`, `${path}.${field} must be ${fieldLabel(schema.type)}`, component, field, fieldLabel(schema.type), typeofValue(candidate)))
      continue
    }
    if (schema.enum !== undefined && !schema.enum.includes(candidate)) {
      const detail = value.type === 'chart' && field === 'kind'
        ? `${path}.${field} must be bars, line, or donut`
        : `${path}.${field} must be one of ${schema.enum.join(', ')}`
      errors.push(diagnostic('FIELD_ENUM', `${path}.${field}`, detail, component, field, schema.enum, candidate))
    }
    if (typeof candidate === 'number' && (schema.min !== undefined || schema.max !== undefined)) {
      const below = schema.min !== undefined && candidate < schema.min
      const above = schema.max !== undefined && candidate > schema.max
      if (below || above) {
        const range = `${schema.min ?? '-∞'}..${schema.max ?? '∞'}`
        const rangeDiagnostic = diagnostic('FIELD_RANGE', `${path}.${field}`, `${path}.${field} must be in ${range}`, component, field, range, candidate)
        if (schema.rangeError === true) errors.push(rangeDiagnostic)
        else warnings.push({ ...rangeDiagnostic, severity: 'warning' })
      }
    }
    if (schema.nested !== undefined) validateRecordField(candidate, `${path}.${field}`, schema.nested, errors, warnings, component)
  }
  for (const field of Object.keys(value)) {
    if (field === 'type' || field in fields) continue
    warnings.push({
      severity: 'warning',
      code: 'UNKNOWN_FIELD',
      path: `${path}.${field}`,
      ...(component === undefined ? {} : { component }),
      field,
      detail: `${path}.${field} is an unknown field and is not declared by the runtime schema`,
    })
  }
}

function validateRecordField(value: unknown, path: string, schema: RecordSchema, errors: GenuiDiagnostic[], warnings: GenuiDiagnostic[], component?: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateRecord(item, `${path}[${index}]`, schema, errors, warnings, component))
    return
  }
  validateRecord(value, path, schema, errors, warnings, component)
}

function validateRecord(value: unknown, path: string, schema: RecordSchema, errors: GenuiDiagnostic[], warnings: GenuiDiagnostic[], component?: string): void {
  const recordValue = record(value)
  if (recordValue === undefined) {
    errors.push(diagnostic('FIELD_TYPE', path, `${path} must be an object`, component, undefined, 'object', typeofValue(value)))
    return
  }
  validateFields(recordValue, path, schema.fields, errors, warnings, component)
  for (const [field, nested] of Object.entries(schema.nested ?? {})) {
    if (recordValue[field] !== undefined) validateRecordField(recordValue[field], `${path}.${field}`, nested, errors, warnings, component)
  }
}

function fieldMatches(value: unknown, type: FieldSchema['type']): boolean {
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'string-or-null': return value === null || typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'boolean': return typeof value === 'boolean'
    case 'nodes':
    case 'array': return Array.isArray(value)
    case 'object': return record(value) !== undefined
    case 'unknown': return true
  }
}

function fieldLabel(type: FieldSchema['type']): string {
  switch (type) {
    case 'string-or-null': return 'a string or null'
    case 'number': return 'a finite number'
    case 'boolean': return 'a boolean'
    case 'nodes':
    case 'array': return 'an array'
    case 'object': return 'an object'
    case 'unknown': return 'a value'
    default: return 'a string'
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function typeofValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function diagnostic(code: GenuiDiagnostic['code'], path: string, detail: string, component?: string, field?: string, expected?: unknown, actual?: unknown): GenuiDiagnostic {
  return {
    severity: 'error',
    code,
    path,
    ...(component === undefined ? {} : { component }),
    ...(field === undefined ? {} : { field }),
    ...(expected === undefined ? {} : { expected }),
    ...(actual === undefined ? {} : { actual }),
    detail,
  }
}
