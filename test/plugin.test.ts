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
  let providerCallback: ((e: typeof editor) => void) | undefined;
  const provider = {
    transform: vi.fn(async (cb: (e: typeof editor) => void) => {
      providerCallback = cb;
      cb(editor);
      return { dispose: async () => {} };
    }),
    reload: vi.fn(async () => {}),
    list: vi.fn(async () => added),
    get: vi.fn(async () => undefined),
  };
  const commands: Array<{ name: string; description?: string; execute: (input: never) => Promise<void> }> = [];
  const command = {
    transform: vi.fn(async (cb: (e: { add: (d: never) => void }) => void) => {
      cb({ add: (d: never) => commands.push(d as never) });
      return { dispose: async () => {} };
    }),
    reload: vi.fn(async () => {}),
    list: vi.fn(async () => commands),
  };
  const model = {
    reload: vi.fn(async () => {}),
    list: vi.fn(async () => []),
  };
  const session = {
    synthetic: vi.fn(async () => ({})),
    prompt: vi.fn(async () => ({})),
  };
  const replayProviders = () => {
    added.length = 0;
    providerCallback?.(editor);
  };
  return { ctx: { provider, command, model, session, options: {} } as never, added, provider, commands, command, model, session, replayProviders };
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

  it("registers providers and the ocp-reload command even when the registry is empty", async () => {
    vi.stubGlobal("fetch", stubFetch({ data: [] }));
    const { default: plugin } = await loadPlugin();
    const { ctx, provider, added, commands, command } = fakeCtx();
    await plugin.setup(ctx);
    // Provider transform is always registered so a later /ocp-reload can add
    // providers without a restart; it just adds nothing while empty.
    expect(provider.transform).toHaveBeenCalledTimes(1);
    expect(added.length).toBe(0);
    expect(command.transform).toHaveBeenCalledTimes(1);
    expect(commands.map((c) => c.name)).toContain("ocp-reload");
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

  it("registers an ocp-reload slash command", async () => {
    await seed({
      p: { id: "p", name: "P", baseURL: "http://x/v1", enabled: true },
    });
    vi.stubGlobal("fetch", stubFetch({ data: [{ id: "m1" }] }));
    const { default: plugin } = await loadPlugin();
    const { ctx, commands, command } = fakeCtx();
    await plugin.setup(ctx);
    expect(command.transform).toHaveBeenCalledTimes(1);
    expect(commands.map((c) => c.name)).toContain("ocp-reload");
  });

  it("reloads models without restart when /ocp-reload runs", async () => {
    await seed({
      p: { id: "p", name: "P", baseURL: "http://x/v1", enabled: true },
    });
    let payload: unknown = { data: [{ id: "m1" }] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
    );
    const { default: plugin } = await loadPlugin();
    const { ctx, added, commands, provider, model, session, replayProviders } = fakeCtx();
    await plugin.setup(ctx);
    expect(added[0]!.models.map((m) => m.id)).toEqual(["m1"]);

    // Upstream gains a model while OpenCode is still running.
    payload = { data: [{ id: "m1" }, { id: "m2" }] };
    const reload = commands.find((c) => c.name === "ocp-reload")!;
    expect(reload).toBeDefined();
    await reload.execute({ sessionID: "ses_test", prompt: { text: "" }, delivery: "steer" } as never);

    expect(provider.reload).toHaveBeenCalledTimes(1);
    expect(model.reload).toHaveBeenCalledTimes(1);
    expect(session.synthetic).toHaveBeenCalledTimes(1);
    expect(String((session.synthetic.mock.calls[0]![0] as { text: string }).text)).toContain("2 model(s)");

    // Simulate OpenCode replaying provider transforms after reload().
    replayProviders();
    expect(added[0]!.models.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
  });

  it("picks up a newly added provider from the registry on reload", async () => {
    await seed({
      a: { id: "a", name: "A", baseURL: "http://a/v1", enabled: true },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const id = String(url).includes("//b/") ? "mb" : "ma";
        return new Response(JSON.stringify({ data: [{ id }] }), { status: 200 });
      }),
    );
    const { default: plugin } = await loadPlugin();
    const { ctx, added, commands, provider, replayProviders } = fakeCtx();
    await plugin.setup(ctx);
    expect(added.map((r) => r.info.id)).toEqual(["a"]);

    // User runs ocp-setup (or edits ocp-providers.json) while OpenCode runs.
    await seed({
      a: { id: "a", name: "A", baseURL: "http://a/v1", enabled: true },
      b: { id: "b", name: "B", baseURL: "http://b/v1", enabled: true },
    });
    const reload = commands.find((c) => c.name === "ocp-reload")!;
    await reload.execute({ sessionID: "ses_test", prompt: { text: "" }, delivery: "steer" } as never);

    expect(provider.reload).toHaveBeenCalledTimes(1);
    replayProviders();
    expect(added.map((r) => r.info.id).sort()).toEqual(["a", "b"]);
  });
});
