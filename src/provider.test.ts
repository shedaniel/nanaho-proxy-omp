import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { createModelDiscovery } from "./provider";

const baseUrl = "https://gateway.invalid/private-endpoint/v1";
const apiKey = "test-only-api-key-do-not-log";
const catalogUrl = "https://models.dev/api.json";
const list = {
  object: "list",
  data: [{ id: "example-model", object: "model", created: 0, owned_by: "openai" }],
};
const catalog = {
  openai: { models: {
    "example-model": {
      cost: { input: 3, output: 9, cache_read: 0.25, cache_write: 4 },
      limit: { context: 200_000, output: 32_000 },
      modalities: { input: ["text", "image"] },
      reasoning: true,
    },
  } },
};

function mockDiscovery(respond: (url: string, options?: RequestInit) => Response | Promise<Response>) {
  return spyOn(globalThis, "fetch").mockImplementation(Object.assign(
    async (input: RequestInfo | URL, options?: RequestInit) =>
      respond(input instanceof Request ? input.url : String(input), options),
    { preconnect: globalThis.fetch.preconnect },
  ));
}

afterEach(() => mock.restore());

test("discovers a standard model list without a separate capabilities manifest", async () => {
  const requests: { url: string; options?: RequestInit }[] = [];
  mockDiscovery((url, options) => {
    requests.push({ url, options });
    if (url === `${baseUrl}/models`) return Response.json(list);
    if (url === catalogUrl) return Response.json(catalog);
    throw new Error("Unexpected discovery request");
  });

  const models = await createModelDiscovery(baseUrl)(apiKey);

  expect(requests.map(request => request.url)).toEqual([`${baseUrl}/models`, catalogUrl]);
  expect(new Headers(requests[0].options?.headers).get("authorization")).toBe(`Bearer ${apiKey}`);
  expect(new Headers(requests[1].options?.headers).get("authorization")).toBeNull();
  expect(models).toHaveLength(1);
  expect(models[0]).toMatchObject({
    id: "example-model",
    name: "example-model",
    api: "openai-responses",
    cost: { input: 3, output: 9, cacheRead: 0.25, cacheWrite: 4 },
    contextWindow: 200_000,
    maxTokens: 32_000,
    input: ["text", "image"],
    reasoning: true,
  });
});

test.each(["gateway-owner", undefined, ""] as const)("keeps pricing unknown for a nonmatching or absent owner %j", async owner => {
  mockDiscovery(url => {
    if (url === `${baseUrl}/models`) {
      return Response.json({ data: [{ id: "example-model", ...(owner === undefined ? {} : { owned_by: owner }) }] });
    }
    if (url === catalogUrl) return Response.json(catalog);
    throw new Error("Unexpected discovery request");
  });

  const models = await createModelDiscovery(baseUrl)(apiKey);

  expect(models).toHaveLength(1);
  expect(models[0].id).toBe("example-model");
  expect(models[0].name).toContain("(pricing unknown)");
  expect(models[0].cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test("does not request models or public pricing without an API key", async () => {
  const fetch = mockDiscovery(() => { throw new Error("No request should be made"); });

  expect(await createModelDiscovery(baseUrl)(undefined)).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  "gateway network",
  "gateway HTTP",
  "gateway JSON",
  "gateway schema",
  "catalog network",
  "catalog HTTP",
  "catalog JSON",
  "catalog schema",
  "catalog model metadata",
] as const)("does not expose endpoints or credentials in %s failures", async failure => {
  const secret = `${baseUrl} ${apiKey}`;
  mockDiscovery(url => {
    if (url === `${baseUrl}/models`) {
      if (failure === "gateway network") throw new Error(secret, { cause: new Error(secret) });
      if (failure === "gateway HTTP") return new Response(secret, { status: 401 });
      if (failure === "gateway JSON") return new Response(`invalid JSON ${secret}`);
      if (failure === "gateway schema") return Response.json({ data: secret });
      return Response.json(list);
    }
    if (url === catalogUrl) {
      if (failure === "catalog network") throw new Error(secret, { cause: new Error(secret) });
      if (failure === "catalog HTTP") return new Response(secret, { status: 503 });
      if (failure === "catalog JSON") return new Response(`invalid JSON ${secret}`);
      if (failure === "catalog schema") return Response.json({ [secret]: { models: [] } });
      if (failure === "catalog model metadata") {
        return Response.json({ openai: { models: { "example-model": { cost: { input: secret, output: 9 } } } } });
      }
      return Response.json(catalog);
    }
    throw new Error("Unexpected discovery request");
  });

  const error: unknown = await createModelDiscovery(baseUrl)(apiKey).then(() => undefined, error => error);

  expect(error).toBeInstanceOf(Error);
  if (!(error instanceof Error)) throw new Error("Expected discovery to reject");
  const diagnostic = `${error}\n${error.stack ?? ""}\n${JSON.stringify(error)}`;
  expect(diagnostic).not.toContain(baseUrl);
  expect(diagnostic).not.toContain(apiKey);
  expect(error.cause).toBeUndefined();
});
