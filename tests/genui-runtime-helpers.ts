import type { GenuiSpec } from '../src/client/spec.ts'
import { processGenuiSpec } from '../src/client/genui-runtime/index.ts'

/** Return the canonical render spec used by renderer-focused tests. */
export function canonicalSpec(value: unknown): GenuiSpec | null {
  return processGenuiSpec(value).spec
}

/** Return whether a raw value is accepted by the structured runtime protocol. */
export function isValidSpec(value: unknown): boolean {
  return processGenuiSpec(value).errors.length === 0
}
