import type { RawModel } from "./fetch/models.js";
import type { ProviderEntry } from "./config/registry.js";

export interface ProviderCatalog {
  providerID: string;
  name: string;
  baseURL: string;
  models: RawModel[];
}

/**
 * Deduplicate model entries by id (first wins), preserving order.
 */
export function dedupeModels(models: RawModel[]): RawModel[] {
  const seen = new Set<string>();
  const out: RawModel[] = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    out.push(model);
  }
  return out;
}

export function projectCatalog(entry: ProviderEntry, models: RawModel[]): ProviderCatalog {
  return {
    providerID: entry.id,
    name: entry.name,
    baseURL: entry.baseURL,
    models: dedupeModels(models),
  };
}