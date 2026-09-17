import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  candidateModelURLs,
  extractModelArray,
  fetchModels,
  ModelsFetchError,
  stripTrailingSlashes,
} from "../dist/fetch/models.js";

describe("candidateModelURLs", () => {
  it("uses a versioned base verbatim", () => {
    expect(candidateModelURLs("https://api.x.com/v1")).toEqual(["https://api.x.com/v1/models"]);
  });

  it("tries /v1 and bare for unversioned bases", () => {
    expect(candidateModelURLs("https://api.x.com")).toEqual([
      "https://api.x.com/v1/models",
      "https://api.x.com/models",
    ]);
  });

  it("strips trailing slashes", () => {
    expect(candidateModelURLs("http://localhost:20127/v1///")).toEqual([
      "http://localhost:20127/v1/models",
    ]);
    expect(stripTrailingSlashes("http://x/v1/")).toBe("http://x/v1");
  });
});

describe("extractModelArray", () => {
  it("reads the OpenAI {data:[...]} envelope", () => {
    expect(extractModelArray({ object: "list", data: [{ id: "a" }, { id: "b" }] })).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });

  it("reads a bare array", () => {
    expect(extractModelArray([{ id: "a" }])).toEqual([{ id: "a" }]);
  });

  it("reads a {models:[...]} envelope", () => {
    expect(extractModelArray({ models: [{ id: "a" }] })).toEqual([{ id: "a" }]);
  });

  it("accepts bare string entries", () => {
    expect(extractModelArray(["a", "b"])).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("drops entries without a usable id", () => {
    expect(extractModelArray({ data: [{ id: "a" }, { name: "no-id" }, null, 42] })).toEqual([
      { id: "a" },
    ]);
  });

  it("returns [] for unrecognized shapes", () => {
    expect(extractModelArray(null)).toEqual([]);
    expect(extractModelArray({ foo: "bar" })).toEqual([]);
  });
});

describe("fetchModels", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches a versioned endpoint and resolves the base URL", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const result = await fetchModels("http://localhost:20127/v1", { fetchImpl: fetchImpl as never });
    expect(result.baseURL).toBe("http://localhost:20127/v1");
    expect(result.models.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to /models for an unversioned base", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/v1/models")) return new Response("nope", { status: 404 });
      return new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 });
    });
    const result = await fetchModels("http://host:1234", { fetchImpl: fetchImpl as never });
    expect(result.baseURL).toBe("http://host:1234");
    expect(result.models.map((m) => m.id)).toEqual(["m1"]);
  });

  it("sends a Bearer token when an API key is provided", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer sk-test");
      return new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 });
    });
    await fetchModels("http://host/v1", { apiKey: "sk-test", fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("throws a descriptive error on 401 without retrying other candidates", async () => {
    const fetchImpl = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    await expect(
      fetchModels("http://host/v1", { apiKey: "bad", fetchImpl: fetchImpl as never }),
    ).rejects.toBeInstanceOf(ModelsFetchError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting all candidates", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(
      fetchModels("http://host", { fetchImpl: fetchImpl as never, retries: 0 }),
    ).rejects.toThrow(/Could not fetch models/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns an empty catalog when the endpoint is valid but empty", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const result = await fetchModels("http://host/v1", { fetchImpl: fetchImpl as never });
    expect(result.models).toEqual([]);
    expect(result.baseURL).toBe("http://host/v1");
  });
});