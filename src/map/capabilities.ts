import type { RawModel, } from "../fetch/models.js";
import { asRecord } from "./util.js";

export interface NormalizedCapabilities {
  attachment: boolean;
  toolcall: boolean;
  reasoning: boolean;
  temperature: boolean;
  input: {
    text: boolean;
    audio: boolean;
    image: boolean;
    video: boolean;
    pdf: boolean;
  };
  output: {
    text: boolean;
    audio: boolean;
    image: boolean;
    video: boolean;
    pdf: boolean;
  };
}

export interface NormalizedLimits {
  context: number;
  output: number;
}

export const DEFAULT_CONTEXT = 128_000;
export const DEFAULT_OUTPUT = 4_096;

function firstBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function firstPositiveNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
    }
  }
  return undefined;
}

function modalityList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === "string").map((v) => v.toLowerCase());
  return out.length > 0 ? out : undefined;
}

/**
 * Infer model capabilities from a permissive set of possible source shapes.
 * Recognizes both flat flags and nested `capabilities`, plus `input_modalities`
 * / `output_modalities` arrays. Falls back to conservative defaults.
 */
export function normalizeCapabilities(raw: RawModel): NormalizedCapabilities {
  const caps = asRecord(raw.capabilities);
  const limits = asRecord(raw.limit);

  const vision = firstBoolean(caps.vision, caps.image, caps.imageInput, raw.vision);
  const pdf = firstBoolean(caps.pdf, caps.pdfInput, raw.pdf);
  const audioIn = firstBoolean(caps.audioInput, caps.audio, raw.audioInput);
  const videoIn = firstBoolean(caps.videoInput, caps.video, raw.videoInput);
  const imageOut = firstBoolean(caps.imageOutput, raw.imageOutput);
  const audioOut = firstBoolean(caps.audioOutput, raw.audioOutput);
  const videoOut = firstBoolean(caps.videoOutput, raw.videoOutput);

  const inMods = modalityList(raw.input_modalities);
  const outMods = modalityList(raw.output_modalities);

  const hasImageIn = vision ?? inMods?.includes("image") ?? false;
  const hasPdfIn = pdf ?? inMods?.includes("pdf") ?? false;
  const hasAudioIn = audioIn ?? inMods?.includes("audio") ?? false;
  const hasVideoIn = videoIn ?? inMods?.includes("video") ?? false;

  const toolcall =
    firstBoolean(caps.tools, caps.tool_calling, caps.tool_call, raw.tool_call, raw.tools) ?? false;
  const reasoning =
    firstBoolean(caps.reasoning, caps.thinking, raw.reasoning, raw.thinking) ?? false;
  const temperature =
    firstBoolean(caps.temperature, raw.temperature, limits.temperature) ?? true;

  const textIn = firstBoolean(caps.text, raw.text) ?? true;
  const textOut = firstBoolean(caps.textOutput, raw.textOutput) ?? true;

  return {
    attachment: Boolean(hasImageIn || hasPdfIn),
    toolcall: Boolean(toolcall),
    reasoning: Boolean(reasoning),
    temperature,
    input: {
      text: textIn,
      audio: Boolean(hasAudioIn),
      image: Boolean(hasImageIn),
      video: Boolean(hasVideoIn),
      pdf: Boolean(hasPdfIn),
    },
    output: {
      text: textOut,
      audio: Boolean(audioOut ?? outMods?.includes("audio") ?? false),
      image: Boolean(imageOut ?? outMods?.includes("image") ?? false),
      video: Boolean(videoOut ?? outMods?.includes("video") ?? false),
      pdf: Boolean(firstBoolean(caps.pdfOutput) ?? outMods?.includes("pdf") ?? false),
    },
  };
}

/**
 * Resolve context/output limits from the many field names seen across
 * OpenAI-compatible gateways, falling back to safe defaults.
 */
export function normalizeLimits(raw: RawModel): NormalizedLimits {
  const caps = asRecord(raw.capabilities);
  const limit = asRecord(raw.limit);
  const context =
    firstPositiveNumber(
      raw.context_length,
      caps.contextWindow,
      caps.context_window,
      raw.context_window,
      raw.context,
      limit.context,
      raw.max_context_length,
    ) ?? DEFAULT_CONTEXT;
  const output =
    firstPositiveNumber(
      raw.max_completion_tokens,
      caps.maxOutput,
      caps.max_output_tokens,
      raw.max_output_tokens,
      raw.max_tokens,
      limit.output,
    ) ?? DEFAULT_OUTPUT;
  return { context, output };
}