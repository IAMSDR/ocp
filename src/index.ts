import { Model, Plugin, Provider } from "@opencode/plugin";
import { readAuthJson, readApiKey } from "./config/auth.js";
import { readRegistry, type ProviderEntry } from "./config/registry.js";
import { fetchModels, type RawModel } from "./fetch/models.js";
import { filterModels } from "./map/filters.js";
import { mapToModelInfo, OPENAI_COMPATIBLE_PACKAGE_V2 } from "./map/model.js";
import { defaultLogger, type Logger } from "./log.js";
import { dedupeModels } from "./catalog.js";

interface LoadedProvider {
  entry: ProviderEntry;
  apiKey?: string;
  baseURL: string;
  models: RawModel[];
}

async function loadProvider(
  entry: ProviderEntry,
  apiKey: string | undefined,
  logger: Logger,
): Promise<LoadedProvider | undefined> {
  try {
    const result = await fetchModels(entry.baseURL, {
      apiKey,
      headers: entry.headers,
    });
    const filtered = dedupeModels(filterModels(result.models, entry.models));
    logger.info(`loaded ${filtered.length} model(s) from "${entry.id}"`, {
      baseURL: result.baseURL,
    });
    return { entry, apiKey, baseURL: result.baseURL, models: filtered };
  } catch (err) {
    logger.warn(`skipping provider "${entry.id}": ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

async function loadAll(registry: Awaited<ReturnType<typeof readRegistry>>, logger: Logger) {
  const auth = await readAuthJson();
  const enabled = Object.values(registry.providers).filter((p) => p.enabled);
  const loaded = await Promise.all(
    enabled.map((entry) => {
      const ref = entry.apiKeyRef ?? entry.id;
      const apiKey = readApiKey(auth, ref);
      return loadProvider(entry, apiKey, logger);
    }),
  );
  return loaded.filter((p): p is LoadedProvider => p !== undefined);
}

export const OCP_RELOAD_COMMAND = "ocp-reload";

function applyLoadedProvider(
  editor: { add: (input: { info: Provider.Info; models: readonly Model.Info[] }) => void },
  provider: LoadedProvider,
) {
  const models = provider.models.map((raw) => mapToModelInfo(raw, { providerID: provider.entry.id }));
  const providerID = Provider.ID.make(provider.entry.id);
  const headers = provider.entry.headers;
  const info: Provider.Info = {
    ...Provider.Info.empty(providerID),
    name: provider.entry.name,
    activation: "enabled",
    package: OPENAI_COMPATIBLE_PACKAGE_V2,
    settings: {
      baseURL: provider.baseURL,
      apiKey: provider.apiKey || "not-needed",
    },
    ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
  };

  editor.add({ info, models });
}

export default Plugin.define({
  id: "ocp",
  async setup(ctx) {
    const logger: Logger = defaultLogger;
    const source = { loaded: [] as LoadedProvider[] };

    try {
      const registry = await readRegistry();
      source.loaded = await loadAll(registry, logger);
    } catch (err) {
      logger.error(`failed to read provider registry: ${err instanceof Error ? err.message : err}`);
    }

    if (source.loaded.length === 0) {
      logger.info("no enabled providers configured; run `ocp-setup` to add one");
    }

    // Always registered (even when empty) so a later reload can add providers
    // without an OpenCode restart. The callback reads `source.loaded` on every
    // replay instead of closing over a one-time snapshot.
    await ctx.provider.transform((editor) => {
      for (const provider of source.loaded) {
        applyLoadedProvider(editor, provider);
      }
    });

    await ctx.command.transform((editor) => {
      editor.add({
        name: OCP_RELOAD_COMMAND,
        description: "Re-fetch /v1/models and reload ocp providers without restarting OpenCode",
        execute: async ({ sessionID }) => {
          try {
            const registry = await readRegistry();
            const fresh = await loadAll(registry, logger);
            source.loaded = fresh;
            await ctx.provider.reload();
            try {
              await ctx.model.reload();
            } catch {
              // Provider changes already invalidate the model result; ignore.
            }
            const total = fresh.reduce((n, p) => n + p.models.length, 0);
            const summary =
              fresh.length === 0
                ? "ocp: reload finished — no enabled providers (run `ocp-setup` to add one)"
                : `ocp: reloaded ${total} model(s) from ${fresh.length} provider(s): ${fresh
                    .map((p) => `"${p.entry.id}" (${p.models.length})`)
                    .join(", ")}`;
            logger.info(summary);
            try {
              await ctx.session.synthetic({ sessionID, text: summary });
            } catch {
              // Session feedback is best-effort; reload already succeeded.
            }
          } catch (err) {
            const message = `ocp: reload failed: ${err instanceof Error ? err.message : String(err)}`;
            logger.error(message);
            try {
              await ctx.session.synthetic({ sessionID, text: message });
            } catch {
              // Ignore feedback errors.
            }
          }
        },
      });
    });
  },
});
