import type { RawModel } from "../fetch/models.js";
import { normalizeCapabilities, normalizeLimits, type NormalizedCapabilities, type NormalizedLimits } from "./capabilities.js";
import { extractCost, type NormalizedCost } from "./cost.js";
import { asRecord } from "./util.js";

export type Modality = "text" | "audio" | "image" | "video" | "pdf";
export type ModelStatus = "alpha" | "beta" | "deprecated" | "active";

export interface StaticModelEntry {
  name: string;
  release_date?: string;
  attachment?: boolean;
  reasoning?: boolean;
  temperature?: boolean;
  tool_call?: boolean;
  cost?: { input: number; output: number; cache_read?: number; cache_write?: number };
  limit?: { context: number; output: number };
  modalities?: { input: Modality[]; output: Modality[] };
  status?: ModelStatus;
  options?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface ModelV2Entry {
  id: string;
  providerID: string;
  name: string;
  family?: string;
  api: { id: string; url: string; npm: string };
  capabilities: NormalizedCapabilities & { interleaved: false };
  cost: { input: number; output: number; cache: { read: number; write: number } };
  limit: NormalizedLimits;
  status: ModelStatus;
  options: Record<string, unknown>;
  headers: Record<string, string>;
  release_date: string;
}

export const OPENAI_COMPATIBLE_NPM = "@ai-sdk/openai-compatible";
export const OPENAI_COMPATIBLE_API_ID = "openai-compatible";

function modalityArray(
  caps: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean },
): Modality[] {
  const out: Modality[] = [];
  if (caps.text) out.push("text");
  if (caps.image) out.push("image");
  if (caps.audio) out.push("audio");
  if (caps.video) out.push("video");
  if (caps.pdf) out.push("pdf");
  return out.length > 0 ? out : ["text"];
}

function displayName(raw: RawModel): string {
  const name = raw.name ?? raw.display_name ?? raw.displayName;
  if (typeof name === "string" && name.trim().length > 0) return name.trim();
  return raw.id;
}

function releaseDate(raw: RawModel): string {
  const direct = raw.release_date ?? raw.releaseDate;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const created = raw.created ?? raw.created_at;
  if (typeof created === "number" && Number.isFinite(created) && created > 0) {
    const ms = created > 1e12 ? created : created * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return "";
}

function costForStatic(cost: NormalizedCost | undefined): StaticModelEntry["cost"] | undefined {
  if (!cost) return undefined;
  return {
    input: cost.input,
    output: cost.output,
    ...(cost.cache.read ? { cache_read: cost.cache.read } : {}),
    ...(cost.cache.write ? { cache_write: cost.cache.write } : {}),
  };
}

/**
 * Map a raw `/v1/models` entry to OpenCode's static `provider.<id>.models[...]`
 * shape (flat booleans, used by the `config` hook).
 */
export function mapToStaticEntry(raw: RawModel): StaticModelEntry {
  const caps = normalizeCapabilities(raw);
  const limits = normalizeLimits(raw);
  const cost = costForStatic(extractCost(raw));
  const release = releaseDate(raw);

  return {
    name: displayName(raw),
    attachment: caps.attachment,
    reasoning: caps.reasoning,
    temperature: caps.temperature,
    tool_call: caps.toolcall,
    limit: { context: limits.context, output: limits.output },
    modalities: {
      input: modalityArray(caps.input),
      output: modalityArray(caps.output),
    },
    cost,
    ...(release ? { release_date: release } : {}),
    status: "active",
    options: {},
    headers: {},
  };
}

/**
 * Map a raw `/v1/models` entry to the dynamic ModelV2 shape used by the
 * `provider.models()` hook (nested capabilities object).
 */
export function mapToModelV2(raw: RawModel, ctx: { providerID: string; baseURL: string }): ModelV2Entry {
  const caps = normalizeCapabilities(raw);
  const limits = normalizeLimits(raw);
  const cost = extractCost(raw);
  const release = releaseDate(raw);

  return {
    id: raw.id,
    providerID: ctx.providerID,
    name: displayName(raw),
    api: {
      id: OPENAI_COMPATIBLE_API_ID,
      url: ctx.baseURL,
      npm: OPENAI_COMPATIBLE_NPM,
    },
    capabilities: { ...caps, interleaved: false },
    cost: {
      input: cost?.input ?? 0,
      output: cost?.output ?? 0,
      cache: { read: cost?.cache.read ?? 0, write: cost?.cache.write ?? 0 },
    },
    limit: limits,
    status: "active",
    options: {},
    headers: {},
    release_date: release,
  };
}

export { asRecord } from "./util.js";