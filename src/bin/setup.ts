#!/usr/bin/env node
import prompts from "prompts";
import {
  readRegistry,
  upsertProvider,
  removeProvider,
  type ProviderEntry,
} from "../config/registry.js";
import { readAuthJson, readApiKey, removeApiKey, setApiKey } from "../config/auth.js";
import { fetchModels } from "../fetch/models.js";
import { stripTrailingSlashes } from "../fetch/models.js";

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

const ID_RE = /^[a-z0-9][a-z0-9-_]*$/;

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeBaseURL(input: string): string {
  let value = input.trim();
  if (value.length === 0) return value;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  return stripTrailingSlashes(value);
}

interface HealthResult {
  ok: boolean;
  modelCount?: number;
  baseURL?: string;
  error?: string;
}

export async function healthCheck(baseURL: string, apiKey?: string): Promise<HealthResult> {
  try {
    const result = await fetchModels(baseURL, { apiKey, timeoutMs: 10_000 });
    return { ok: true, modelCount: result.models.length, baseURL: result.baseURL };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function padEndVisible(s: string, width: number): string {
  const visible = stripAnsi(s).length;
  return s + " ".repeat(Math.max(0, width - visible));
}

function maskKey(key: string | undefined): string {
  if (!key) return c.yellow("(no key)");
  if (key.length <= 8) return c.green("••••");
  return c.green(`${key.slice(0, 4)}…${key.slice(-4)}`);
}

async function listProviders(): Promise<void> {
  const registry = await readRegistry();
  const auth = await readAuthJson();
  const entries = Object.values(registry.providers).sort((a, b) => a.id.localeCompare(b.id));
  if (entries.length === 0) {
    console.log(c.dim("\nNo providers configured yet. Choose 'Add provider' to create one.\n"));
    return;
  }
  console.log("");
  const idWidth = Math.max(2, ...entries.map((e) => e.id.length));
  const nameWidth = Math.max(4, ...entries.map((e) => e.name.length));
  console.log(
    c.bold(
      `  ${"ID".padEnd(idWidth)}  ${"NAME".padEnd(nameWidth)}  ${"STATE".padEnd(8)}  ${"KEY".padEnd(12)}  BASE URL`,
    ),
  );
  for (const entry of entries) {
    const ref = entry.apiKeyRef ?? entry.id;
    const state = entry.enabled ? c.green("enabled ") : c.dim("disabled");
    console.log(
      `  ${entry.id.padEnd(idWidth)}  ${entry.name.padEnd(nameWidth)}  ${state}  ${padEndVisible(maskKey(
        readApiKey(auth, ref),
      ), 12)}  ${c.dim(entry.baseURL)}`,
    );
  }
  console.log("");
}

async function promptId(
  message: string,
  registry: Awaited<ReturnType<typeof readRegistry>>,
  current?: string,
): Promise<string | undefined> {
  const { value } = await prompts({
    type: "text",
    name: "value",
    message,
    initial: current,
    validate: (input: string) => {
      const id = input.trim();
      if (id.length === 0) return "ID is required";
      if (!ID_RE.test(id)) return "Use lowercase letters, numbers, '-' and '_' only";
      if (id !== current && registry.providers[id]) return `Provider "${id}" already exists`;
      return true;
    },
  });
  return value ? String(value).trim() : undefined;
}

async function addProvider(): Promise<void> {
  const registry = await readRegistry();

  const { name } = await prompts({
    type: "text",
    name: "name",
    message: "Display name",
    validate: (v: string) => (v.trim().length > 0 ? true : "Name is required"),
  });
  if (!name) return;

  const suggested = slugify(String(name));
  const id = await promptId("Provider ID (used in OpenCode as <id>/<model>)", registry, suggested);
  if (!id) return;

  const { rawURL } = await prompts({
    type: "text",
    name: "rawURL",
    message: "Base URL (e.g. https://api.example.com/v1)",
    validate: (v: string) => (v.trim().length > 0 ? true : "Base URL is required"),
  });
  if (!rawURL) return;
  const baseURL = normalizeBaseURL(String(rawURL));

  const { key } = await prompts({
    type: "password",
    name: "key",
    message: "API key (leave empty if not required)",
  });
  const apiKey = key ? String(key) : undefined;

  const { doCheck } = await prompts({
    type: "toggle",
    name: "doCheck",
    message: "Run a connectivity check now?",
    initial: true,
    active: "yes",
    inactive: "no",
  });

  let resolvedBaseURL = baseURL;
  if (doCheck) {
    console.log(c.dim(`\n  Checking ${baseURL} …`));
    const result = await healthCheck(baseURL, apiKey);
    if (result.ok) {
      console.log(c.green(`  OK — ${result.modelCount} model(s) found.`) + c.dim(`  (${result.baseURL})`));
      resolvedBaseURL = result.baseURL ?? baseURL;
    } else {
      console.log(c.red(`  FAILED — ${result.error}`));
      const { proceed } = await prompts({
        type: "confirm",
        name: "proceed",
        message: "Save anyway?",
        initial: false,
      });
      if (!proceed) return;
    }
  }

  const entry: ProviderEntry = {
    id,
    name: String(name).trim(),
    baseURL: resolvedBaseURL,
    enabled: true,
  };
  await upsertProvider(entry);
  if (apiKey) await setApiKey(id, apiKey, resolvedBaseURL);
  console.log(c.green(`\n  Saved provider "${id}". Restart OpenCode to load its models.\n`));
}

async function editProvider(id: string): Promise<void> {
  const registry = await readRegistry();
  const existing = registry.providers[id];
  if (!existing) return;

  const { name } = await prompts({
    type: "text",
    name: "name",
    message: "Display name",
    initial: existing.name,
  });
  if (name === undefined) return;

  const { rawURL } = await prompts({
    type: "text",
    name: "rawURL",
    message: "Base URL",
    initial: existing.baseURL,
  });
  if (rawURL === undefined) return;

  const { newKey } = await prompts({
    type: "password",
    name: "newKey",
    message: "New API key (leave empty to keep current)",
  });

  const baseURL = normalizeBaseURL(String(rawURL));
  await upsertProvider({ ...existing, name: String(name).trim() || existing.name, baseURL });
  if (newKey) await setApiKey(id, String(newKey), baseURL);
  console.log(c.green(`\n  Updated provider "${id}".\n`));
}

async function toggleProvider(id: string): Promise<void> {
  const registry = await readRegistry();
  const existing = registry.providers[id];
  if (!existing) return;
  await upsertProvider({ ...existing, enabled: !existing.enabled });
  console.log(
    c.green(`\n  Provider "${id}" is now ${existing.enabled ? "disabled" : "enabled"}.\n`),
  );
}

async function deleteProvider(id: string): Promise<void> {
  const { confirm } = await prompts({
    type: "confirm",
    name: "confirm",
    message: `Delete provider "${id}" and its stored API key?`,
    initial: false,
  });
  if (!confirm) return;
  await removeProvider(id);
  await removeApiKey(id);
  console.log(c.green(`\n  Deleted provider "${id}".\n`));
}

async function testProvider(id: string): Promise<void> {
  const registry = await readRegistry();
  const entry = registry.providers[id];
  if (!entry) return;
  const auth = await readAuthJson();
  const apiKey = readApiKey(auth, entry.apiKeyRef ?? entry.id);
  console.log(c.dim(`\n  Checking ${entry.baseURL} …`));
  const result = await healthCheck(entry.baseURL, apiKey);
  if (result.ok) {
    console.log(c.green(`  OK — ${result.modelCount} model(s) found.`) + c.dim(`  (${result.baseURL})`));
  } else {
    console.log(c.red(`  FAILED — ${result.error}`));
  }
  console.log("");
}

async function editFilters(id: string): Promise<void> {
  const registry = await readRegistry();
  const entry = registry.providers[id];
  if (!entry) return;
  const parse = (v: string) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const { include } = await prompts({
    type: "text",
    name: "include",
    message: "Include models (comma-separated, supports *, empty = all)",
    initial: (entry.models?.include ?? []).join(", "),
  });
  if (include === undefined) return;
  const { exclude } = await prompts({
    type: "text",
    name: "exclude",
    message: "Exclude models (comma-separated, supports *)",
    initial: (entry.models?.exclude ?? []).join(", "),
  });
  if (exclude === undefined) return;

  const includeList = parse(String(include));
  const excludeList = parse(String(exclude));
  await upsertProvider({
    ...entry,
    models: {
      ...(includeList.length ? { include: includeList } : {}),
      ...(excludeList.length ? { exclude: excludeList } : {}),
    },
  });
  console.log(c.green(`\n  Updated filters for "${id}".\n`));
}

async function pickProvider(message: string): Promise<string | undefined> {
  const registry = await readRegistry();
  const entries = Object.values(registry.providers);
  if (entries.length === 0) {
    console.log(c.yellow("\n  No providers configured yet.\n"));
    return undefined;
  }
  const { id } = await prompts({
    type: "select",
    name: "id",
    message,
    choices: entries.map((entry) => ({
      title: `${entry.name} ${c.dim(`(${entry.id})`)}${entry.enabled ? "" : c.dim(" [disabled]")}`,
      value: entry.id,
    })),
  });
  return id ? String(id) : undefined;
}

async function mainMenu(): Promise<boolean> {
  const { action } = await prompts({
    type: "select",
    name: "action",
    message: "ocp — OpenAI-compatible provider manager",
    choices: [
      { title: "List providers", value: "list" },
      { title: "Add provider", value: "add" },
      { title: "Edit provider", value: "edit" },
      { title: "Enable / disable provider", value: "toggle" },
      { title: "Test connection", value: "test" },
      { title: "Edit model filters", value: "filters" },
      { title: "Remove provider", value: "remove" },
      { title: c.dim("Exit"), value: "exit" },
    ],
  });
  if (!action || action === "exit") return false;
  await runAction(String(action));
  return true;
}

async function runAction(action: string): Promise<void> {
  switch (action) {
    case "list":
      return listProviders();
    case "add":
      return addProvider();
    case "edit":
      return withProvider("Select a provider to edit", editProvider);
    case "toggle":
      return withProvider("Select a provider to toggle", toggleProvider);
    case "test":
      return withProvider("Select a provider to test", testProvider);
    case "filters":
      return withProvider("Select a provider to filter", editFilters);
    case "remove":
      return withProvider("Select a provider to remove", deleteProvider);
    default:
      return;
  }
}

async function withProvider(
  message: string,
  action: (id: string) => Promise<void>,
): Promise<void> {
  const id = await pickProvider(message);
  if (id) await action(id);
}

export async function run(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error(
      "ocp-setup requires an interactive terminal. Run it directly in a shell (not piped).",
    );
    process.exitCode = 1;
    return;
  }

  const once = process.argv.includes("--once") || process.argv.includes("-1");
  try {
    let keepGoing = true;
    while (keepGoing) {
      keepGoing = await mainMenu();
      if (once) break;
    }
  } catch (err) {
    if (err instanceof Error && /cancel/i.test(err.message)) {
      // prompts throws on Ctrl-C; exit quietly.
      return;
    }
    throw err;
  }
}

if (isMainModule()) {
  void run();
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const url = new URL(`file://${entry.replace(/\\/g, "/")}`);
    return import.meta.url === url.href;
  } catch {
    return false;
  }
}