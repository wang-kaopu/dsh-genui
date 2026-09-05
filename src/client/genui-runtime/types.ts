/** Shared structured types for the GenUI runtime protocol. */

/** Primitive and structural field kinds understood by the runtime schema. */
export type ComponentFieldKind =
  | 'string'
  | 'string-or-null'
  | 'number'
  | 'boolean'
  | 'nodes'
  | 'array'
  | 'object'
  | 'unknown'

/** Severity of a diagnostic emitted while processing a GenUI value. */
export type GenuiDiagnosticSeverity = 'error' | 'warning'

/** Stable machine-readable reason for a GenUI diagnostic. */
export type GenuiDiagnosticCode =
  | 'ROOT_SHAPE'
  | 'UNKNOWN_COMPONENT'
  | 'UNKNOWN_FIELD'
  | 'FIELD_TYPE'
  | 'FIELD_REQUIRED'
  | 'FIELD_ENUM'
  | 'FIELD_RANGE'
  | 'FIELD_UNSUPPORTED'
  | 'FIELD_ALIAS'
  | 'NODE_DROPPED'
  | 'NODE_LIMIT'
  | 'MAX_DEPTH'
  | 'CHART_EMPTY'
  | 'CHART_SERIES_UNSUPPORTED'
  | 'UNSAFE_VALUE'
  | 'VALUE_CLAMPED'
  | 'VALUE_TRUNCATED'

/** A structured, locale-independent GenUI processing diagnostic. */
export interface GenuiDiagnostic {
  readonly severity: GenuiDiagnosticSeverity
  readonly code: GenuiDiagnosticCode
  readonly path: string
  readonly component?: string
  readonly field?: string
  readonly expected?: unknown
  readonly actual?: unknown
  readonly alias?: string
  readonly canonical?: string
  /** Whether the alias was present but ignored because canonical won. */
  readonly aliasIgnored?: boolean
  /** Optional internal detail retained for logs and compatibility messages. */
  readonly detail?: string
}

/** Aggregate counts returned by the canonical processor. */
export interface GenuiProcessStats {
  readonly declaredNative: number
  readonly renderedNative: number
  readonly renderedTotal: number
}

/** The single runtime result shared by validation and all render consumers. */
export interface GenuiProcessResult<TSpec = import('../spec.ts').GenuiSpec> {
  readonly raw: unknown
  readonly normalized: unknown
  readonly spec: TSpec | null
  readonly errors: readonly GenuiDiagnostic[]
  readonly warnings: readonly GenuiDiagnostic[]
  readonly stats: GenuiProcessStats
}

/** A result whose spec passed the shared renderability policy. */
export type RenderableGenuiResult<TSpec = import('../spec.ts').GenuiSpec> = GenuiProcessResult<TSpec> & {
  readonly spec: TSpec
}
