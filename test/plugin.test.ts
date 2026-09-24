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
  await fs.writeFile(path.join(dir, "ocp-providers.json"), JSON.stringify({ version: 1, providers }));
}

function fakeCtx() {
  const added: Array<{ info: { id: string; name: string; package: string; settings: Record<string, unknown>; headers?: Record<string, string> }; models: Array<{ id: string; modelID: string; providerID: string }> }> = [];
  const editor = {
    list: () => added,
    get: (id: string) => added.find((r) => r.info.id === id),
    add: (input: { info: { id: string } & Record<string, unknown>; models: readonly unknown[] }) => {
      added.push(input as never);
    },
    update: () => {},
    remove: () => {},
    models: { set: () => {}, update: () => {}, remove: () => {} },
  };
  const provider = {
    transform: vi.fn(async (cb: (e: typeof editor) => void) => {
      cb(editor);
      return { dispose: async () => {} };
    }),
    reload: vi.fn(async () => {}),
    list: vi.fn(async () => added),
    get: vi.fn(async () => undefined),
  };
  return { ctx: { provider, options: {} } as never, added, provider };
}

function stubFetch(payload: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
}

describe("OcpPlugin V2", () => {
  it("has correct id and setup", async () => {
    const { default: plugin } = await loadPlugin();
    expect(plugin.id).toBe("ocp");
    expect(typeof plugin.setup).toBe("function");
  });

  it("adds a provider record for each enabled provider via ctx.provider.transform", async () => {
    await seed({
      local9: { id: "local9", name: "Local 9Router", baseURL: "http://localhost:20127/v1", enabled: true },
      disabled: { id: "disabled", name: "Disabled", baseURL: "http://localhost:9999/v1", enabled: false },
    });
    const fetchImpl = stubFetch({ data: [{ id: "m1" }, { id: "m2" }] });
    vi.stubGlobal("fetch", fetchImpl);

    const { default: plugin } = await loadPlugin();
    const { ctx, added, provider } = fakeCtx();
    await plugin.setup(ctx);

    expect(provider.transform).toHaveBeenCalledTimes(1);
    expect(added.length).toBe(1);
    expect(added[0]!.info.id).toBe("local9");
    expect(added[0]!.info.package).toBe("@opencode/ai/providers/openai-compatible");
    expect((added[0]!.info.settings as { baseURL: string }).baseURL).toBe("http://localhost:20127/v1");
    expect(added[0]!.models.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("applies per-provider model filters", async () => {
    await seed({
      p: { id: "p", name: "P", baseURL: "http://x/v1", enabled: true, models: { exclude: ["drop"] } },
    });
    vi.stubGlobal("fetch", stubFetch({ data: [{ id: "keep" }, { id: "drop" }] }));
    const { default: plugin } = await loadPlugin();
    const { ctx, added } = fakeCtx();
    await plugin.setup(ctx);
    expect(added[0]!.models.map((m) => m.id)).toEqual(["keep"]);
  });

  it("soft-fails and skips a provider whose endpoint is unreachable", async () => {
    await seed({
      good: { id: "good", name: "Good", baseURL: "http://good/v1", enabled: true },
      bad: { id: "bad", name: "Bad", baseURL: "http://bad/v1", enabled: true },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("//good/")) return new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 });
        throw new Error("ECONNREFUSED");
      }),
    );
    const { default: plugin } = await loadPlugin();
    const { ctx, added } = fakeCtx();
    await plugin.setup(ctx);
    expect(added.map((r) => r.info.id)).toEqual(["good"]);
  });

  it("supports multiple enabled providers (V2 adds all)", async () => {
    await seed({
      a: { id: "a", name: "A", baseURL: "http://a/v1", enabled: true },
      b: { id: "b", name: "B", baseURL: "http://b/v1", enabled: true },
    });
    vi.stubGlobal("fetch", stubFetch({ data: [{ id: "m1" }] }));
    const { default: plugin } = await loadPlugin();
    const { ctx, added } = fakeCtx();
    await plugin.setup(ctx);
    expect(added.map((r) => r.info.id).sort()).toEqual(["a", "b"]);
  });

  it("no-ops when the registry is empty", async () => {
    vi.stubGlobal("fetch", stubFetch({ data: [] }));
    const { default: plugin } = await loadPlugin();
    const { ctx, provider } = fakeCtx();
    await plugin.setup(ctx);
    // transform not called when no providers
    expect(provider.transform).not.toHaveBeenCalled();
  });

  it("propagates headers and apiKey into provider settings", async () => {
    await seed({
      h: { id: "h", name: "H", baseURL: "http://h/v1", enabled: true, headers: { "X-Tenant": "acme" } },
    });
    // also set auth key
    const dir = path.join(process.env.OCP_DATA_DIR!, "");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "auth.json"), JSON.stringify({ h: { type: "api", key: "sk-123" } }));
    vi.stubGlobal("fetch", stubFetch({ data: [{ id: "m1" }] }));
    const { default: plugin } = await loadPlugin();
    const { ctx, added } = fakeCtx();
    await plugin.setup(ctx);
    expect(added[0]!.info.headers).toEqual({ "X-Tenant": "acme" });
    expect((added[0]!.info.settings as { apiKey: string }).apiKey).toBe("sk-123");
  });
});
