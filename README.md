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
| `/nanaho-proxy status` | Show key presence, endpoint, and loaded model count without printing the key |
| `/nanaho-proxy refresh` | Reload gateway models and current models.dev metadata |
| `/nanaho-proxy usage` | Show recorded token usage on the current session branch and explain unavailable account billing |
| `/model` | Select a model and inspect registered models.dev pricing |
| `/usage` | Open omp's native provider usage view; Nanaho Proxy does not register an account-usage provider |

## Model discovery and pricing

Discovery uses the standard `${baseUrl}/models` endpoint: `/v1/models` when the configured base URL ends in `/v1`. Its `data` array supplies model IDs and `owned_by`. Inference uses the standard Responses endpoint, `${baseUrl}/responses`, preserving streaming and reasoning support. No Sub2API-specific models manifest or extra capability query is assumed.

[models.dev](https://models.dev/api.json) supplies pricing and model metadata only when both the gateway's `owned_by` and model ID match exactly. The extension does not borrow another provider's price, guess an alias, or infer gateway billing from catalog metadata. Published metadata supplies supported capabilities, limits, and token rates; models without an exact match remain explicitly unpriced. Refresh discovery after gateway or catalog changes with `/nanaho-proxy refresh`.

Unknown prices are labeled **“pricing unknown”** in model display names. omp 18.11.1 requires numeric cost fields and can label zero-valued picker rows “free”; those placeholder values do **not** mean an unpriced model is free. Check the model name/details. Session cost estimates are incomplete for unpriced models and are not account bills. Published zero rates remain distinct from unknown rates. Supported catalog rates use the standard token prices and first long-context tier.

The gateway API key is used only for gateway requests, never for models.dev. Discovery failures are reported rather than replaced with fabricated model IDs, prices, or account data.

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

Runtime verification exercises the real `omp` CLI, not only unit tests. Live authenticated discovery and the session-usage command were checked; Responses streaming and token accounting were exercised against a local protocol server. Successful live inference still requires available upstream models/accounts.

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
