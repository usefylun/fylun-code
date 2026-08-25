# Fylun Code

Branded distribution of [opencode](https://github.com/anomalyco/opencode) (MIT, anomalyco)
preconfigured with Fylun as the provider, plus a standalone auth plugin that also works in
stock opencode. This is **not a fork**: upstream source is never committed here. We pin a
release tag, fetch it at build time, apply a small identity overlay, and build.

Built on OpenCode (MIT) — keep this attribution visible in anything user-facing.

## Layout

```
fylun-code/
├── UPSTREAM_VERSION        # pinned upstream release tag (v1.18.18)
├── upstream/               # gitignored; shallow clone managed by scripts
├── overlay/patches/        # the entire diff between opencode and fylun-code
├── plugin/                 # Fylun auth provider — compiled into the binary (patch 08)
├── distribution/           # baked default global config shipped by the installer
└── scripts/                # fetch-upstream.sh, apply-overlay.sh, build.sh
```

## Build

Requires [bun](https://bun.sh) (upstream pins 1.3.x).

```bash
./scripts/build.sh   # fetch pinned upstream → apply overlay → bun build (current platform)
# binary lands at upstream/packages/opencode/dist/<target>/bin/fylun-code
```

**macOS: re-sign after copying.** bun appends the JS bundle to the executable,
which invalidates its code signature. The binary runs from the path it was built
at, but any copy (e.g. installing to `~/.local/bin`) is **SIGKILLed on first run**
(exit 137, no output). Ad-hoc sign it after installing:

```bash
codesign --force --sign - ~/.local/bin/fylun-code-bin
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
| 06-pinned-catalog | Baked models.dev snapshot is authoritative (no disk-cache preference, no runtime fetch/refresh) | The catalog feeds the provider/`/login` list and the model picker. `build.sh` bakes `distribution/models.json` (see "Regenerating models") via `MODELS_DEV_API_JSON`, so the picker is deterministic and works offline. **The TUI half of this patch was removed 2026-08-01** — it dropped the "Recent" section and the "Connect provider" action, both justified only by "Fylun is the only provider", which stopped being true. Don't bake an empty `{}` catalog: that removes Fylun from the connect/`/login` list too. |
| 07-login-flow | `AutoMethod` exported; `/login` goes straight to Fylun browser OAuth (skips the provider list + auth-method menu), falling back to the full dialog if unavailable. `/connect` keeps the full menu. Fylun is added to `PROVIDER_PRIORITY` and carries "(Recommended — sign in)"; OpenCode Zen's description credits anomalyco | Fast Claude-Code-style login, with Fylun leading the picker **on merit rather than by removing the alternatives**. Upstream's per-provider descriptions and the "Other / custom provider" entry were restored 2026-08-01, so bring-your-own keys are reachable from the UI. Two changed lines instead of two deleted blocks — additive hunks conflict far less on upstream merges. |
| 08-bundled-auth | Registers `FylunAuthPlugin` in opencode's `internalPlugins` so the auth provider is **compiled into the binary** (like opencode's own Copilot/xAI/GitLab auth), not installed from npm | No npm package, no `plugin` config entry, no runtime plugin-install. `build.sh` copies `plugin/src/index.ts` → `upstream/.../plugin/fylun-auth.ts` before building. Updates ship with the binary. |
| 09-terminal-title | Terminal *window* title `OpenCode` → `Fylun Code` (`packages/tui/src/app.tsx`) | The OS window/tab title is a separate render path from the TUI banner (patch 05) and the sidebar footer (patch 11). |
| 10-fd-limit-wrapper | Every macOS/Linux build (local `--single` dev builds and CI release builds alike) ships `fylun-code` as a thin shell wrapper (`ulimit -n 65536` then `exec`) around the real binary, renamed `fylun-code-bin`. Applied per-target inside the main build loop, not gated behind `Script.release`. Also copies the repo `LICENSE` (opencode + Fylun, MIT) into `dist/<target>/bin` so the notice ships inside every archive. Windows untouched (no rlimit concept). | macOS defaults new shells to a 256 fd soft limit; opencode's file watching/sync on startup can exceed it (`EMFILE`/"low max file descriptors" on launch). Raising the soft limit up to the already-permitted hard limit needs no sudo and only affects this process. Both `install/route.ts` and the Homebrew formula must install `fylun-code` **and** `fylun-code-bin` for this to work. |
| 11-sidebar-footer-branding | `packages/tui/src/feature-plugins/sidebar/footer.tsx` and `packages/tui/src/routes/session/sidebar.tsx` both render the sidebar footer version line as `<b>Open</b><b>Code</b>`, untouched by patch 09 (which only renamed the terminal *window title*). Both now render `Fylun` `Code`. | Same "OpenCode" leak as patch 09, different render path — the sidebar footer is a separate slot-based component tree, not covered by the app.tsx title-bar patch. |

### Retired patches

- **12-grok-effort — deleted at v1.18.18, because upstream now does it.** The
  patch existed to stop `variants()` returning `{}` for every grok model, which
  denied Fylun's grok models a reasoning-effort control they support. Upstream
  has since narrowed its grok special case to `grok-3-mini` and routes
  everything else through the `model.api.npm` switch, where
  `@ai-sdk/openai-compatible` — Fylun's transport — emits low/medium/high. The
  behaviour the patch added is the default now, so carrying it would be carrying
  a diff that changes nothing. Patch numbers are not renumbered on removal; the
  gap is the record.

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

Two files, one generated from the other:

- **`distribution/models-fylun.json`** — the `fylun` provider only, generated
  from `@fylun/ai`'s `ModelRegistry` (the same registry that serves `/v1/models`).
  Single source of truth for Fylun's own models, pricing and context limits.
- **`distribution/models.json`** — what actually gets baked. Produced by
  `scripts/gen-catalog.mjs`: the file above, plus a curated slice of models.dev.
  `scripts/build.sh` passes it as `MODELS_DEV_API_JSON`.

```bash
node scripts/gen-catalog.mjs                # regenerate distribution/models.json
node scripts/gen-catalog.mjs --fylun-only   # single-provider bake (pre-2026-08 behaviour)
```

The curated list is ~24 providers / ~800 models / ~800KB, against 177 providers
and 3.3MB for all of models.dev — that would be an unusable picker, and the
provider dialog keeps upstream's "Other / custom provider" entry so anything off
the list is still reachable.

**The curation is a usability decision, not a competitive one.** OpenCode Zen and
OpenCode Go are deliberately in the list, and `disabled_providers` is deliberately
absent from `fyluncode.jsonc`: this project ships anomalyco's harness under
another brand and depends on their releases continuing. Fylun leads the picker on
merit — `PROVIDER_PRIORITY` puts it first and it carries "(Recommended — sign
in)" — not by removing the alternative. Dropping a provider from the allowlist to
suppress a competitor would make the usability justification dishonest.

`distribution/fyluncode.jsonc` deliberately carries **no** models block, so a
plain `fylun-code upgrade` (which ships a new binary but never overwrites the
seeded user config) always delivers the current catalog with nothing stale to
refresh.

Regenerate `models-fylun.json` from the same registry that serves /v1/models:

```bash
cd fylun-web && pnpm --filter @fylun/ai build && node -e \
'const {ModelRegistry,getModelThinkingSupport}=require("./packages/ai/dist/providers.js"); /* see git history for the full snippet */'
```

Re-run whenever the catalog changes (or curl /v1/models once prod is live).
Deprecated models (`deprecated: true`) are filtered out, so removing one here
is what drops it from the CLI on the next release.

**And check it, because the filter is a step somebody performs, not a guarantee
the file carries.** Four deprecated models were found in the bake on
2026-08-19 — `claude-opus-4-8`, which the Anthropic API now answers with "no
longer available, use claude-opus-5", plus `claude-opus-4-5`,
`claude-sonnet-4-5` and `gemini-3.6-flash`. The CLI has none of the web app's
deprecation messaging, so picking one is a hard failure with no explanation.

```bash
node scripts/check-catalog-drift.mjs
```

It enforces both rules: nothing baked that the registry lacks, and nothing baked
that the registry marks deprecated. Run it after any catalog change.

### Local dev loop

Point the plugin at a local fylun-web dev server:

```bash
FYLUN_API_URL=http://localhost:3000/api/v1 \
FYLUN_OAUTH_AUTHORIZE_URL=http://localhost:3000/oauth/authorize \
FYLUN_OAUTH_TOKEN_URL=http://localhost:3000/api/oauth/token \
fylun-code
```

### Known residual gaps (accepted for v1)

- ~~No Responses-API reasoning persistence for GPT-5.x (vs Codex CLI)~~ —
  **Built 2026-07-07; production route/auth verified 2026-08-24; authenticated
  two-turn production confirmation remains.** fylun-web has a
  `/api/v1/responses` passthrough (store:false, encrypted-reasoning replay), and
  OpenAI-family entries in `distribution/models-fylun.json` carry
  `"provider": {"npm": "@ai-sdk/openai"}` so opencode routes them there natively —
  zero overlay patches. **Do NOT ship the catalog change in a CLI release until the
  gateway is deployed** (GPT models would 404). Full design + findings:
  `docs/openai-responses-persistence-plan.md`.
- Anthropic reasoning signatures are captured from `reasoning-end` stream
  parts; if a provider emits signatures elsewhere, reasoning_details degrade
  to unsigned text (functional, slightly lower quality on tool-heavy turns).
- Cache-read/write price multipliers are provider-wide constants in
  `translate.ts` — move into ModelRegistry per-model when catalog is rebuilt.

## Done since v0.1.5

- **Installer** — `fylun.ai/code/install` (+ `.ps1`) is live: detects OS/arch, pulls the
  matching archive from `usefylun/fylun-code` releases, installs `fylun-code` + `fylun`
  symlink, seeds `~/.config/fylun-code/fyluncode.jsonc`. Homebrew tap + Scoop bucket too.
- **Core branding** — logo/wordmark (05), terminal window title (09), sidebar footer (11).

## Deferred ideas and maintenance notes — not active work

These are retained for a future Fylun Code decision. They are not part of the
active product queue; see [`fylun-web/docs/BOARD.md`](../../fylun-web/docs/BOARD.md).

- Residual `opencode` strings in help/about text — the load-bearing branding is done
  (05/09/11); a `grep -ri opencode packages/tui/src` finds the stragglers. Cosmetic;
  decide how far to take it.
- VS Code extension rebrand (upstream ships one in the same repo). Gated by Marketplace
  trader/DSA setup, same as the Chrome Web Store — not a code problem.
- CI: on `UPSTREAM_VERSION` bump (or a weekly cron), run `apply-overlay.sh`'s dry-run
  against the latest opencode tag + a both-tools-coexist smoke test, to catch patch drift
  before it accumulates (this release proved the manual version of that check works).
- Two Claude-Code-parity features, planned but deferred past v1: push-to-talk
  dictation (voice-to-text) and remote connect (drive a session from a phone). See
  `docs/deferred-features.md` for the design thinking on both.
