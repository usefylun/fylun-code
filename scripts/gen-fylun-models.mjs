#!/usr/bin/env node
//
// Generates `distribution/models-fylun.json` — the `fylun` provider slice of
// the baked catalog — from @fylun/ai's ModelRegistry, the same registry that
// serves `GET /api/v1/models`.
//
//   cd fylun-web && pnpm --filter @fylun/ai build
//   cd fylun-code && node scripts/gen-fylun-models.mjs
//   node scripts/gen-catalog.mjs          # folds the result into models.json
//   node scripts/check-catalog-drift.mjs  # and prove it
//
// WHY THIS FILE EXISTS. The README claimed models-fylun.json "stays generated
// from @fylun/ai's ModelRegistry" for two months while no generator existed —
// it was hand-maintained, and it drifted exactly as far as you would expect.
// Found 2026-08-30: two deprecated models still baked (llama-4-scout, dead
// upstream since Groq retired every Llama model; glm-5.2, superseded), and
// eleven models carrying stale prices, including the CLI's own default
// (deepseek-v4-flash, baked at $0.14/$0.28 against a real $0.44/$1.32 — a 3x
// understatement of the cost of every default-model session).
//
// WHAT IS DERIVED vs WHAT IS CURATED. The split is the whole point:
//
//   Derived from the registry (never edit in the JSON — edit the registry):
//     name, cost.input, cost.output, cost.cache_read, cost.cache_write,
//     limit.context, limit.output, reasoning, temperature, interleaved,
//     tool_call.
//
//   Curated here (facts the registry does not carry):
//     WHICH models are baked, release_date, attachment, provider.npm.
//
// The bake is a curated SUBSET, not a mirror — `check-catalog-drift.mjs` says
// so, and adding every registry model would put previous-generation and
// niche entries in a picker that has to stay scannable. So the CURATED list
// below is the editorial decision; everything else follows from the registry.
//
// The derivations mirror `apps/main/src/app/api/v1/models/route.ts` field for
// field, so the CLI's baked catalog and the live /v1/models payload cannot
// describe the same model differently.
//
import fs from "node:fs";
import path from "node:path";
import module from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// @fylun/ai is compiled by plain `tsc`, which copies relative import
// specifiers through verbatim — `from "./providers"`, no extension. Node's ESM
// resolver requires the extension, and `dist/providers` is additionally a real
// directory, so importing dist/usage.js dies with ERR_UNSUPPORTED_DIR_IMPORT.
// The monorepo never hits this because its own consumers resolve @fylun/ai to
// src/*.ts through the package's `exports` map and let a bundler resolve them.
// A resolve hook that retries with `.js` is the smallest thing that lets a
// plain-node script outside the monorepo import the built package.
if (typeof module.registerHooks !== "function") {
  console.error(`gen-fylun-models: needs Node >= 22.15 for module.registerHooks (running ${process.version}).`);
  process.exit(1);
}
module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".") && path.extname(specifier) === "") {
        return nextResolve(`${specifier}.js`, context);
      }
      throw err;
    }
  },
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.resolve(ROOT, "../../fylun-web");
const AI_SRC = path.join(WEB, "packages/ai/src/providers.ts");
const AI_DIST = path.join(WEB, "packages/ai/dist/providers.js");
const USAGE_DIST = path.join(WEB, "packages/ai/dist/usage.js");
const SCHEMA_TS = path.join(WEB, "apps/main/src/lib/openai-compat/schema.ts");
const OUT = path.join(ROOT, "distribution/models-fylun.json");

