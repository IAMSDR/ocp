import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  normalizeRegistry,
  readRegistry,
  removeProvider,
  upsertProvider,
} from "../dist/config/registry.js";
import { readApiKey, readAuthJson, removeApiKey, setApiKey } from "../dist/config/auth.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocp-test-"));
  process.env.OCP_CONFIG_DIR = path.join(tmpDir, "config");
  process.env.OCP_DATA_DIR = path.join(tmpDir, "data");
});

afterEach(async () => {
  delete process.env.OCP_CONFIG_DIR;
  delete process.env.OCP_DATA_DIR;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("registry", () => {
  it("normalizes malformed input to an empty registry", () => {
    expect(normalizeRegistry(null)).toEqual({ version: 1, providers: {} });
    expect(normalizeRegistry({ providers: { bad: { name: "no url" } } })).toEqual({
      version: 1,
      providers: {},
    });
  });

  it("returns an empty registry when no file exists", async () => {
    expect(await readRegistry()).toEqual({ version: 1, providers: {} });
  });

  it("round-trips a provider through disk", async () => {
    await upsertProvider({
      id: "local9",
      name: "Local 9Router",
      baseURL: "http://localhost:20127/v1",
      enabled: true,
    });
    const registry = await readRegistry();
    expect(registry.providers.local9).toMatchObject({
      id: "local9",
      name: "Local 9Router",
      baseURL: "http://localhost:20127/v1",
      enabled: true,
    });
  });

  it("persists filters and headers", async () => {
    await upsertProvider({
      id: "p",
      name: "P",
      baseURL: "http://x/v1",
      enabled: true,
      headers: { "X-Tenant": "acme" },
      models: { include: ["gpt-*"], exclude: ["gpt-3"] },
    });
    const entry = (await readRegistry()).providers.p;
    expect(entry.headers).toEqual({ "X-Tenant": "acme" });
    expect(entry.models).toEqual({ include: ["gpt-*"], exclude: ["gpt-3"] });
  });

  it("removes a provider", async () => {
    await upsertProvider({ id: "p", name: "P", baseURL: "http://x/v1", enabled: true });
    expect(await removeProvider("p")).toBe(true);
    expect(await removeProvider("p")).toBe(false);
    expect(Object.keys((await readRegistry()).providers)).toHaveLength(0);
  });
});

describe("auth", () => {
  it("writes a key and reads it back", async () => {
    await setApiKey("local9", "sk-secret", "http://localhost:20127/v1");
    const auth = await readAuthJson();
    expect(readApiKey(auth, "local9")).toBe("sk-secret");
    expect(auth.local9).toMatchObject({
      type: "api",
      key: "sk-secret",
      baseURL: "http://localhost:20127/v1",
    });
  });

  it("preserves other providers when merging", async () => {
    await setApiKey("a", "key-a");
    await setApiKey("b", "key-b");
    const auth = await readAuthJson();
    expect(readApiKey(auth, "a")).toBe("key-a");
    expect(readApiKey(auth, "b")).toBe("key-b");
  });

  it("preserves non-api entries it does not own", async () => {
    const file = path.join(process.env.OCP_DATA_DIR!, "auth.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ anthropic: { type: "oauth", refresh: "x" } }));
    await setApiKey("local9", "sk-secret");
    const auth = await readAuthJson();
    expect(auth.anthropic).toEqual({ type: "oauth", refresh: "x" });
    expect(readApiKey(auth, "local9")).toBe("sk-secret");
  });

  it("removes a key without touching others", async () => {
    await setApiKey("a", "key-a");
    await setApiKey("b", "key-b");
    expect(await removeApiKey("a")).toBe(true);
    const auth = await readAuthJson();
    expect(readApiKey(auth, "a")).toBeUndefined();
    expect(readApiKey(auth, "b")).toBe("key-b");
  });

  it("treats malformed auth.json as empty", async () => {
    const file = path.join(process.env.OCP_DATA_DIR!, "auth.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{ not json");
    expect(await readAuthJson()).toEqual({});
  });
});