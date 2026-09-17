import { describe, expect, it, vi } from "vitest";
import { healthCheck, normalizeBaseURL, slugify } from "../dist/bin/setup.js";

describe("slugify", () => {
  it("lowercases and replaces runs of invalid characters", () => {
    expect(slugify("My Router")).toBe("my-router");
    expect(slugify("  Weird  Name!!  ")).toBe("weird-name");
  });

  it("preserves hyphens and underscores", () => {
    expect(slugify("my_router-prod")).toBe("my_router-prod");
  });
});

describe("normalizeBaseURL", () => {
  it("adds an https scheme when missing", () => {
    expect(normalizeBaseURL("localhost:20127/v1")).toBe("https://localhost:20127/v1");
  });

  it("keeps an explicit scheme and strips trailing slashes", () => {
    expect(normalizeBaseURL("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
  });

  it("returns an empty string for empty input", () => {
    expect(normalizeBaseURL("   ")).toBe("");
  });
});

describe("healthCheck", () => {
  it("reports success with the model count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }), { status: 200 })),
    );
    const result = await healthCheck("http://host/v1");
    expect(result.ok).toBe(true);
    expect(result.modelCount).toBe(2);
    expect(result.baseURL).toBe("http://host/v1");
    vi.unstubAllGlobals();
  });

  it("reports failure with an error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const result = await healthCheck("http://host/v1");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
    vi.unstubAllGlobals();
  });
});