import type { ExtensionAPI, ExtensionContext, ProviderConfig } from "@oh-my-pi/pi-coding-agent";
import { createModelDiscovery } from "./provider";
import { loadBaseUrl, saveBaseUrl } from "./config";

const PROVIDER = "nanaho-proxy";
const HELP = "Nanaho Proxy: /nanaho-proxy setup to configure your endpoint; /login nanaho-proxy to enter an API key; /nanaho-proxy refresh; /model to select a model and see prices; /nanaho-proxy status; /nanaho-proxy usage for session tokens; /logout nanaho-proxy to remove saved keys.";

type DiscoveryOutcome = { status: "idle" | "pending" | "ready" | "unauthenticated" } | { status: "failed"; error: string };

function discoveryError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  // Only our fixed callback errors are safe to display; host/network errors can contain secrets.
  if (/^Nanaho Proxy (?:model list|models\.dev catalog) (?:request failed(?: \(HTTP \d{3}\))?|response is not valid JSON|response has invalid data)\.$/.test(message)
    || message === "Nanaho Proxy models.dev catalog contains invalid model metadata.") return message;
  return "Nanaho Proxy model discovery failed. Check gateway availability and run /nanaho-proxy refresh.";
}

function show(pi: ExtensionAPI, ctx: ExtensionContext, text: string): void {
  if (ctx.hasUI) {
    ctx.ui.notify(text, "info");
  } else {
    pi.sendMessage({ customType: "nanaho-proxy", content: text, display: true });
  }
}

function usageText(ctx: ExtensionContext): string {
  let responses = 0;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;

  // Read persisted branch history so reloads and branching need no separate counters.
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const message = entry.message;
    if (message.provider !== PROVIDER) continue;
    responses++;
    input += message.usage.input;
    output += message.usage.output;
    cacheRead += message.usage.cacheRead;
    cacheWrite += message.usage.cacheWrite;
  }

  const local = responses === 0
    ? "No Nanaho Proxy responses recorded on this session branch."
    : `${responses} recorded Nanaho Proxy responses on this session branch.\nTokens: ${input} input, ${output} output, ${cacheRead} cache read, ${cacheWrite} cache write.`;

  return `${local}\nAccount-wide billing data is unavailable through the public gateway API; these are local session tokens only.`;
}

