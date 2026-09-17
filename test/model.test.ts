import { describe, expect, it } from "vitest";
import {
  mapToModelV2,
  mapToStaticEntry,
  OPENAI_COMPATIBLE_NPM,
} from "../dist/map/model.js";

const raw = {
  id: "tt/deepseek-v4-flash-free",
  object: "model",
  owned_by: "tt",
  capabilities: {
    vision: false,
    pdf: false,
    tools: true,
    reasoning: true,
    contextWindow: 1000000,
    maxOutput: 384000,
  },
  context_length: 1000000,
  max_completion_tokens: 384000,
  pricing: { input: 0.14, output: 0.28, cached: 0.0028, cache_creation: 0.14 },
};

describe("mapToStaticEntry", () => {
  it("maps a rich payload to the flat static shape", () => {
    const entry = mapToStaticEntry(raw);
    expect(entry).toMatchObject({
      name: "tt/deepseek-v4-flash-free",
      attachment: false,
      reasoning: true,
      temperature: true,
      tool_call: true,
      limit: { context: 1000000, output: 384000 },
      status: "active",
    });
    expect(entry.cost).toEqual({
      input: 0.14,
      output: 0.28,
      cache_read: 0.0028,
      cache_write: 0.14,
    });
  });

  it("prefers a display name when present", () => {
    expect(mapToStaticEntry({ id: "m", name: "Friendly Name" }).name).toBe("Friendly Name");
  });

  it("uses safe defaults for a minimal payload", () => {
    const entry = mapToStaticEntry({ id: "m" });
    expect(entry.limit).toEqual({ context: 128000, output: 4096 });
    expect(entry.attachment).toBe(false);
    expect(entry.tool_call).toBe(false);
    expect(entry.cost).toBeUndefined();
    expect(entry.modalities).toEqual({ input: ["text"], output: ["text"] });
  });

  it("derives modalities from vision/pdf flags", () => {
    const entry = mapToStaticEntry({ id: "m", capabilities: { vision: true, pdf: true } });
    expect(entry.modalities?.input).toEqual(["text", "image", "pdf"]);
  });

  it("derives a release date from a created timestamp", () => {
    const entry = mapToStaticEntry({ id: "m", created: 1_700_000_000 });
    expect(entry.release_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("mapToModelV2", () => {
  it("maps to the nested ModelV2 shape with provider + api info", () => {
    const entry = mapToModelV2(raw, {
      providerID: "local9",
      baseURL: "http://localhost:20127/v1",
    });
    expect(entry.id).toBe("tt/deepseek-v4-flash-free");
    expect(entry.providerID).toBe("local9");
    expect(entry.api).toEqual({
      id: "openai-compatible",
      url: "http://localhost:20127/v1",
      npm: OPENAI_COMPATIBLE_NPM,
    });
    expect(entry.capabilities.toolcall).toBe(true);
    expect(entry.capabilities.interleaved).toBe(false);
    expect(entry.limit).toEqual({ context: 1000000, output: 384000 });
    expect(entry.cost).toEqual({
      input: 0.14,
      output: 0.28,
      cache: { read: 0.0028, write: 0.14 },
    });
  });

  it("zeroes cost when pricing is absent", () => {
    const entry = mapToModelV2({ id: "m" }, { providerID: "p", baseURL: "http://x/v1" });
    expect(entry.cost).toEqual({ input: 0, output: 0, cache: { read: 0, write: 0 } });
  });
});