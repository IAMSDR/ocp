import type { RawModel } from "../fetch/models.js";
import { asRecord } from "./util.js";

export interface NormalizedCost {
  input: number;
  output: number;
  cache: { read: number; write: number };
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function firstNum(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = num(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

const PER_TOKEN = 1_000_000;

function scale(value: unknown, factor: number): number | undefined {
  const parsed = num(value);
  return parsed === undefined ? undefined : parsed * factor;
}

/**
 * Extract per-million-token pricing from a model entry.
 *
 * Gateways expose two conventions, sometimes in the same payload:
 *
 *   1. Per-million fields (used verbatim): `pricing.input`, `pricing.output`,
 *      `pricing.cached`, `pricing.cacheRead`/`cacheWrite`,
 *      `pricing.cache_creation`, and the OpenCode static `cost.*` shape.
 *   2. Per-token fields (scaled by 1e6): `pricing.prompt`,
 *      `pricing.completion`, `pricing.input_cache_read`,
 *      `pricing.input_cache_write`.
 *
 * Per-million fields win; per-token fields fill the gaps. Returns `undefined`
 * when no pricing information is present at all.
 */
export function extractCost(raw: RawModel): NormalizedCost | undefined {
  const pricing = asRecord(raw.pricing);
  const cost = asRecord(raw.cost);
  const costCache = asRecord(cost.cache);

  const input = firstNum(pricing.input, cost.input, scale(pricing.prompt, PER_TOKEN));
  const output = firstNum(pricing.output, cost.output, scale(pricing.completion, PER_TOKEN));
  const cacheRead = firstNum(
    pricing.cacheRead,
    pricing.cache_read,
    pricing.cached,
    pricing.cached_read,
    cost.cache_read,
    costCache.read,
    scale(pricing.input_cache_read, PER_TOKEN),
  );
  const cacheWrite = firstNum(
    pricing.cacheWrite,
    pricing.cache_write,
    pricing.cache_creation,
    cost.cache_write,
    costCache.write,
    scale(pricing.input_cache_write, PER_TOKEN),
  );

  if (input === undefined && output === undefined && cacheRead === undefined && cacheWrite === undefined) {
    return undefined;
  }
  return {
    input: input ?? 0,
    output: output ?? 0,
    cache: { read: cacheRead ?? 0, write: cacheWrite ?? 0 },
  };
}