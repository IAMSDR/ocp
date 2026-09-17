import type { RawModel } from "../fetch/models.js";
import type { ProviderFilters } from "../config/registry.js";

/**
 * Match a model id against a filter pattern. Supports:
 *   - exact id:           `claude-sonnet-4-6`
 *   - bare suffix:        `claude-sonnet-4-6` also matches `cc/claude-sonnet-4-6`
 *   - trailing wildcard:  `claude-*`
 *   - leading wildcard:   `*-free`
 *   - global wildcard:    `*`
 */
export function matchPattern(id: string, pattern: string): boolean {
  const p = pattern.trim();
  if (p.length === 0) return false;
  if (p === "*") return true;
  if (p.endsWith("*") && !p.startsWith("*")) {
    return id.startsWith(p.slice(0, -1));
  }
  if (p.startsWith("*") && !p.endsWith("*")) {
    return id.endsWith(p.slice(1));
  }
  if (p.startsWith("*") && p.endsWith("*")) {
    return id.includes(p.slice(1, -1));
  }
  return id === p || id.endsWith(`/${p}`);
}

export function matchesAny(id: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((pattern) => matchPattern(id, pattern));
}

/**
 * Apply per-provider include/exclude filters. Include (when non-empty) is an
 * allowlist; exclude is a denylist applied afterwards. Deny always wins.
 */
export function filterModels(models: RawModel[], filters?: ProviderFilters): RawModel[] {
  const include = filters?.include;
  const exclude = filters?.exclude;
  return models.filter((model) => {
    if (include && include.length > 0 && !matchesAny(model.id, include)) return false;
    if (matchesAny(model.id, exclude)) return false;
    return true;
  });
}