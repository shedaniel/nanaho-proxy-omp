import type { ExtensionAPI, ExtensionContext, ProviderConfig } from "@oh-my-pi/pi-coding-agent";
import { createModelDiscovery } from "./provider";
import { loadBaseUrl, saveBaseUrl } from "./config";

const PROVIDER = "nanaho-proxy";
const HELP = "Nanaho Proxy: /nanaho-proxy setup to configure your endpoint; /login nanaho-proxy to enter an API key; /nanaho-proxy refresh; /model to select a model and see prices; /nanaho-proxy status; /nanaho-proxy usage for session tokens; /logout nanaho-proxy to remove saved keys.";

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
    pi.registerProvider(PROVIDER, {
      ...providerConfig,
      ...(baseUrl ? {
        baseUrl,
        api: "openai-responses" as const,
        authHeader: true,
        fetchDynamicModels: createModelDiscovery(baseUrl),
      } : {}),
    });
  }
  register();

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
    await ctx.modelRegistry.refreshProvider(PROVIDER, "online");
    const state = ctx.modelRegistry.getProviderDiscoveryState(PROVIDER);
    show(pi, ctx, state?.error ? `Nanaho Proxy discovery failed: ${state.error}` : `Nanaho Proxy endpoint saved: ${ctx.modelRegistry.getProviderModels(PROVIDER).length} models loaded. Open /model to select one.`);
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
        await ctx.modelRegistry.refreshProvider(PROVIDER, "online");
        const state = ctx.modelRegistry.getProviderDiscoveryState(PROVIDER);
        show(pi, ctx, state?.error ? `Nanaho Proxy refresh failed: ${state.error}` : `Nanaho Proxy refreshed: ${ctx.modelRegistry.getProviderModels(PROVIDER).length} models loaded.`);
        return;
      }
      if (action === "usage") {
        show(pi, ctx, usageText(ctx));
        return;
      }
      if (action === "status") {
        const configured = ctx.modelRegistry.authStorage.keys.source(PROVIDER) !== undefined;
        show(pi, ctx, `Nanaho Proxy\nAPI key: ${configured ? "configured" : "not configured"}.\nResponses endpoint: ${baseUrl ?? "not configured — run /nanaho-proxy setup"}\nModels: ${ctx.modelRegistry.getProviderModels(PROVIDER).length} loaded (prices from models.dev; see /model).\n${HELP}`);
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
