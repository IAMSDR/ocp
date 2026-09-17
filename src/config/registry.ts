import fs from "node:fs/promises";
import path from "node:path";
import { registryPath } from "../paths.js";

export interface ProviderFilters {
  include?: string[];
  exclude?: string[];
}

export interface ProviderEntry {
  /** OpenCode provider id (slug). */
  id: string;
  /** Human-readable provider name shown in the picker. */
  name: string;
  /** Fully qualified OpenAI-compatible base URL, usually ending in `/v1`. */
  baseURL: string;
  /** Whether the provider participates in the catalog at startup. */
  enabled: boolean;
  /** Key name inside auth.json holding the API key. Defaults to `id`. */
  apiKeyRef?: string;
  /** When true the setup script requires an API key. Defaults to false. */
  apiKeyRequired?: boolean;
  /** Extra headers sent with inference requests. */
  headers?: Record<string, string>;
  /** Per-provider model allow/block lists. */
  models?: ProviderFilters;
}

export interface Registry {
  version: 1;
  providers: Record<string, ProviderEntry>;
}

const EMPTY: Registry = { version: 1, providers: {} };

export async function readRegistry(): Promise<Registry> {
  let body: string;
  try {
    body = await fs.readFile(registryPath(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY, providers: {} };
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`Malformed registry at ${registryPath()}: not valid JSON`);
  }
  return normalizeRegistry(parsed);
}

export function normalizeRegistry(input: unknown): Registry {
  const providers: Record<string, ProviderEntry> = {};
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const rawProviders = (input as { providers?: unknown }).providers;
    if (rawProviders && typeof rawProviders === "object" && !Array.isArray(rawProviders)) {
      for (const [id, value] of Object.entries(rawProviders as Record<string, unknown>)) {
        const entry = normalizeEntry(id, value);
        if (entry) providers[id] = entry;
      }
    }
  }
  return { version: 1, providers };
}

function normalizeEntry(id: string, value: unknown): ProviderEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.baseURL !== "string" || v.baseURL.length === 0) return undefined;
  const filters = normalizeFilters(v.models);
  return {
    id,
    name: typeof v.name === "string" && v.name.length > 0 ? v.name : id,
    baseURL: v.baseURL,
    enabled: v.enabled !== false,
    apiKeyRef: typeof v.apiKeyRef === "string" && v.apiKeyRef.length > 0 ? v.apiKeyRef : undefined,
    apiKeyRequired: v.apiKeyRequired === true,
    headers: normalizeHeaders(v.headers),
    models: filters,
  };
}

function normalizeFilters(value: unknown): ProviderFilters | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const include = normalizeStringArray(v.include);
  const exclude = normalizeStringArray(v.exclude);
  if (!include && !exclude) return undefined;
  return { ...(include ? { include } : {}), ...(exclude ? { exclude } : {}) };
}

function normalizeHeaders(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === "string" && v.length > 0);
  return out.length > 0 ? out : undefined;
}

export async function writeRegistry(registry: Registry): Promise<void> {
  const file = registryPath();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify(registry, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function getProvider(id: string): Promise<ProviderEntry | undefined> {
  const registry = await readRegistry();
  return registry.providers[id];
}

export async function upsertProvider(entry: ProviderEntry): Promise<void> {
  const registry = await readRegistry();
  registry.providers[entry.id] = entry;
  await writeRegistry(registry);
}

export async function removeProvider(id: string): Promise<boolean> {
  const registry = await readRegistry();
  if (!(id in registry.providers)) return false;
  delete registry.providers[id];
  await writeRegistry(registry);
  return true;
}