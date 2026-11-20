import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";
import { MODEL_KINDS, type ModelCost, type ModelKind } from "@oh-my-pi/pi-catalog/types";
import { isLikelyAimlApiChatModelId } from "@oh-my-pi/pi-catalog/provider-models/openai-compat";
import { z } from "zod";

export const ModelsDevCatalog = z.record(z.string(), z.object({ models: z.record(z.string(), z.unknown()) }));
export type ModelsDevCatalog = z.infer<typeof ModelsDevCatalog>;

const TokenCost = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cache_read: z.number().nonnegative().optional(),
  cache_write: z.number().nonnegative().optional(),
});
const CatalogLimits = z.object({ context: z.number().nonnegative(), output: z.number().nonnegative() });
const ChatLimits = CatalogLimits.extend({ context: z.number().positive() });
const CatalogModel = z.object({
  cost: TokenCost.extend({
    tiers: z.array(TokenCost.extend({
      tier: z.object({ type: z.string(), size: z.number().positive() }),
    })).optional(),
  }).optional(),
  limit: CatalogLimits.optional(),
  kind: z.enum(MODEL_KINDS).optional(),
  modalities: z.object({ input: z.array(z.string()), output: z.array(z.string()).optional() }).optional(),
  reasoning: z.boolean().optional(),
});

function chatCapability(kind: ModelKind | undefined, output: readonly string[] | undefined): boolean | undefined {
  if (kind !== undefined) return kind === "chat";
  if (output?.length) return output.some(modality => modality.toLowerCase() === "text");
  return undefined;
}

export function metadataFromCatalog(
  catalog: ModelsDevCatalog,
  provider: string | undefined,
  id: string,
  capabilities: { kind?: ModelKind; output?: readonly string[] } = {},
): { priced: boolean } & (
  | { chat: false }
  | { chat: true; model: Pick<ProviderModelConfig, "contextWindow" | "maxTokens" | "input" | "reasoning"> & { cost: ModelCost } }
) {
  const raw = provider === undefined ? undefined : catalog[provider]?.models[id];
  const entry = raw === undefined ? undefined : CatalogModel.parse(raw);
  const rates = entry?.cost;
  // Classify separately from pricing: gateway facts win, while prices always
  // require the exact owner/id match above. ID heuristics never supply prices.
  const chat = chatCapability(capabilities.kind, capabilities.output)
    ?? chatCapability(entry?.kind, entry?.modalities?.output)
    ?? isLikelyAimlApiChatModelId(id);
  if (!chat) return { chat: false, priced: rates !== undefined };
  // Zero context is valid for image/runner metadata, not a chat token window.
  const limits = entry?.limit === undefined ? undefined : ChatLimits.parse(entry.limit);
  const cost: ModelCost = {
    input: rates?.input ?? 0,
    output: rates?.output ?? 0,
    cacheRead: rates?.cache_read ?? 0,
    cacheWrite: rates?.cache_write ?? 0,
  };
  for (const tier of rates?.tiers ?? []) {
    if (tier.tier.type !== "context" || (cost.longContext && tier.tier.size >= cost.longContext.inputThreshold)) continue;
    cost.longContext = {
      inputThreshold: tier.tier.size,
      input: tier.input,
      output: tier.output,
      cacheRead: tier.cache_read ?? cost.cacheRead,
      cacheWrite: tier.cache_write ?? cost.cacheWrite,
    };
  }
  return {
    chat: true,
    priced: rates !== undefined,
    model: {
      cost,
      contextWindow: limits?.context ?? 128_000,
      maxTokens: limits?.output || 16_384,
      input: entry?.modalities?.input.includes("image") ? ["text", "image"] : ["text"],
      reasoning: entry?.reasoning ?? true,
    },
  };
}
