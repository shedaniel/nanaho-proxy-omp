import { expect, test } from "bun:test";
import { metadataFromCatalog, ModelsDevCatalog } from "./pricing";

const catalog = ModelsDevCatalog.parse({
  openai: { models: {
    "example-model": {
      cost: {
        input: 3, output: 9, cache_read: 0.25, cache_write: 4,
        tiers: [{ input: 6, output: 13.5, tier: { type: "context", size: 250_000 } }],
      },
      limit: { context: 1_000_000, output: 64_000 },
      modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      reasoning: true,
    },
    "free-model": { cost: { input: 0, output: 0 } },
    "bad-price": { cost: { input: -1, output: 2 } },
    "gpt-image-2": {
      cost: { input: 8, output: 30, cache_read: 2 },
      limit: { context: 0, output: 0 },
      modalities: { input: ["text", "image"], output: ["image"] },
    },
    "opaque-renderer": { kind: "image", limit: { context: 0, output: 0 } },
    "opaque-raster": {
      cost: { input: 2, output: 4 }, limit: { context: 0, output: 0 },
      modalities: { input: ["text"], output: ["image"] },
    },
    "bad-chat-context": {
      cost: { input: 1, output: 2 }, limit: { context: 0, output: 16_384 },
      modalities: { input: ["text"], output: ["text"] },
    },
    "bad-image-price": { kind: "image", cost: { input: -1, output: 2 }, limit: { context: 0, output: 0 } },
  } },
  other: { models: { "example-model": { cost: { input: 99, output: 99 } } } },
});

test("preserves per-million units, cache rates, and context-tier prices without mixing providers", () => {
  const result = metadataFromCatalog(catalog, "openai", "example-model");
  if (!result.chat) throw new Error("Expected chat metadata");
  expect(result.model.cost).toEqual({
    input: 3, output: 9, cacheRead: 0.25, cacheWrite: 4,
    longContext: { inputThreshold: 250_000, input: 6, output: 13.5, cacheRead: 0.25, cacheWrite: 4 },
  });
  expect(result.model.contextWindow).toBe(1_000_000);
  expect(result.model.maxTokens).toBe(64_000);
  expect(result.model.input).toEqual(["text", "image"]);
});

test("opaque aliases and unknown owners do not borrow another model's price", () => {
  expect(metadataFromCatalog(catalog, "openai", "example-model-latest").priced).toBe(false);
  expect(metadataFromCatalog(catalog, "unknown", "example-model").priced).toBe(false);
  expect(metadataFromCatalog(catalog, undefined, "example-model").priced).toBe(false);
});

test("published zero prices remain distinct from missing prices", () => {
  expect(metadataFromCatalog(catalog, "openai", "free-model").priced).toBe(true);
  expect(metadataFromCatalog(catalog, "openai", "unlisted-model").priced).toBe(false);
});

test("invalid rate cards are rejected rather than displaying free usage", () => {
  expect(() => metadataFromCatalog(catalog, "openai", "bad-price")).toThrow();
});

test("zero-context image metadata is valid but never represented as a chat model", () => {
  expect(metadataFromCatalog(catalog, "openai", "gpt-image-2")).toEqual({ chat: false, priced: true });
  expect(metadataFromCatalog(catalog, "openai", "opaque-renderer")).toEqual({ chat: false, priced: false });
  expect(metadataFromCatalog(catalog, "openai", "opaque-raster")).toEqual({ chat: false, priced: true });
  expect(metadataFromCatalog(catalog, "openai", "gpt-image-2-landscape")).toEqual({ chat: false, priced: false });
});

test("zero context is still invalid for an explicitly conversational model", () => {
  expect(() => metadataFromCatalog(catalog, "openai", "bad-chat-context")).toThrow();
});

test("non-chat classification does not hide malformed rate cards", () => {
  expect(() => metadataFromCatalog(catalog, "openai", "bad-image-price")).toThrow();
});