export default async function nanahoProxy(pi: ExtensionAPI): Promise<void> {
  let baseUrl = await loadBaseUrl(process.cwd());
  let discovery: DiscoveryOutcome = { status: "idle" };
  let registration: object | undefined;
  let endpointChanged = false;
  const providerConfig: ProviderConfig = {
    // Only configure the fallback when it exists; unresolved key strings can be literals.
    ...(process.env.NANAHO_PROXY_API_KEY?.trim() ? { apiKey: "NANAHO_PROXY_API_KEY" } : {}),
    // omp's login contract accepts a plain API key; no OAuth server is required.
    oauth: {
      name: "Nanaho Proxy",
      async login(callbacks) {
        if (!baseUrl) {
          const endpoint = await callbacks.onPrompt({
            message: "Nanaho Proxy gateway API base URL (including /v1; saved for future sessions)",
            placeholder: "API base URL ending in /v1",
            allowEmpty: false,
          });
          baseUrl = await saveBaseUrl(process.cwd(), endpoint);
          register();
        }
        const key = (await callbacks.onPrompt({
          message: "Nanaho Proxy API key (saved in omp's credential store)",
          secret: true,
          allowEmpty: false,
        })).trim();
        if (!key) throw new Error("Nanaho Proxy API key cannot be empty.");
        return key;
      },
    },
  };

  function register(): void {
    endpointChanged = registration !== undefined;
    registration = {};
    const currentRegistration = registration;
    discovery = { status: "idle" };
    const discover = baseUrl ? createModelDiscovery(baseUrl) : undefined;
    pi.registerProvider(PROVIDER, {
      ...providerConfig,
      ...(baseUrl && discover ? {
        baseUrl,
        api: "openai-responses" as const,
        authHeader: true,
        fetchDynamicModels: async (apiKey: string | undefined) => {
          const attempt: DiscoveryOutcome = { status: "pending" };
          if (registration === currentRegistration) discovery = attempt;
          try {
            const models = await discover(apiKey);
            if (registration === currentRegistration && discovery === attempt) {
              discovery = { status: apiKey ? "ready" : "unauthenticated" };
            }
            return models;
          } catch (error) {
            const message = discoveryError(error);
            if (registration === currentRegistration && discovery === attempt) discovery = { status: "failed", error: message };
            // The host can swallow callback failures while retaining cached or bundled models.
            throw new Error(message);
          }
        },
      } : {}),
    });
  }
  register();

  function discoveryText(ctx: ExtensionContext): string {
    const count = ctx.modelRegistry.getProviderModels(PROVIDER).length;
    const models = `Models: ${count} loaded (prices from models.dev; see /model).`;
    const state = ctx.modelRegistry.getProviderDiscoveryState(PROVIDER);
    let status: string;
    if (!baseUrl) status = "not configured — run /nanaho-proxy setup.";
    else if (discovery.status === "pending") status = "pending — live discovery is in progress.";
    else if (discovery.status === "failed") status = `failed: ${discovery.error}`;
    else if (discovery.status === "unauthenticated" || !ctx.modelRegistry.authStorage.keys.source(PROVIDER)) {
      status = "API key not configured — run /login nanaho-proxy.";
    } else if (endpointChanged && discovery.status === "idle") {
      // The host can still hold discovery state from the previous endpoint.
      status = "pending — no live discovery has completed for this endpoint.";
    } else if (state?.error) status = `failed: ${discoveryError(state.error)}`;
    else if (state?.status === "cached") status = state.stale
      ? "using stale cached models; live discovery is unavailable. Run /nanaho-proxy refresh."
      : "using cached models; run /nanaho-proxy refresh for a live update.";
    else if (state?.status === "unavailable") status = "unavailable; loaded models, if any, are not a successful live refresh. Run /nanaho-proxy refresh.";
    else if (state?.status === "unauthenticated") status = "authentication unavailable — run /login nanaho-proxy.";
    else if (state?.status === "empty") status = "live discovery returned no supported Responses chat models.";
    else if (state?.status === "ok" || discovery.status === "ready") status = count > 0
      ? "live discovery completed."
      : "live discovery returned no supported Responses chat models.";
    else status = "pending — live discovery has not completed. Run /nanaho-proxy refresh.";
    return `Discovery: ${status}\n${models}`;
  }

  async function refresh(ctx: ExtensionContext): Promise<void> {
    const currentRegistration = registration;
    const attempt: DiscoveryOutcome = { status: "pending" };
    discovery = attempt;
    try {
      await ctx.modelRegistry.refreshProvider(PROVIDER, "online");
      if (registration === currentRegistration && discovery === attempt) {
        discovery = { status: "idle" };
        endpointChanged = false;
      }
    } catch (error) {
      if (registration === currentRegistration) discovery = { status: "failed", error: discoveryError(error) };
    }
  }

  async function setup(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) {
      show(pi, ctx, "Configure Nanaho Proxy with /nanaho-proxy setup in the TUI, or set NANAHO_PROXY_BASE_URL before starting omp.");
      return;
    }
    const endpoint = await ctx.ui.input("Nanaho Proxy gateway API base URL (including /v1)", baseUrl ?? "");
    if (endpoint === undefined) return;
    baseUrl = await saveBaseUrl(ctx.cwd, endpoint);
    register();
    if (!ctx.modelRegistry.authStorage.keys.source(PROVIDER)) {
      show(pi, ctx, "Nanaho Proxy endpoint saved. Run /login nanaho-proxy to enter your API key.");
      return;
    }
    await refresh(ctx);
    show(pi, ctx, `Nanaho Proxy endpoint saved.\n${discoveryText(ctx)}`);
  }

  pi.on("session_start", (_event, ctx) => {
    if (!baseUrl) show(pi, ctx, "Nanaho Proxy endpoint is not configured. Run /nanaho-proxy setup, or /login nanaho-proxy to configure both endpoint and API key.");
  });

  pi.registerCommand("nanaho-proxy", {
    description: "Nanaho Proxy API-key setup, status, and session token usage",
    getArgumentCompletions: (prefix) => [
      { value: "setup", label: "setup — save the gateway endpoint and discover models" },
      { value: "status", label: "status — API-key and connection status" },
      { value: "usage", label: "usage — local session tokens; account billing unavailable" },
      { value: "refresh", label: "refresh — reload live models and models.dev prices" },
    ].filter((item) => item.value.startsWith(prefix)),
    async handler(args, ctx) {
      const action = args.trim();
      if (action === "setup") {
        await setup(ctx);
        return;
      }
      if (action === "refresh") {
        if (!baseUrl) {
          show(pi, ctx, "Nanaho Proxy endpoint is not configured. Run /nanaho-proxy setup first.");
          return;
        }
        await refresh(ctx);
        show(pi, ctx, `Nanaho Proxy\n${discoveryText(ctx)}`);
        return;
      }
      if (action === "usage") {
        show(pi, ctx, usageText(ctx));
        return;
      }
      if (action === "status") {
        const configured = ctx.modelRegistry.authStorage.keys.source(PROVIDER) !== undefined;
        show(pi, ctx, `Nanaho Proxy\nAPI key: ${configured ? "configured" : "not configured"}.\nResponses endpoint: ${baseUrl ?? "not configured — run /nanaho-proxy setup"}\n${discoveryText(ctx)}\n${HELP}`);
        return;
      }
      if (action || !ctx.hasUI || ctx.mode !== "tui") {
        show(pi, ctx, HELP);
        return;
      }

      const choice = await ctx.ui.select("Nanaho Proxy", [
        "Configure endpoint",
        "Enter API key",
        "Check usage",
        "Status",
      ]);
      if (choice === "Configure endpoint") {
        await setup(ctx);
      } else if (choice === "Enter API key") {
        // Let the host own masked input and credential persistence; never put a key in chat.
        ctx.ui.setEditorText("/login nanaho-proxy");
        ctx.ui.notify("Press Enter to open omp's masked Nanaho Proxy API-key prompt.", "info");
      } else if (choice === "Check usage") {
        show(pi, ctx, usageText(ctx));
      } else if (choice === "Status") {
        ctx.ui.setEditorText("/nanaho-proxy status");
      }
    },
  });
}