// ---------------------------------------------------------------------------
// The curated subset.
//
// Order is the picker's order — keep the strongest/most-wanted first within a
// family. `release_date` is not in the registry; it is
// NOTE: the per-entry `attachment` below is no longer read — it is derived
// from the registry's verified supportsImageInput. Left in place only so the
// table's shape is unchanged; delete on the next pass through this list.
//
// catalog metadata models.dev's schema wants and are maintained here by hand.
// "2026-01-01" is this file's long-standing placeholder for "release date not
// established", inherited from the hand-maintained version — it is a filler,
// not a claim, and should be replaced whenever a first-party date is known.
//
// `npm` overrides opencode's transport for a model. OpenAI-family entries go
// to "@ai-sdk/openai" so opencode uses the Responses API natively against
// fylun-web's /api/v1/responses passthrough (reasoning persistence); every
// other model rides the provider-level "@ai-sdk/openai-compatible".
// ---------------------------------------------------------------------------
const CURATED = [
  { id: "gpt-6-sol", attachment: true, npm: "@ai-sdk/openai" },
  { id: "gpt-6-astra", attachment: true, npm: "@ai-sdk/openai" },
  { id: "gpt-6-luna", attachment: true, npm: "@ai-sdk/openai" },
  { id: "gpt-5.5-pro", release_date: "2026-01-01", attachment: true, npm: "@ai-sdk/openai" },
  { id: "gpt-5-mini-2025-08-07", release_date: "2026-01-01", attachment: true, npm: "@ai-sdk/openai" },
  { id: "o3-pro", release_date: "2026-01-01", attachment: true, npm: "@ai-sdk/openai" },

  { id: "claude-fable-5-1", attachment: true },
  { id: "claude-opus-5-5", attachment: true },
  { id: "claude-sonnet-5", release_date: "2026-01-01", attachment: true },
  { id: "claude-haiku-4-5-20251001", release_date: "2026-01-01", attachment: true },

  { id: "gemini-3.8-flash", release_date: "2026-09-10", attachment: true },
  { id: "gemini-3.5-flash-lite", release_date: "2026-07-21", attachment: true },
  { id: "gemini-3.1-flash-lite", release_date: "2026-01-01", attachment: true },
  { id: "gemini-3.1-pro-preview", release_date: "2026-01-01", attachment: true },
  { id: "gemini-3-flash-preview", release_date: "2026-01-01", attachment: true },
  { id: "gemini-2.5-pro", release_date: "2026-01-01", attachment: true },

  { id: "grok-4.6", release_date: "2026-08-12", attachment: true },
  { id: "grok-4.3", release_date: "2026-01-01", attachment: true },
  { id: "grok-4.20-non-reasoning", release_date: "2026-01-01", attachment: true },

  { id: "deepseek-flash", release_date: "2026-09-08", attachment: true },

  { id: "mistral-large-latest", release_date: "2026-01-01", attachment: true },
  { id: "mistral-medium-latest", release_date: "2026-01-01", attachment: true },
  { id: "magistral-medium-2509", release_date: "2026-01-01", attachment: true },

  // meta-llama/llama-4-scout-17b-16e-instruct was here until 2026-08-30.
  // Groq shut it down on 2026-07-17 and retired every other Llama with it, so
  // there is no same-provider successor to bake in its place. Dropped, not
  // replaced.

  // muse-spark-1.3 added 2026-09-28: Meta Model API's paid tier only — the
  // -contributor tier ($0.10/$0.20) is deliberately NOT baked because it lets
  // Meta train on subscriber prompts. Effort values derive from the registry
  // (low..max); "minimal" is below Fylun's floor and "none" is rejected
  // model-side.
  { id: "muse-spark-1.3", release_date: "2026-09-28", attachment: true },

  { id: "kimi-k3", release_date: "2026-07-16", attachment: true },
  { id: "kimi-k2.7-code", release_date: "2026-01-01", attachment: true },
  // kimi-k2.5 dropped 2026-08-31: Moonshot retired it and the whole
  // moonshot-v1 series at 16:00 that day, and calls now 404. Kimi K3 above is
  // the migration target Moonshot names, and it was already baked.
  // https://platform.kimi.ai/docs/platform-changelog

  { id: "qwen3.8-max", release_date: "2026-08-03", attachment: true },
  { id: "qwen3.7-max", release_date: "2026-01-01", attachment: true },
  // qwen3-max, glm-4.6 and glm-5.1 dropped 2026-09-28: all three deprecated
  // in the registry as superseded (3.7-max cheaper + provider-delisted 3-max;
  // 5.3-Flash dominates 4.6 on every axis; 5.1 identical price to 5.3 but
  // strictly worse). gen runs would fail the drift check if they returned.
  { id: "qwen3-coder-480b-a35b-instruct", release_date: "2026-01-01", attachment: true },

  // glm-5.3 takes the slot glm-5.2 held: same $1.4/$4.4, same 1M window, one
  // generation newer, and the registry names it as 5.2's `replacement`.
  // GLM-5.3 Flash is also explicitly curated for the low-cost vision/tool path.
  { id: "glm-5.3-flash", attachment: true },
  { id: "glm-5.3", release_date: "2026-01-01", attachment: true },

  { id: "sonar", release_date: "2026-01-01", attachment: true },
  { id: "sonar-pro", release_date: "2026-01-01", attachment: true },
  { id: "sonar-reasoning-pro", release_date: "2026-01-01", attachment: true },
  { id: "sonar-deep-research", release_date: "2026-01-01", attachment: true },
];

