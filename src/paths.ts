import os from "node:os";
import path from "node:path";

export function opencodeConfigDir(): string {
  return process.env.OCP_CONFIG_DIR ?? path.join(os.homedir(), ".config", "opencode");
}

export function opencodeDataDir(): string {
  return (
    process.env.OPENCODE_DATA_DIR ??
    process.env.OCP_DATA_DIR ??
    path.join(os.homedir(), ".local", "share", "opencode")
  );
}

export function registryPath(): string {
  return path.join(opencodeConfigDir(), "ocp-providers.json");
}

export function authJsonPath(): string {
  return path.join(opencodeDataDir(), "auth.json");
}