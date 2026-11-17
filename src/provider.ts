import type { ProviderConfig, ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod";
import { metadataFromCatalog, ModelsDevCatalog } from "./pricing";

const ModelList = z.object({ data: z.array(z.object({
  id: z.string().min(1),
  display_name: z.string().optional(),
  owned_by: z.string().optional(),
})) });

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
      return list.data.map((row): ProviderModelConfig => {
        const metadata = metadataFromCatalog(catalog, row.owned_by || undefined, row.id);
        return {
          id: row.id,
          name: `${row.display_name ?? row.id}${metadata.priced ? "" : " (pricing unknown)"}`,
          api: "openai-responses",
          ...metadata.model,
          compat: {
            supportsReasoningEffort: true,
            supportsReasoningParams: true,
            thinkingFormat: "openai",
            streamIdleTimeoutMs: 3_000_000,
          },
        };
      });
    } catch {
      throw new Error("Nanaho Proxy models.dev catalog contains invalid model metadata.");
    }
  };
}
