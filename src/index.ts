import { Plugin, Provider } from "@opencode/plugin";
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

export default Plugin.define({
  id: "ocp",
  async setup(ctx) {
    const logger: Logger = defaultLogger;

    let registry: Awaited<ReturnType<typeof readRegistry>>;
    try {
      registry = await readRegistry();
    } catch (err) {
      logger.error(`failed to read provider registry: ${err instanceof Error ? err.message : err}`);
      return;
    }

    const loaded = await loadAll(registry, logger);
    if (loaded.length === 0) {
      logger.info("no enabled providers configured; run `ocp-setup` to add one");
      return;
    }

    await ctx.provider.transform((editor) => {
      for (const provider of loaded) {
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
    });
  },
});
