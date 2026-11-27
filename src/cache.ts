import fs from "node:fs/promises";
import path from "node:path";
import type { RawModel } from "./fetch/models.js";
import { stripTrailingSlashes } from "./fetch/models.js";
import { modelsCachePath } from "./paths.js";

export const DEFAULT_CACHE_TTL_MS = 60_000;

export interface CachedProviderModels {
  configBaseURL: string;
  baseURL: string;
  fetchedAt: number;
  models: RawModel[];
}

export interface ModelsCache {
  version: 1;
  entries: Record<string, CachedProviderModels>;
}

const EMPTY_CACHE: ModelsCache = { version: 1, entries: {} };

export function resolveCacheTtlMs(): number {
  const raw = process.env.OCP_CACHE_TTL_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_CACHE_TTL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_CACHE_TTL_MS;
  return Math.floor(parsed);
}

export async function readModelsCache(): Promise<ModelsCache> {
  let body: string;
  try {
    body = await fs.readFile(modelsCachePath(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, entries: {} };
    return { version: 1, entries: {} };
  }
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { version: 1, entries: {} };
    }
    const rawEntries = (parsed as { entries?: unknown }).entries;
    if (!rawEntries || typeof rawEntries !== "object" || Array.isArray(rawEntries)) {
      return { version: 1, entries: {} };
    }
    const entries: Record<string, CachedProviderModels> = {};
    for (const [id, value] of Object.entries(rawEntries as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const rec = value as Record<string, unknown>;
      if (
        typeof rec.configBaseURL !== "string" ||
        typeof rec.baseURL !== "string" ||
        typeof rec.fetchedAt !== "number" ||
        !Number.isFinite(rec.fetchedAt) ||
        !Array.isArray(rec.models)
      ) {
        continue;
      }
      const models = rec.models.filter(
        (m): m is RawModel => Boolean(m && typeof m === "object" && !Array.isArray(m) && typeof (m as RawModel).id === "string"),
      );
      entries[id] = {
        configBaseURL: rec.configBaseURL,
        baseURL: rec.baseURL,
        fetchedAt: rec.fetchedAt,
        models,
      };
    }
    return { version: 1, entries };
  } catch {
    return { version: 1, entries: {} };
  }
}

export async function writeModelsCache(cache: ModelsCache): Promise<void> {
  const file = modelsCachePath();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify(cache), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function getCachedEntry(
  cache: ModelsCache,
  providerID: string,
  baseURL: string,
): CachedProviderModels | undefined {
  const entry = cache.entries[providerID];
  if (!entry) return undefined;
  if (entry.configBaseURL !== stripTrailingSlashes(baseURL)) return undefined;
  return entry;
}

export function isCacheFresh(
  entry: CachedProviderModels,
  now = Date.now(),
  ttlMs = resolveCacheTtlMs(),
): boolean {
  if (ttlMs <= 0) return false;
  const age = now - entry.fetchedAt;
  return age >= 0 && age < ttlMs;
}

export function emptyModelsCache(): ModelsCache {
  return { ...EMPTY_CACHE, entries: {} };
}
