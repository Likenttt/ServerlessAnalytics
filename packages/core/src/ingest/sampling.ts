import type { SamplingConfig } from '../types.js'
import { ERROR_EVENT } from './errors.js'

/** Deterministic hash → [0, 1): FNV-1a with a murmur3 finalizer for good spread. */
export function unitHash(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export interface SamplingDecision {
  keep: boolean
  /** Events this row stands for. */
  weight: number
  /** Users each sampled user stands for. */
  userWeight: number
}

const KEEP_ALL: SamplingDecision = { keep: true, weight: 1, userWeight: 1 }

export function rateFor(config: SamplingConfig, event: string): number {
  const override = config.overrides.find((o) => o.event === event)
  if (override) return override.rate
  return event === ERROR_EVENT ? 1 : config.rate
}

/**
 * Decisions are hashed, never random: a retried event (same id) or the same
 * user always gets the same answer, so sampling stays stable across batches.
 */
export function decide(config: SamplingConfig, appId: string, event: { name: string; id: string; distinctId: string }): SamplingDecision {
  if (config.mode !== 'sampled') return KEEP_ALL
  const rate = rateFor(config, event.name)
  if (rate >= 1) return KEEP_ALL
  if (rate <= 0) return { keep: false, weight: 0, userWeight: 0 }
  const key = config.strategy === 'user' ? `u:${appId}:${event.distinctId}` : `e:${appId}:${event.id}`
  if (unitHash(key) >= rate) return { keep: false, weight: 0, userWeight: 0 }
  return { keep: true, weight: 1 / rate, userWeight: config.strategy === 'user' ? 1 / rate : 1 }
}
