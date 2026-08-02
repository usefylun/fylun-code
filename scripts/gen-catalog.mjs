#!/usr/bin/env node
//
// Generates the models.dev catalog baked into the fylun-code binary.
//
// Why a curated list rather than all of models.dev: the catalog drives the
// provider picker, and models.dev carries 177 providers / ~5,900 models — an
// unusable dialog and 3.3MB in the binary. The list below is ~24 providers /
// ~800 models / ~460KB.
//
// The curation is a USABILITY decision, not a competitive one. OpenCode Zen and
// OpenCode Go are deliberately included: fylun-code ships anomalyco's harness
// under another brand and depends on their releases continuing, and anyone who
// scrolls past Fylun to pick Zen was never going to be a Fylun subscriber.
// Removing a provider from this list to suppress a competitor would make the
// usability justification dishonest — don't.
//
// Nothing here is a ceiling either: the provider dialog keeps upstream's
// "Other / custom provider" entry, so a provider that isn't listed is still
// reachable from the UI (and from fyluncode.jsonc).
//
//   node scripts/gen-catalog.mjs                # -> distribution/models.json
//   node scripts/gen-catalog.mjs --fylun-only   # -> the old single-provider bake
//
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FYLUN_SRC = path.join(ROOT, "distribution/models-fylun.json");
const OUT = path.join(ROOT, "distribution/models.json");
const UPSTREAM = "https://models.dev/api.json";

// Ordered roughly by how likely someone is to want it. `fylun` is not here —
// it comes from models-fylun.json, which stays generated from @fylun/ai's
// ModelRegistry (see README "Regenerating models") so Fylun's own pricing and
// context limits keep a single source of truth.
const ALLOWLIST = [
  // The harness this is built on. Credited, not hidden.
  "opencode",
  "opencode-go",
  // Frontier labs, direct.
  "anthropic",
  "openai",
  "google",
  "xai",
  "deepseek",
  // Chinese labs + their coding plans, which are a large share of coding use.
  "zai",
  "zai-coding-plan",
  "zhipuai",
  "zhipuai-coding-plan",
  "moonshotai",
  "kimi-for-coding",
  "alibaba",
  "minimax",
  // Fast inference hosts.
  "groq",
  "cerebras",
  "togetherai",
  "fireworks-ai",
  // Aggregators and the rest.
  "openrouter",
  "mistral",
  "github-copilot",
  "lmstudio",
];

const fylunOnly = process.argv.includes("--fylun-only");

const fylun = JSON.parse(await fs.readFile(FYLUN_SRC, "utf8"));
if (!fylun.fylun) {
  console.error(`${FYLUN_SRC} has no "fylun" provider — regenerate it first (see README).`);
  process.exit(1);
}

let catalog = { ...fylun };

if (!fylunOnly) {
  const res = await fetch(UPSTREAM, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    console.error(`models.dev returned ${res.status} — refusing to write a partial catalog.`);
    process.exit(1);
  }
  const upstream = await res.json();

  // A silent drop here would quietly remove a provider from the picker on the
  // next release, so name anything that has been renamed or withdrawn upstream.
  const missing = ALLOWLIST.filter((id) => !upstream[id]);
  if (missing.length) {
    console.warn(`WARNING: not in models.dev, skipped: ${missing.join(", ")}`);
  }

  // Fylun first: the picker's ordering follows insertion for equal priority.
  catalog = { fylun: fylun.fylun };
  for (const id of ALLOWLIST) if (upstream[id]) catalog[id] = upstream[id];
}

const json = JSON.stringify(catalog, null, 2) + "\n";
await fs.writeFile(OUT, json);

const providers = Object.keys(catalog);
const models = Object.values(catalog).reduce((n, p) => n + Object.keys(p.models ?? {}).length, 0);
console.log(
  `${path.relative(ROOT, OUT)}: ${providers.length} providers, ${models} models, ${(json.length / 1024).toFixed(0)}KB`,
);
console.log(providers.join(", "));
