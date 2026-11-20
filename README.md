# Nanaho Proxy for oh-my-pi

`nanaho-proxy-omp` is an independent oh-my-pi provider extension for a user-configured Nanaho Proxy gateway. It provides native masked login, persistent endpoint settings, live model discovery, Responses streaming and reasoning, and current-session token usage.

Derived from [shedaniel/nanaho-omp](https://github.com/shedaniel/nanaho-omp). This link credits the original source; this project has its own package, provider, commands, settings, and credentials. It does not reuse or migrate the original provider's login or configuration.

## Install and connect

Use Bun **1.4.4**, which supports this repository's version-2 lockfile. Dependencies target omp **18.11.1**; real CLI discovery, session usage, and Responses streaming were also smoke-checked with omp **18.16.0**.

```sh
bun install --frozen-lockfile
omp --extension .
```

Inside omp:

```text
/login nanaho-proxy
/model
```

On first login, enter your gateway API base URL, including `/v1`, then enter an ordinary gateway API key in the **masked** prompt. The extension discovers models automatically. No gateway address or credential is built into the repository, and no environment variables are required. Use HTTPS when available: HTTP exposes credentials and prompts in transit.

The endpoint is saved in omp's native `nanaho-proxy-omp.baseUrl` plugin setting. The key is stored separately in omp's credential backend or configured auth broker, not in this repository. Hosts that cannot mask input reject the secret prompt. Use a normal inference API key only: **never supply an administrator secret**, place a key in a URL, or put it in chat, command arguments, or committed files.

Choose a `nanaho-proxy/…` model through `/model`. If you already have a saved login but no models appear, run `/nanaho-proxy setup` to save the endpoint and discover models with that login without restarting. The same command changes the endpoint later. Catalog discovery does not guarantee inference availability: a listed model can still be unsupported by the Responses backend or have no usable upstream account. Check gateway availability rather than assuming a discovered ID is ready to generate; the extension does not invent replacement IDs or aliases.

To keep the extension enabled across sessions, run from this directory:

```sh
omp plugin link .
```

Restart omp after changing extension source. The native endpoint setting and credentials persist across restarts. Before starting omp, the setting can also be managed with:

```sh
omp plugin config set nanaho-proxy-omp baseUrl <gateway-api-url>
```

Optional environment fallbacks are independent of the original Nanaho extension:

| Variable | Use |
| --- | --- |
| `NANAHO_PROXY_BASE_URL` | API base URL when no native endpoint setting exists |
| `NANAHO_PROXY_API_KEY` | API key when no saved Nanaho Proxy login exists |

A saved Nanaho Proxy login takes precedence over the environment key. `/logout nanaho-proxy` removes stored Nanaho Proxy credentials, but does not unset an environment variable or affect the original provider's credentials.

## Commands

| Command | Behavior |
| --- | --- |
| `/nanaho-proxy` | Open the setup menu; the API-key action prepares `/login nanaho-proxy` in the composer |
| `/nanaho-proxy setup` | Save the native endpoint setting and discover models using the existing login |
| `/nanaho-proxy status` | Show key presence, endpoint, loaded model count, and live/cached/pending/failed discovery status without printing the key |
| `/nanaho-proxy refresh` | Request live gateway models and current models.dev metadata, reporting discovery failures even when omp retains cached models |
| `/nanaho-proxy usage` | Show recorded token usage on the current session branch and explain unavailable account billing |
| `/model` | Select a model and inspect registered models.dev pricing |
| `/usage` | Open omp's native provider usage view; Nanaho Proxy does not register an account-usage provider |

## Model discovery and pricing

Discovery uses the standard `${baseUrl}/models` endpoint: `/v1/models` when the configured base URL ends in `/v1`. Its `data` array supplies model IDs and `owned_by`. Inference uses the standard Responses endpoint, `${baseUrl}/responses`, preserving streaming and reasoning support. No Sub2API-specific models manifest or extra capability query is assumed.

[models.dev](https://models.dev/api.json) supplies metadata. Exact `owned_by` and model ID matches take precedence. On a miss, `gpt-*` models with a terminal `-daybreak-blue` or `-daybreak-red` suffix use the unsuffixed OpenAI model's metadata, and `deepseek/deepseek-v4.1-flash` uses first-party `deepseek-flash` metadata. Requests still use the original gateway ID. Alias prices are labeled **“reference pricing”**: published rates, not verified gateway billing. Unmatched chat models use a 128K context and 16,384-token output fallback, not a measured limit. OMP's **Extended Context** setting can lift its default cap at a model's premium pricing breakpoint where catalog metadata provides a larger window.

Discovery registers Responses **chat** models only. Classification prefers explicit gateway kind/output, then catalog kind/output, then catalog media-ID rules. Text-plus-image output remains eligible unless an explicit kind is non-chat. Valid non-chat entries with a zero context limit do not invalidate the chat roster; malformed catalog metadata still fails discovery. The exact IDs `gpt-live`, `gpt-live-1`, and `gpt-live-1-mini` are excluded because they are advertised but rejected on the Responses route. Discovery does not send per-model inference probes.

`gpt-6.2-sol` opts into OMP's streaming server compaction on `/responses`. This is the verified `compaction_trigger` route, not the separate `/responses/compact` endpoint. Other models retain OMP's existing compaction behavior.

Unknown prices are labeled **“pricing unknown”** in model display names. omp 18.11.1 requires numeric cost fields and can label zero-valued picker rows “free”; those placeholder values do **not** mean an unpriced model is free. Check the model name/details. Session cost estimates are incomplete for unpriced models and are not account bills. Published zero rates remain distinct from unknown rates. Supported catalog rates use the standard token prices and first long-context tier.

The gateway API key is used only for gateway requests, never for models.dev. Discovery failures are reported rather than replaced with fabricated model IDs, prices, or account data. The extension retains sanitized callback failures before returning them to omp, because the host may retain cached or bundled models without exposing the original error. `/nanaho-proxy status`, `/nanaho-proxy refresh`, and `/nanaho-proxy setup` report that failure separately from the loaded count. A new attempt clears the previous failure, a successful result replaces it, and changing the endpoint resets the extension's discovery diagnostics. Unexpected host errors use a generic diagnostic rather than displaying raw upstream error text.

Startup discovery remains host-managed and cache-aware; registration does not issue a separate online request. Status distinguishes cached models (including stale caches), discovery that has not completed, an empty supported-model result, unavailable discovery, and missing authentication. A loaded count alone is not evidence that a live refresh succeeded.

## Troubleshooting discovery

- If `/model` has no Nanaho Proxy models, run `/nanaho-proxy status`, then `/nanaho-proxy refresh`. Read the **Discovery** line, not just the model count. A discovery failure can leave zero models or previously cached models loaded.
- A model-list HTTP 401/403 means the gateway rejected the inference key; use `/login nanaho-proxy` to replace it through the native masked prompt. Check the saved endpoint with `/nanaho-proxy setup` if it points to the wrong gateway.
- A model-list or models.dev request failure means that source could not be fetched. Check network/gateway availability, then refresh. Invalid JSON, invalid response data, and malformed catalog metadata are errors, not a successful empty catalog; no guessed prices or model fallback are substituted.
- Cached or pending status does not prove the gateway is reachable. Refresh requests an online discovery pass; setup also does so when a key already exists. Neither command adds retries or changes credential storage.
- A successful empty supported-model result is distinct from a failure: the gateway may list only non-chat models. Review the gateway's supported Responses chat inventory rather than assuming every `/models` entry can be used in `/model`.

When reporting a problem, share only the sanitized Discovery line and relevant model IDs. Do not share API keys, credential-store files, private gateway addresses, or raw gateway responses.

## Usage and account billing

`/nanaho-proxy usage` preserves token usage recorded by omp on the **current session branch**. These are local session records, not account-wide consumption, remaining credit, or a live quota balance. Any catalog-based cost estimate is likewise not authoritative gateway billing.

The gateway has no documented public account-usage or quota API. This extension does not request `/v1/usage`, attempt administrator APIs, accept administrator secrets, or fabricate quota windows, balances, reset times, or billing. Account billing and quota are **unavailable** through this provider; consult your gateway operator's supported account interface instead. Native `/usage` cannot supply a live Nanaho Proxy account balance.

## Development

Use Bun 1.4.4 for the checked-in version-2 lockfile; older Bun versions may not understand it. Dependencies remain pinned by `bun.lock`.

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
omp plugin install --dry-run .
```

Runtime verification exercises the real `omp` CLI, not only unit tests. Live authenticated discovery, refresh/status, and the session-usage command were checked. A local mixed chat/image catalog verifies that valid zero-context image metadata leaves chat discovery intact; HTTP-failure and recovery runs verify retained diagnostics and error clearing. Responses streaming and token accounting were exercised against a local protocol server. Successful live inference still requires available upstream models/accounts.

Keep local configuration and credentials outside committed files. `.env`, `.env.*`, `.omp/`, and `node_modules/` are ignored. Do not commit gateway documentation attachments or live credentials.

## Initial changes — 0.1.0

- Established the independent `nanaho-proxy-omp` package and `nanaho-proxy` provider, commands, login, and usage scope.
- Kept user-configured endpoints, native masked credentials, persistent setup, streaming/reasoning, and exact-owner models.dev metadata.
- Switched discovery to the standard models API without a Sub2API manifest or inferred model aliases.
- Removed unsupported account-quota integration while retaining session token usage and explicit unknown-price/billing labels.
- Retained the original repository link as source attribution only; no compatibility aliases or shared credentials.

## References

- [Original source: shedaniel/nanaho-omp](https://github.com/shedaniel/nanaho-omp)
- [omp plugin packaging and installation](https://omp.sh/docs/plugins)
- [omp extension authoring and provider registration](https://omp.sh/docs/extension-authoring)
- [models.dev API](https://models.dev/api.json)