const deepseekAlias = "deepseek/deepseek-v4.1-flash";
const aliasCatalog = ModelsDevCatalog.parse({
  openai: { models: {
    "gpt-example": { cost: { input: 3, output: 9, cache_read: 0.25 }, limit: { context: 500_000, output: 32_000 } },
    "gpt-no-cost": { limit: { context: 250_000, output: 16_000 } },
    "gpt-zero-cost": { cost: { input: 0, output: 0 } },
    "example-model": { cost: { input: 2, output: 4 } },
    "deepseek-flash": { cost: { input: 99, output: 99 } },
  } },
  deepseek: { models: { "deepseek-flash": { cost: { input: 0.1, output: 0.2 } } } },
  other: { models: {
    "gpt-example": { cost: { input: 99, output: 99 } },
    "gpt-other-only": { cost: { input: 99, output: 99 } },
    "gpt-example-daybreak-blue": { cost: { input: 7, output: 11 } },
    "gpt-example-daybreak-red": { limit: { context: 32_000, output: 4_000 } },
    [deepseekAlias]: { cost: { input: 1, output: 2 } },
  } },
});

test.each(["blue", "red"])("Daybreak %s uses the exact OpenAI base rate card on a miss", color => {
  const result = metadataFromCatalog(aliasCatalog, "gateway", `gpt-example-daybreak-${color}`);
  expect(result).toMatchObject({
    chat: true, priced: true, referencePricing: true,
    model: { contextWindow: 500_000, maxTokens: 32_000, cost: { input: 3, output: 9, cacheRead: 0.25 } },
  });
});

test("the qualified DeepSeek Flash alias uses first-party reference prices", () => {
  expect(metadataFromCatalog(aliasCatalog, "gateway", deepseekAlias)).toMatchObject({
    chat: true, priced: true, referencePricing: true,
    model: { cost: { input: 0.1, output: 0.2 } },
  });
  const missingFirstParty = { openai: aliasCatalog.openai! };
  expect(metadataFromCatalog(missingFirstParty, "gateway", deepseekAlias).priced).toBe(false);
});

test("exact owner and ID win over either reference lookup, even without a rate card", () => {
  for (const [id, input] of [["gpt-example-daybreak-blue", 7], [deepseekAlias, 1]] as const) {
    const result = metadataFromCatalog(aliasCatalog, "other", id);
    expect(result).toMatchObject({ chat: true, priced: true, model: { cost: { input } } });
    expect(result).not.toHaveProperty("referencePricing");
  }
  const unpriced = metadataFromCatalog(aliasCatalog, "other", "gpt-example-daybreak-red");
  expect(unpriced).toMatchObject({ chat: true, priced: false, model: { contextWindow: 32_000 } });
  expect(unpriced).not.toHaveProperty("referencePricing");
});

test("only derived entries with rates are marked as reference pricing", () => {
  const unpriced = metadataFromCatalog(aliasCatalog, "gateway", "gpt-no-cost-daybreak-blue");
  expect(unpriced).toMatchObject({ chat: true, priced: false, model: { contextWindow: 250_000 } });
  expect(unpriced).not.toHaveProperty("referencePricing");
  expect(metadataFromCatalog(aliasCatalog, "gateway", "gpt-zero-cost-daybreak-red", { kind: "image" }))
    .toEqual({ chat: false, priced: true, referencePricing: true });
});

test.each([
  "example-model-daybreak-blue",
  "gpt-example-daybreak-green",
  "gpt-example-daybreak-blue-latest",
  "gpt-example-daybreak-blue-daybreak-red",
  "gpt-other-only-daybreak-blue",
  "openai/gpt-example-daybreak-blue",
  "deepseek-v4.1-flash",
  "other/deepseek-v4.1-flash",
  "deepseek/deepseek-v4.1-flash-latest",
  "deepseek-flash",
])("does not infer reference prices for %s", id => {
  const result = metadataFromCatalog(aliasCatalog, "gateway", id);
  expect(result.priced).toBe(false);
  expect(result).not.toHaveProperty("referencePricing");
});
