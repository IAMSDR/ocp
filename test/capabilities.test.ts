import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT,
  DEFAULT_OUTPUT,
  normalizeCapabilities,
  normalizeLimits,
} from "../dist/map/capabilities.js";

describe("normalizeCapabilities", () => {
  it("reads the 9router-style nested capabilities object", () => {
    const caps = normalizeCapabilities({
      id: "m",
      capabilities: {
        vision: true,
        pdf: true,
        tools: true,
        reasoning: true,
        contextWindow: 1000000,
        maxOutput: 384000,
      },
    });
    expect(caps.attachment).toBe(true);
    expect(caps.toolcall).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.temperature).toBe(true);
    expect(caps.input.image).toBe(true);
    expect(caps.input.pdf).toBe(true);
  });

  it("infers from input_modalities when flags are absent", () => {
    const caps = normalizeCapabilities({
      id: "m",
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
    });
    expect(caps.input.image).toBe(true);
    expect(caps.attachment).toBe(true);
    expect(caps.input.audio).toBe(false);
  });

  it("falls back to conservative defaults on an unknown payload", () => {
    const caps = normalizeCapabilities({ id: "m" });
    expect(caps.attachment).toBe(false);
    expect(caps.toolcall).toBe(false);
    expect(caps.reasoning).toBe(false);
    expect(caps.temperature).toBe(true);
    expect(caps.input).toEqual({ text: true, audio: false, image: false, video: false, pdf: false });
  });

  it("respects an explicit temperature=false", () => {
    expect(normalizeCapabilities({ id: "m", capabilities: { temperature: false } }).temperature).toBe(
      false,
    );
  });
});

describe("normalizeLimits", () => {
  it("reads context_length and max_completion_tokens", () => {
    expect(normalizeLimits({ id: "m", context_length: 200000, max_completion_tokens: 8192 })).toEqual({
      context: 200000,
      output: 8192,
    });
  });

  it("reads nested capabilities fields", () => {
    expect(
      normalizeLimits({ id: "m", capabilities: { contextWindow: 1000000, maxOutput: 384000 } }),
    ).toEqual({ context: 1000000, output: 384000 });
  });

  it("accepts numeric strings", () => {
    expect(normalizeLimits({ id: "m", context_length: "128000" }).context).toBe(128000);
  });

  it("falls back to safe defaults when limits are absent or invalid", () => {
    expect(normalizeLimits({ id: "m" })).toEqual({ context: DEFAULT_CONTEXT, output: DEFAULT_OUTPUT });
    expect(normalizeLimits({ id: "m", context_length: 0, max_tokens: -5 })).toEqual({
      context: DEFAULT_CONTEXT,
      output: DEFAULT_OUTPUT,
    });
  });
});