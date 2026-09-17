import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;

async function loadPlugin() {
  vi.resetModules();
  return await import("../dist/index.js");
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocp-plugin-"));
  process.env.OCP_CONFIG_DIR = path.join(tmpDir, "config");
  process.env.OCP_DATA_DIR = path.join(tmpDir, "data");
});

afterEach(async () => {
  delete process.env.OCP_CONFIG_DIR;
  delete process.env.OCP_DATA_DIR;
  vi.unstubAllGlobals();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function seed(providers: Record<string, unknown>) {
  const dir = path.join(process.env.OCP_CONFIG_DIR!, "");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "ocp-providers.json"),
    JSON.stringify({ version: 1, providers }),
  );
}

function fakeContext() {
  return {
    client: {},
    project: {},
    directory: "/tmp",
    worktree: "/tmp",
    serverUrl: new URL("http://localhost"),
    $: {},
  } as never;
}

function stubFetch(payload: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
}

describe("OcpPlugin", () => {
  it("writes a provider block for each enabled provider", async () => {
    await seed({
      local9: {
        id: "local9",
        name: "Local 9Router",
        baseURL: "http://localhost:20127/v1",
        enabled: true,
      },
      disabled: {
        id: "disabled",
        name: "Disabled",
        baseURL: "http://localhost:9999/v1",
        enabled: false,
      },
    });
    const fetchImpl = stubFetch({ data: [{ id: "m1" }, { id: "m2" }] });
    vi.stubGlobal("fetch", fetchImpl);

    const { default: plugin } = await loadPlugin();
    const hooks = await plugin(fakeContext());
    const config: { provider?: Record<string, unknown> } = {};
    await hooks.config!(config as never);

    const providers = config.provider as Record<
      string,
      { npm: string; options: { baseURL: string; apiKey: string }; models: Record<string, unknown> }
    >;
    expect(Object.keys(providers)).toEqual(["local9"]);
    expect(providers.local9.npm).toBe("@ai-sdk/openai-compatible");
    expect(providers.local9.options.baseURL).toBe("http://localhost:20127/v1");
    expect(Object.keys(providers.local9.models)).toEqual(["m1", "m2"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("applies per-provider model filters", async () => {
    await seed({
      p: {
        id: "p",
        name: "P",
        baseURL: "http://x/v1",
        enabled: true,
        models: { exclude: ["drop"] },
      },
    });
    vi.stubGlobal(
      "fetch",
      stubFetch({ data: [{ id: "keep" }, { id: "drop" }] }),
    );
    const { default: plugin } = await loadPlugin();
    const hooks = await plugin(fakeContext());
    const config: { provider?: Record<string, { models: Record<string, unknown> }> } = {};
    await hooks.config!(config as never);
    expect(Object.keys(config.provider!.p.models)).toEqual(["keep"]);
  });

  it("soft-fails and skips a provider whose endpoint is unreachable", async () => {
    await seed({
      good: { id: "good", name: "Good", baseURL: "http://good/v1", enabled: true },
      bad: { id: "bad", name: "Bad", baseURL: "http://bad/v1", enabled: true },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("//good/")) {
          return new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 });
        }
        throw new Error("ECONNREFUSED");
      }),
    );
    const { default: plugin } = await loadPlugin();
    const hooks = await plugin(fakeContext());
    const config: { provider?: Record<string, unknown> } = {};
    await hooks.config!(config as never);
    expect(Object.keys(config.provider!)).toEqual(["good"]);
  });

  it("binds the dynamic provider hook when exactly one provider is enabled", async () => {
    await seed({
      solo: { id: "solo", name: "Solo", baseURL: "http://solo/v1", enabled: true },
    });
    vi.stubGlobal("fetch", stubFetch({ data: [{ id: "m1" }] }));
    const { default: plugin } = await loadPlugin();
    const hooks = await plugin(fakeContext());
    expect(hooks.provider?.id).toBe("solo");
    const models = await hooks.provider!.models!({} as never, {});
    expect(Object.keys(models)).toEqual(["m1"]);
    expect(models.m1.providerID).toBe("solo");
  });

  it("does not bind a dynamic provider hook when multiple providers are enabled", async () => {
    await seed({
      a: { id: "a", name: "A", baseURL: "http://a/v1", enabled: true },
      b: { id: "b", name: "B", baseURL: "http://b/v1", enabled: true },
    });
    vi.stubGlobal("fetch", stubFetch({ data: [{ id: "m1" }] }));
    const { default: plugin } = await loadPlugin();
    const hooks = await plugin(fakeContext());
    expect(hooks.provider).toBeUndefined();
  });

  it("no-ops when the registry is empty", async () => {
    vi.stubGlobal("fetch", stubFetch({ data: [] }));
    const { default: plugin } = await loadPlugin();
    const hooks = await plugin(fakeContext());
    const config: { provider?: Record<string, unknown> } = {};
    await hooks.config!(config as never);
    expect(config.provider).toBeUndefined();
  });
});