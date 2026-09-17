export interface RawModel {
  id: string;
  [k: string]: unknown;
}

export interface FetchModelsResult {
  /** Resolved inference base URL (the prefix that `/models` was fetched from). */
  baseURL: string;
  models: RawModel[];
}

export interface FetchModelsOptions {
  apiKey?: string;
  headers?: Record<string, string>;
  /** Per-request timeout in milliseconds. Defaults to 10000. */
  timeoutMs?: number;
  /** Number of retries per candidate URL on network errors. Defaults to 1. */
  retries?: number;
  /** Injectable fetch implementation (used by tests). */
  fetchImpl?: typeof fetch;
}

export class ModelsFetchError extends Error {
  readonly status?: number;
  readonly url?: string;
  readonly attempts: string[];

  constructor(message: string, opts: { status?: number; url?: string; attempts?: string[] } = {}) {
    super(message);
    this.name = "ModelsFetchError";
    this.status = opts.status;
    this.url = opts.url;
    this.attempts = opts.attempts ?? [];
  }
}

export function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Build candidate `/models` URLs for a user-supplied base URL. Versioned bases
 * (`.../v1`) are used verbatim; unversioned bases get both `/v1/models` and
 * `/models` tried so a bare host still works.
 */
export function candidateModelURLs(baseURL: string): string[] {
  const base = stripTrailingSlashes(baseURL);
  if (/\/v\d+$/.test(base)) return [`${base}/models`];
  return [`${base}/v1/models`, `${base}/models`];
}

export function extractModelArray(payload: unknown): RawModel[] {
  let list: unknown;
  if (Array.isArray(payload)) {
    list = payload;
  } else if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.data)) list = record.data;
    else if (Array.isArray(record.models)) list = record.models;
    else if (record.data && typeof record.data === "object") {
      const nested = record.data as Record<string, unknown>;
      if (Array.isArray(nested.data)) list = nested.data;
    }
  }
  if (!Array.isArray(list)) return [];
  const out: RawModel[] = [];
  for (const entry of list) {
    if (typeof entry === "string" && entry.length > 0) {
      out.push({ id: entry });
      continue;
    }
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      if (typeof record.id === "string" && record.id.length > 0) {
        out.push(record as RawModel);
      }
    }
  }
  return out;
}

async function fetchOnce(
  url: string,
  opts: FetchModelsOptions,
): Promise<{ ok: boolean; status: number; payload?: unknown; error?: string }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url, { method: "GET", headers, signal: controller.signal });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      return { ok: false, status: res.status, error: "response was not valid JSON" };
    }
    return { ok: true, status: res.status, payload };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the model catalog from an OpenAI-compatible endpoint, trying the
 * versioned URL first and falling back to `/models`. Returns the resolved
 * inference base URL alongside the raw model entries.
 */
export async function fetchModels(
  baseURL: string,
  opts: FetchModelsOptions = {},
): Promise<FetchModelsResult> {
  const candidates = candidateModelURLs(baseURL);
  const attempts: string[] = [];
  const retries = opts.retries ?? 1;
  let last: { status: number; url: string; error: string } | undefined;
  let sawEmptyCatalog: FetchModelsResult | undefined;

  for (const url of candidates) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const result = await fetchOnce(url, opts);
      attempts.push(`${url} -> ${result.error ?? result.status}`);
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) {
          throw new ModelsFetchError(
            `Authentication failed (${result.error}) for ${url}. Check the API key.`,
            { status: result.status, url, attempts },
          );
        }
        last = { status: result.status, url, error: result.error ?? "unknown error" };
        continue;
      }
      const models = extractModelArray(result.payload);
      const resolvedBase = url.replace(/\/models$/, "");
      if (models.length === 0) {
        // Valid endpoint but empty catalog: remember it, keep trying other shapes.
        sawEmptyCatalog = { baseURL: resolvedBase, models };
        continue;
      }
      return { baseURL: resolvedBase, models };
    }
  }

  if (sawEmptyCatalog) return sawEmptyCatalog;
  throw new ModelsFetchError(
    `Could not fetch models from ${baseURL}: ${last?.error ?? "no reachable endpoint"}`,
    { status: last?.status, url: last?.url, attempts },
  );
}