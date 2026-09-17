import type { Config, Hooks, Plugin, PluginInput, PluginOptions } from "@opencode-ai/plugin";
import type { Provider as ProviderV2, Model as ModelV2 } from "@opencode-ai/sdk/v2";

import { readAuthJson, readApiKey } from "./config/auth.js";
import { readRegistry, type ProviderEntry } from "./config/registry.js";
import { fetchModels, type RawModel } from "./fetch/models.js";
import { filterModels } from "./map/filters.js";
import {
  mapToModelV2,
  mapToStaticEntry,
  OPENAI_COMPATIBLE_NPM,
  type StaticModelEntry,
} from "./map/model.js";
import { createLogger, type Logger } from "./log.js";
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
    logger.warn(
      `skipping provider "${entry.id}": ${err instanceof Error ? err.message : String(err)}`,
    );
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

async function resolveSingleEnabledProviderId(logger: Logger): Promise<string | undefined> {
  try {
    const registry = await readRegistry();
    const enabled = Object.values(registry.providers).filter((p) => p.enabled);
    if (enabled.length === 1) return enabled[0]!.id;
  } catch (err) {
    logger.debug(
      `could not resolve dynamic provider id: ${err instanceof Error ? err.message : err}`,
    );
  }
  return undefined;
}

const OcpPlugin: Plugin = async (input: PluginInput, options?: PluginOptions) => {
  const logger = createLogger(input.client);
  const optProviderId =
    options && typeof options.providerId === "string" ? options.providerId : undefined;

  const cache = new Map<string, LoadedProvider>();

  const hooks: Hooks = {
    config: async (config: Config) => {
      let registry: Awaited<ReturnType<typeof readRegistry>>;
      try {
        registry = await readRegistry();
      } catch (err) {
        logger.error(
          `failed to read provider registry: ${err instanceof Error ? err.message : err}`,
        );
        return;
      }

      const loaded = await loadAll(registry, logger);
      if (loaded.length === 0) {
        logger.info("no enabled providers configured; run `ocp-setup` to add one");
        return;
      }

      config.provider = config.provider ?? {};
      for (const provider of loaded) {
        cache.set(provider.entry.id, provider);
        const models: Record<string, StaticModelEntry> = {};
        for (const raw of provider.models) {
          models[raw.id] = mapToStaticEntry(raw);
        }
        config.provider[provider.entry.id] = {
          npm: OPENAI_COMPATIBLE_NPM,
          name: provider.entry.name,
          options: {
            baseURL: provider.baseURL,
            apiKey: provider.apiKey || "not-needed",
            ...(provider.entry.headers ? { headers: provider.entry.headers } : {}),
          },
          models,
        } as (typeof config.provider)[string];
      }
    },
  };

  const dynamicProviderId = optProviderId ?? (await resolveSingleEnabledProviderId(logger));

  if (dynamicProviderId) {
    hooks.provider = {
      id: dynamicProviderId,
      models: async (_provider: ProviderV2): Promise<Record<string, ModelV2>> => {
        let loaded = cache.get(dynamicProviderId);
        if (!loaded) {
          const registry = await readRegistry();
          const entry = registry.providers[dynamicProviderId];
          if (!entry) return {};
          const auth = await readAuthJson();
          const ref = entry.apiKeyRef ?? entry.id;
          loaded = await loadProvider(entry, readApiKey(auth, ref), logger);
          if (!loaded) return {};
          cache.set(dynamicProviderId, loaded);
        }
        const out: Record<string, ModelV2> = {};
        for (const raw of loaded.models) {
          out[raw.id] = mapToModelV2(raw, {
            providerID: dynamicProviderId,
            baseURL: loaded.baseURL,
          }) as unknown as ModelV2;
        }
        return out;
      },
    };
  }

  return hooks;
};

export default OcpPlugin;