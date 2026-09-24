import { DIMENSIONS, type GroupBy } from './types.js'

/** Event names: letters (any script), digits, `_ $ . : -` and spaces; up to 128 chars. */
export const EVENT_NAME = /^[\p{L}\p{N}_$][\p{L}\p{N}_$.:\- ]{0,127}$/u
/** Property keys: like event names but without spaces; up to 64 chars. */
export const PROPERTY_KEY = /^[\p{L}\p{N}_$][\p{L}\p{N}_$.:\-]{0,63}$/u

export const MAX_PROPERTIES = 100
export const MAX_PROPERTIES_BYTES = 16_384

export function parseGroupBy(value: string | undefined | null): GroupBy | null {
  if (!value) return null
  if ((DIMENSIONS as readonly string[]).includes(value)) return value as GroupBy
  if (value.startsWith('prop:') && PROPERTY_KEY.test(value.slice(5))) return value as GroupBy
  return null
}
