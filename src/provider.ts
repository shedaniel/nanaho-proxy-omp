import type { ProviderConfig, ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";
import { MODEL_KINDS } from "@oh-my-pi/pi-catalog/types";
import { z } from "zod";
import { metadataFromCatalog, ModelsDevCatalog } from "./pricing";

const ModelList = z.object({ data: z.array(z.object({
  id: z.string().min(1),
  display_name: z.string().optional(),
  owned_by: z.string().optional(),
  kind: z.enum(MODEL_KINDS).optional(),
  output: z.array(z.string()).optional(),
  output_modalities: z.array(z.string()).optional(),
  modalities: z.object({ output: z.array(z.string()).optional() }).optional(),
  architecture: z.object({ output_modalities: z.array(z.string()).optional() }).optional(),
})) });

// The gateway advertises these IDs but rejects them on /responses.
const UNSUPPORTED_RESPONSES_IDS: Record<string, true> = {
  "gpt-live": true,
  "gpt-live-1": true,
  "gpt-live-1-mini": true,
};

async function requestJson<T>(url: string, options: RequestInit, label: string, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error(`Nanaho Proxy ${label} request failed.`);
  }
  if (!response.ok) throw new Error(`Nanaho Proxy ${label} request failed (HTTP ${response.status}).`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Nanaho Proxy ${label} response is not valid JSON.`);
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new Error(`Nanaho Proxy ${label} response has invalid data.`);
  return parsed.data;
}

export function createModelDiscovery(baseUrl: string): NonNullable<ProviderConfig["fetchDynamicModels"]> {
  return async (apiKey) => {
    if (!apiKey) return [];
    const options = {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
      redirect: "error" as const,
    };
    const [list, catalog] = await Promise.all([
      requestJson(`${baseUrl}/models`, options, "model list", ModelList),
      // Never attach gateway credentials to a public pricing request.
      requestJson("https://models.dev/api.json", { signal: options.signal, redirect: "error" }, "models.dev catalog", ModelsDevCatalog),
    ]);
    try {
      // The registry accepts remoteCompaction on dynamic rows even though the
      // extension SDK's ProviderModelConfig does not expose it yet.
      const models: (ProviderModelConfig & { remoteCompaction?: { v2StreamingEnabled: true } })[] = [];
      for (const row of list.data) {
        if (Object.hasOwn(UNSUPPORTED_RESPONSES_IDS, row.id)) continue;
        const metadata = metadataFromCatalog(catalog, row.owned_by || undefined, row.id, {
          kind: row.kind,
          output: row.output?.length ? row.output
            : row.output_modalities?.length ? row.output_modalities
              : row.modalities?.output?.length ? row.modalities.output
                : row.architecture?.output_modalities,
        });
        if (!metadata.chat) continue;
        models.push({
          id: row.id,
          name: `${row.display_name ?? row.id}${!metadata.priced ? " (pricing unknown)" : metadata.referencePricing ? " (reference pricing)" : ""}`,
          api: "openai-responses",
          ...metadata.model,
          // Only this route/model has verified compaction_trigger support.
          // Omit enabled: true, which would also opt into the unsupported V1 route.
          ...(row.id === "gpt-6.2-sol" ? { remoteCompaction: { v2StreamingEnabled: true } } : {}),
          compat: {
            supportsReasoningEffort: true,
            supportsReasoningParams: true,
            thinkingFormat: "openai",
            streamIdleTimeoutMs: 3_000_000,
          },
        });
      }
      return models;
    } catch {
      throw new Error("Nanaho Proxy models.dev catalog contains invalid model metadata.");
    }
  };
}
