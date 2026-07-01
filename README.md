# Fylun Code

Branded distribution of [opencode](https://github.com/anomalyco/opencode) (MIT, anomalyco)
preconfigured with Fylun as the provider, plus a standalone auth plugin that also works in
stock opencode. This is **not a fork**: upstream source is never committed here. We pin a
release tag, fetch it at build time, apply a small identity overlay, and build.

Built on OpenCode (MIT) — keep this attribution visible in anything user-facing.

## Layout

```
fylun-code/
├── UPSTREAM_VERSION        # pinned upstream release tag (v1.17.3)
├── upstream/               # gitignored; shallow clone managed by scripts
├── overlay/patches/        # the entire diff between opencode and fylun-code
├── plugin/                 # Fylun auth provider — compiled into the binary (patch 08)
├── distribution/           # baked default global config shipped by the installer
└── scripts/                # fetch-upstream.sh, apply-overlay.sh, build.sh
```

## Build

Requires [bun](https://bun.sh) (upstream pins 1.3.x). Not installed on this machine yet.

```bash
./scripts/build.sh   # fetch pinned upstream → apply overlay → bun build (current platform)
# binary lands at upstream/packages/opencode/dist/<target>/bin/fylun-code
```

## Pulling upstream updates

1. Edit `UPSTREAM_VERSION` to the new tag.
2. `./scripts/build.sh`. `apply-overlay.sh` dry-runs every patch first and fails loudly
   if upstream drifted under one — re-derive that patch against the new version
   (edit the file in `upstream/`, `git -C upstream diff <files> > overlay/patches/NN-name.patch`,
   `git -C upstream checkout -- .`).
3. Smoke test alongside a stock opencode install: separate dirs, separate auth, both run.

## The overlay (what we change and why)

| Patch | What | Why |
|---|---|---|
| 01-identity | `app = "fylun-code"` in `packages/core/src/global.ts` | Single constant all XDG paths derive from: data, cache, config, state, tmp — **including `auth.json`**. Complete on-disk separation from stock opencode. |
| 02-config-files | Global config filenames → `fyluncode.json(c)`; tui-migrate disabled | Global config is ours; migration code *writes to* (strips keys from) any `opencode.json` found up the tree — must never touch a stock user's files. |
| 03-binary-name | Build outfile + yargs scriptName → `fylun-code` | Binary/help-text identity. |
| 04-update-channel | `latest` queries `usefylun/fylun-code` GitHub releases; `upgrade` re-runs the install script (`fylun.ai/code/install`) | Upstream's upgrade paths install `opencode-ai` from npm/brew/GitHub — would replace this binary with stock opencode. Now wired to Fylun's own release + installer, so `fylun-code upgrade` self-updates and update-available checks work. |
| 05-branding | ASCII logo + wordmark say "fylun code" | Identity in the TUI banner / help logo. |
| 06-pinned-catalog | Baked models.dev snapshot is authoritative (no disk-cache preference, no runtime fetch/refresh); model dialog drops the "Recent" section and the "Connect provider" action | The catalog feeds the provider/`/login` list and the model picker. `build.sh` bakes a Fylun-only catalog (`distribution/models-fylun.json`) via `MODELS_DEV_API_JSON` so only Fylun appears — never anomalyco's providers. Don't bake an empty `{}` catalog: that also removes Fylun from the connect/`/login` list. |
| 07-login-flow | `AutoMethod` exported; `/login` is a dedicated command that goes straight to Fylun browser OAuth (skips the provider list + auth-method menu), falling back to the full dialog if unavailable. `/connect` keeps the full menu. The "Other / custom provider" entry is removed so **Fylun is the lone provider** in the UI | Fast Claude-Code-style login + single-provider product. The plugin auto-opens the browser (no link click). API-key method still lives in `/connect` + Settings → Security; custom providers still work via config, just not advertised. |
| 08-bundled-auth | Registers `FylunAuthPlugin` in opencode's `internalPlugins` so the auth provider is **compiled into the binary** (like opencode's own Copilot/xAI/GitLab auth), not installed from npm | No npm package, no `plugin` config entry, no runtime plugin-install. `build.sh` copies `plugin/src/index.ts` → `upstream/.../plugin/fylun-auth.ts` before building. Updates ship with the binary. |
| 10-fd-limit-wrapper | Every macOS/Linux build (local `--single` dev builds and CI release builds alike) ships `fylun-code` as a thin shell wrapper (`ulimit -n 65536` then `exec`) around the real binary, renamed `fylun-code-bin`. Applied per-target inside the main build loop, not gated behind `Script.release` — a release-only gate would mean local rebuilds silently skip the fix. Windows untouched (no rlimit concept). | macOS defaults new shells to a 256 fd soft limit; opencode's file watching/sync on startup can exceed it (`EMFILE`/"low max file descriptors" on launch). Raising the soft limit up to the already-permitted hard limit needs no sudo and only affects this process — fixes it transparently instead of asking users to edit shell config. Both `install/route.ts` and the Homebrew formula must install `fylun-code` **and** `fylun-code-bin` for this to work. |
| 11-sidebar-footer-branding | `packages/tui/src/feature-plugins/sidebar/footer.tsx` and `packages/tui/src/routes/session/sidebar.tsx` both render the sidebar footer version line as `<b>Open</b><b>Code</b>`, untouched by patch 09 (which only renamed the terminal *window title*). Both now render `Fylun` `Code`. | Same "OpenCode" leak as patch 09, different render path — the sidebar footer is a separate slot-based component tree, not covered by the app.tsx title-bar patch. |

### Deliberate non-changes

- **Project-level config (`opencode.json`, `.opencode/`) is still read.** Repo-portable
  agents/commands/MCP config working in both tools is a feature. fylun-code never writes
  these files (that was the tui-migrate patch).
- **Env vars stay `OPENCODE_*`.** Renaming is deep surgery for little gain. Known shared
  surface: a user who sets e.g. `OPENCODE_CONFIG` globally affects both tools. Documented,
  acceptable.
- **No hard provider lock.** Only Fylun is configured by default; a user editing config to
  add their own keys is fine. The lock is the product (one login, every model), not code.

## Auth plugin (`plugin/src/index.ts`)

The Fylun auth provider (provider id `fylun`). **Compiled into the binary** via
opencode's `internalPlugins` (patch 08) — same mechanism as opencode's own
Copilot/xAI/GitLab providers. Not an npm package, not a config `plugin` entry,
no runtime install. `build.sh` copies this file into the opencode source tree
before building (`upstream/.../plugin/fylun-auth.ts`); this is the source of truth.

- **Browser OAuth** (Claude Code-style): PKCE + one-shot loopback server on
  `127.0.0.1:<random>/callback`, opens the `fylun.ai` authorize page, auto-launches
  the browser, then 302s the browser to `fylun.ai/code/connected`. Tokens stored by
  opencode in `auth.json` (0600). Single-flight refresh (coalesces concurrent
  refreshes so the server's token rotation doesn't race).
- **API key** fallback (`fyl_...`) for headless/CI.
- **Loader**: points `@ai-sdk/openai-compatible` at the Fylun API and injects/refreshes
  the bearer token per-request, persisting rotated tokens via `client.auth.set`.

The `default export { id, server }` shape means the same file *could* also be
published to npm later (for stock-opencode users) without changes — but the
binary doesn't depend on that.

## fylun-web integration (BUILT 2026-06-11)

All endpoints exist in fylun-web (`apps/main`):

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/chat/completions` | OpenAI-compatible chat: streaming + non-streaming, tools/tool_calls round-trip, `reasoning_effort` -> per-model ThinkingSupport translation, `reasoning_details` round-trip (Anthropic interleaved thinking), server-side `cache_control` injection, cache-tier-aware billing with markup, durable usage recording into the shared credit ledger. Auth: Bearer OAuth access token or `fyl_` API key. |
| `GET /api/v1/models` | Model list from @fylun/ai ModelRegistry with `fylun` extension block (limits, costs, reasoning/interleaved capability). |
| `GET /oauth/authorize` (page) + `POST /api/oauth/authorize` | Consent page; mints one-time PKCE-bound codes (Redis, 10 min TTL, loopback-only redirect URIs). |
| `POST /api/oauth/token` | `authorization_code` (PKCE S256) + `refresh_token` (rotating) grants for client_id `fylun-code`. Reuses the REST JWT infra (15-min access tokens). |

API keys: `trpc.apiKeys.create/list/revoke` (sha256-hashed at rest, plaintext shown once, max 10 active). Quota service tag: `cli_openai_compat`.

Implementation lives at `fylun-web/apps/main/src/lib/openai-compat/` (schema, translate, auth) + the route files; unit tests colocated in `__tests__/translate.test.ts`.

### Regenerating models

The models block in `distribution/fyluncode.jsonc` is generated from the same
registry that serves /v1/models:

```bash
cd fylun-web && pnpm --filter @fylun/ai build && node -e \
'const {ModelRegistry,getModelThinkingSupport}=require("./packages/ai/dist/providers.js"); /* see git history for the full snippet */'
```

Re-run whenever the catalog changes (or curl /v1/models once prod is live).

### Local dev loop

Point the plugin at a local fylun-web dev server:

```bash
FYLUN_API_URL=http://localhost:3000/api/v1 \
FYLUN_OAUTH_AUTHORIZE_URL=http://localhost:3000/oauth/authorize \
FYLUN_OAUTH_TOKEN_URL=http://localhost:3000/api/oauth/token \
fylun-code
```

### Known residual gaps (accepted for v1)

- No Responses-API reasoning persistence for GPT-5.x (vs Codex CLI); optional
  /v1/responses endpoint later.
- Anthropic reasoning signatures are captured from `reasoning-end` stream
  parts; if a provider emits signatures elsewhere, reasoning_details degrade
  to unsigned text (functional, slightly lower quality on tool-heavy turns).
- Cache-read/write price multipliers are provider-wide constants in
  `translate.ts` — move into ModelRegistry per-model when catalog is rebuilt.

## Still TODO in this folder

- TUI/branding strings beyond the binary name (logo, "opencode" in help/about text) —
  cosmetic, decide how far to take it.
- Installer script (place binary on PATH as `fylun-code` **plus a `fylun` symlink** —
  both names launch the TUI; locally done via `ln -s` in /opt/homebrew/bin — and put
  `distribution/fyluncode.jsonc` into `~/.config/fylun-code/`).
- VS Code extension rebrand (upstream ships one in the same repo).
- CI: build on UPSTREAM_VERSION bump, run both-tools-coexist smoke test.
