import { describe, expect, it } from "vitest";
import { extractCost } from "../dist/map/cost.js";

describe("extractCost", () => {
  it("returns undefined when no pricing is present", () => {
    expect(extractCost({ id: "m" })).toBeUndefined();
  });

  it("reads per-million input/output fields verbatim", () => {
    const cost = extractCost({
      id: "m",
      pricing: { input: 0.14, output: 0.28, cached: 0.0028, cache_creation: 0.14 },
    });
    expect(cost).toEqual({
      input: 0.14,
      output: 0.28,
      cache: { read: 0.0028, write: 0.14 },
    });
  });

  it("scales OpenRouter-style per-token prompt/completion by 1e6", () => {
    const cost = extractCost({
      id: "m",
      pricing: { prompt: "1.4e-7", completion: "2.8e-7", input_cache_read: "2.8e-9" },
    });
    expect(cost).toEqual({
      input: 0.14,
      output: 0.28,
      cache: { read: 0.0028, write: 0 },
    });
  });

  it("prefers per-million fields over per-token fields in mixed payloads", () => {
    const cost = extractCost({
      id: "m",
      pricing: { prompt: "1.4e-7", input: 0.14, completion: "2.8e-7", output: 0.28 },
    });
    expect(cost?.input).toBe(0.14);
    expect(cost?.output).toBe(0.28);
  });

  it("reads the OpenCode static cost shape", () => {
    const cost = extractCost({
      id: "m",
      cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
    });
    expect(cost).toEqual({
      input: 3,
      output: 15,
      cache: { read: 0.3, write: 3.75 },
    });
  });

  it("treats explicit zeros as valid pricing", () => {
    const cost = extractCost({ id: "free", pricing: { input: 0, output: 0 } });
    expect(cost).toEqual({ input: 0, output: 0, cache: { read: 0, write: 0 } });
  });
});