// ---------------------------------------------------------------------------
// Load the registry. dist/, not src/ — the generator is plain node and the
// registry is TypeScript. A dist older than src would silently bake yesterday's
// prices, which is the exact failure this script exists to end, so refuse.
// ---------------------------------------------------------------------------
for (const f of [AI_SRC, AI_DIST, USAGE_DIST, SCHEMA_TS]) {
  if (!fs.existsSync(f)) {
    console.error(`gen-fylun-models: missing ${f}`);
    console.error("Expected fylun-web checked out as a sibling, built with:");
    console.error("  cd ../../fylun-web && pnpm --filter @fylun/ai build");
    process.exit(1);
  }
}
if (fs.statSync(AI_SRC).mtimeMs > fs.statSync(AI_DIST).mtimeMs) {
  console.error("gen-fylun-models: packages/ai/dist is older than src — it would bake stale prices.");
  console.error("  cd ../../fylun-web && pnpm --filter @fylun/ai build");
  process.exit(1);
}

const { ModelRegistry, getModelThinkingSupport } = await import(pathToFileURL(AI_DIST).href);
const { calculateCost } = await import(pathToFileURL(USAGE_DIST).href);

// limit.output is not a per-model figure: the OpenAI-compatible gateway caps
// max_tokens/max_completion_tokens at one constant for every model, and a
// catalog that advertises more than the gateway accepts hands opencode a
// number that produces a 400. Read it rather than copy it.
const maxOutMatch = /MAX_OUTPUT_TOKENS\s*=\s*([\d_]+)/.exec(fs.readFileSync(SCHEMA_TS, "utf8"));
if (!maxOutMatch) {
  console.error(`gen-fylun-models: could not read MAX_OUTPUT_TOKENS from ${SCHEMA_TS}`);
  process.exit(1);
}
const MAX_OUTPUT_TOKENS = Number(maxOutMatch[1].replace(/_/g, ""));

