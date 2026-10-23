#!/usr/bin/env node
/**
 * Fail if the baked catalog disagrees with @fylun/ai's registry.
 *
 * Three rules, all learned the hard way:
 *
 *   1. **Nothing may be baked that the registry lacks.** The bake is a curated
 *      SUBSET — previous-generation and retired entries are dropped — so it is
 *      not a mirror, and a straight diff would be noise. What it must never do
 *      is offer a model Fylun cannot serve.
 *   2. **Nothing deprecated may be baked.** Four were, found 2026-08-19:
 *      claude-opus-4-8 (which the Anthropic API now answers with "no longer
 *      available"), claude-opus-4-5, claude-sonnet-4-5 and gemini-3.6-flash.
 *      The CLI has none of the web app's deprecation messaging, so a user who
 *      picks one gets a hard failure with no explanation.
 *
 *   3. **The seeded default model must be baked.** See below.
 *
 * Nothing checked this before; the board carried "nothing checks this" as a
 * known gap for weeks. Run it after any catalog change:
 *
 *   node scripts/check-catalog-drift.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROVIDERS_TS = path.resolve(
  process.env.FYLUN_WEB ?? path.resolve(ROOT, "../../fylun-web"),
  "packages/ai/src/providers.ts"
);

// Rule 3, checked first because it needs no registry: the seeded config must
// name models the binary actually carries. The seed shipped
// `fylun/deepseek-v4-flash` for weeks after the bake moved to `deepseek-flash`,
// and opencode's answer to an unknown configured model is to fall through to
// the first listed provider — every new install started on OpenCode Zen's free
// Big Pickle instead of Fylun. The recovery data patch 16 reads is checked
// alongside it: `default_model` must be the seed's model, and every alias must
// point at a baked model.
const bakedFylun = JSON.parse(fs.readFileSync(path.join(ROOT, "distribution/models.json"), "utf8")).fylun ?? {};
const seedText = fs.readFileSync(path.join(ROOT, "distribution/fyluncode.jsonc"), "utf8");
const seedProblems = [];
for (const key of ["model", "small_model"]) {
  const value = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`).exec(seedText)?.[1];
  if (!value) continue;
  const [provider, ...rest] = value.split("/");
  if (provider === "fylun" && !bakedFylun.models?.[rest.join("/")]) {
    seedProblems.push(`fyluncode.jsonc "${key}": ${value} is not in the baked catalog`);
  }
  if (key === "model" && `fylun/${bakedFylun.default_model}` !== value) {
    seedProblems.push(`baked default_model ${bakedFylun.default_model} does not match the seed's ${value}`);
  }
}
for (const [from, to] of Object.entries(bakedFylun.aliases ?? {})) {
  if (!bakedFylun.models?.[to]) seedProblems.push(`alias ${from} -> ${to}: target is not baked`);
  if (bakedFylun.models?.[from]) seedProblems.push(`alias ${from}: is itself a baked model`);
}
if (seedProblems.length) {
  console.error(`check-catalog-drift: seed/catalog mismatch:\n  ${seedProblems.join("\n  ")}`);
  console.error("\nFix distribution/fyluncode.jsonc or regenerate — see README, 'Regenerating models'.");
  process.exit(1);
}

if (!fs.existsSync(PROVIDERS_TS)) {
  console.log(`check-catalog-drift: seed ok; no registry at ${PROVIDERS_TS}, skipping the registry rules (set FYLUN_WEB).`);
  process.exit(0);
}

const src = fs.readFileSync(PROVIDERS_TS, "utf8");

const idByKey = Object.fromEntries(
  [...src.matchAll(/^ {2}([A-Z0-9_]+):\s*"([^"]+)",/gm)].map((m) => [m[1], m[2]])
);

const known = new Set();
const deprecated = new Set();
for (const entry of src.matchAll(/\[ModelIds\.([A-Z0-9_]+)\]:\s*\{([\s\S]*?)\n {2}\},/g)) {
  const id = idByKey[entry[1]];
  if (!id) continue;
  known.add(id);
  if (/deprecated:\s*true/.test(entry[2])) deprecated.add(id);
}

const baked = JSON.parse(
  fs.readFileSync(path.join(ROOT, "distribution/models-fylun.json"), "utf8")
);
const bakedIds = Object.keys(baked.fylun?.models ?? {});

const unknown = bakedIds.filter((id) => !known.has(id));
const stale = bakedIds.filter((id) => deprecated.has(id));

if (unknown.length === 0 && stale.length === 0) {
  console.log(
    `check-catalog-drift: ok — ${bakedIds.length} baked, all present in the registry and none deprecated.`
  );
  process.exit(0);
}

if (unknown.length > 0) {
  console.error(
    `check-catalog-drift: baked but NOT in the registry (Fylun cannot serve these):\n  ${unknown.join("\n  ")}`
  );
}
if (stale.length > 0) {
  console.error(
    `check-catalog-drift: baked but DEPRECATED (the CLI has no deprecation messaging):\n  ${stale.join("\n  ")}`
  );
}
console.error("\nRegenerate distribution/models-fylun.json — see README, 'Regenerating models'.");
process.exit(1);
