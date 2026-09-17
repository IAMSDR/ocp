import fs from "node:fs/promises";
import path from "node:path";
import { authJsonPath } from "../paths.js";

export interface AuthApiEntry {
  type: "api";
  key: string;
  baseURL?: string;
  [k: string]: unknown;
}

export type AuthJson = Record<string, Record<string, unknown>>;

export async function readAuthJson(): Promise<AuthJson> {
  let body: string;
  try {
    body = await fs.readFile(authJsonPath(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as AuthJson;
    }
    return {};
  } catch {
    return {};
  }
}

export function readApiKey(auth: AuthJson, ref: string): string | undefined {
  const entry = auth[ref];
  if (entry && entry.type === "api" && typeof entry.key === "string" && entry.key.length > 0) {
    return entry.key;
  }
  return undefined;
}

export function readApiBaseURL(auth: AuthJson, ref: string): string | undefined {
  const entry = auth[ref];
  if (entry && typeof entry.baseURL === "string" && entry.baseURL.length > 0) {
    return entry.baseURL;
  }
  return undefined;
}

export async function setApiKey(
  providerId: string,
  key: string,
  baseURL?: string,
): Promise<void> {
  const auth = await readAuthJson();
  const entry: AuthApiEntry = { type: "api", key };
  if (baseURL) entry.baseURL = baseURL;
  auth[providerId] = entry;
  await writeAuthJson(auth);
}

export async function removeApiKey(providerId: string): Promise<boolean> {
  const auth = await readAuthJson();
  if (!(providerId in auth)) return false;
  delete auth[providerId];
  await writeAuthJson(auth);
  return true;
}

async function writeAuthJson(auth: AuthJson): Promise<void> {
  const file = authJsonPath();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify(auth, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
}