// ---------------------------------------------------------------------------
// Cache pricing, resolved by ASKING THE BILLING CODE rather than restating it.
//
// `calculateCost` resolves a cache-read rate in a specific order — a per-model
// `cachedInputPricePerMillion` when the provider publishes one (the GLM family,
// whose ratios genuinely differ per model), otherwise a provider-wide
// CACHE_READ_MULTIPLIER, otherwise 1.0 meaning "no discount is known, charge
// full input". Neither of those tables is exported, and re-deriving the ratio
// here would just be a fourth copy to drift. So price a synthetic 1M-token
// cache read through the real function and read the answer back: whatever the
// catalog advertises is then, by construction, what a user is actually billed.
//
// promptTokens:0 is deliberate. Providers disagree about whether cached tokens
// are a subset of the prompt (OpenAI-style) or a separate bucket (Anthropic),
// and calculateCost handles both; a zero prompt makes the uncached remainder
// zero under either reading, leaving only the cache term. It also keeps the
// request under every long-context threshold, so this is the base tier.
//
// A provider with no published discount lands on the 1.0 fallback, so its
// cache_read equals its input price. That is not a placeholder — it is exactly
// what Fylun charges for a cache hit on that provider today, and understating
// it here would show CLI users a discount they do not receive.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// `reasoning_options` — the field that actually turns the TUI's `/effort`
// control on.
//
// opencode v1.18.18 builds a model's variants as
// `reasoningVariants(model, base) ?? variants(base)`
// (packages/opencode/src/provider/provider.ts). The first arm reads
// `reasoning_options` straight off the catalog entry and translates it per
// transport; the second is a fallback of id-substring heuristics for catalogs
// that don't declare it. This file declared nothing, so every Fylun model went
// through the heuristics — and those heuristics `return {}` for any id
// containing "glm", "kimi" or "qwen", and hand DeepSeek V4 a low/medium/high/max
// row when the registry only supports high/xhigh (picking "low" then normalises
// to the STRONGEST level at the gateway, so asking for less thinking bought the
// most). Declaring the registry's own ThinkingSupport removes the guessing.
//
// ThinkingSupport maps onto the models.dev ReasoningOption union directly
// (see `packages/core/src/models-dev.ts` in the pinned upstream):
//   {kind:"effort", values}   -> {type:"effort", values}
//   {kind:"toggle"}           -> {type:"toggle"}
//   {kind:"budget", min, max} -> {type:"budget_tokens", min, max}
//   {kind:"none"}             -> omitted
//
// Only the effort arm currently produces a control on Fylun's transport:
// TOGGLE MODELS ARE DECLARED AS TWO-VALUED EFFORT, DELIBERATELY.
//
// Upstream's `reasoningToggle` handles only `@ai-sdk/alibaba` and
// `@ai-sdk/cohere` and returns `{}` for everything else, including
// `@ai-sdk/openai-compatible` (transform.ts:1707-1715). An empty variant set
// falls back to the id heuristics in `variants()`, which blocklist `glm`,
// `kimi` and `qwen` outright (transform.ts:781-793). So declaring `toggle`
// honestly is WORSE than declaring nothing: it routes into a blocklist and the
// model ends up with no thinking control at all in the CLI.
//
// `reasoningVariants` takes the `effort` arm before the toggle arm, and effort
// IS implemented for openai-compatible. Declaring the two states a toggle has
// as `values: [null, "high"]` gets both variants out of stock opencode with no
// patch: upstream maps `null` to its "none" variant, and Fylun's gateway maps
// "none" to thinking-off (`translate.ts:267,275` — `explicitlyOff` is checked
// BEFORE effort normalisation) and any other value to on, which for a
// registry-declared toggle model is `{ kind: "on" }`. Two states in, two states
// out. The registry keeps saying `toggle`, which is the truth; only the wire
// vocabulary changes, to the one upstream can actually act on.
//
// A previous version of this comment claimed nulls were never emitted because
// the gateway "would normalise UP to the strongest level rather than off". That
// was wrong — see translate.ts:275 — and it is why this bug survived the
// 2026-08-30 pass. Upstream issue: anomalyco/opencode#42793 (open).
function reasoningOptions(thinking) {
  switch (thinking.kind) {
    case "effort":
      return [{ type: "effort", values: [...thinking.values] }];
    case "toggle":
      // See the note above: NOT `[{ type: "toggle" }]`, which upstream drops.
      return [{ type: "effort", values: [null, "high"] }];
    case "budget":
      return [{ type: "budget_tokens", min: thinking.min, max: thinking.max }];
    default:
      return undefined;
  }
}

const PROBE = 1_000_000;
function cacheRates(id) {
  const zero = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const read = calculateCost({ ...zero, cachedInputTokens: PROBE }, id).inputCost;
  const write = calculateCost({ ...zero, cacheWriteTokens: PROBE }, id).inputCost;
  return { read, write };
}

// ---------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------
const models = {};
const problems = [];

for (const entry of CURATED) {
  const info = ModelRegistry[entry.id];
  if (!info) {
    problems.push(`${entry.id}: curated but absent from ModelRegistry`);
    continue;
  }
  // Both of check-catalog-drift's rules, enforced at the source rather than
  // caught downstream. A deprecated model must never reach the bake: the CLI
  // carries none of the web app's deprecation messaging, so picking one is a
  // hard failure with no explanation.
  if (info.deprecated) {
    problems.push(
      `${entry.id}: deprecated (${info.deprecationReason ?? "no reason given"})` +
        (info.replacement ? ` — replacement is ${info.replacement}` : "") +
        " — remove it from CURATED (and consider its replacement)"
    );
    continue;
  }

  const thinking = getModelThinkingSupport(entry.id);
  const { read, write } = cacheRates(entry.id);

  const cost = { input: info.inputPricePerMillion, output: info.outputPricePerMillion };
  if (read > 0) cost.cache_read = read;
  if (write > 0) cost.cache_write = write;

  const model = {
    id: info.id,
    name: info.name,
    release_date: entry.release_date,
    // Both derived from the registry's supportsImageInput, which is set only
    // where a first-party source confirms vision and carries the citation.
    //
    // This file used to hardcode `attachment: true` on every model and emit no
    // `modalities` at all. opencode builds capabilities.input from
    // `modalities.input` (fromModelsDevModel, provider.ts ~1238), so every
    // modality read false and ProviderTransform replaced any image with
    // "Cannot read image (this model does not support image input)" —
    // attachments were broken for all 38. The blanket `true` was independently
    // wrong for the text-only models, so it could not simply be trusted into a
    // modalities list.
    //
    // Only text and image are emitted: the gateway's contentPartsSchema accepts
    // `text` and `image_url` and nothing else, so declaring audio, video or pdf
    // would advertise inputs it rejects.
    attachment: info.supportsImageInput === true,
    // models.dev semantics: does this model expose reasoning at all. Same
    // expression /v1/models uses, so the two payloads agree by construction.
    // A model that reasons but exposes no control is `thinking: {kind:"none"}`
    // in the registry and therefore false here — if that is wrong for a model,
    // the fix is a `thinking` entry in the registry, not a hand-edit here.
    reasoning: thinking.kind !== "none",
    ...(reasoningOptions(thinking) ? { reasoning_options: reasoningOptions(thinking) } : {}),
    // `omitTemperature` means the provider rejects the parameter outright, so
    // advertising it would offer a knob every request throws away.
    temperature: !info.omitTemperature,
    tool_call: true,
    modalities: {
      input: info.supportsImageInput === true ? ["text", "image"] : ["text"],
      output: ["text"],
    },
    ...(info.provider === "anthropic" && thinking.kind !== "none"
      ? { interleaved: { field: "reasoning_details" } }
      : {}),
    cost,
    limit: { context: info.contextWindow, output: MAX_OUTPUT_TOKENS },
    ...(entry.npm ? { provider: { npm: entry.npm } } : {}),
  };

  models[entry.id] = model;
}

if (problems.length) {
  console.error("gen-fylun-models: refusing to write.\n  " + problems.join("\n  "));
  process.exit(1);
}

const catalog = {
  fylun: {
    id: "fylun",
    name: "Fylun",
    npm: "@ai-sdk/openai-compatible",
    api: "https://fylun.ai/api/v1",
    env: [],
    models,
  },
};

const json = JSON.stringify(catalog, null, 2) + "\n";
fs.writeFileSync(OUT, json);

const reasoning = Object.values(models).filter((m) => m.reasoning).length;
console.log(
  `${path.relative(ROOT, OUT)}: ${Object.keys(models).length} models ` +
    `(${reasoning} reasoning), ${(json.length / 1024).toFixed(0)}KB`
);
console.log("Next: node scripts/gen-catalog.mjs && node scripts/check-catalog-drift.mjs");
