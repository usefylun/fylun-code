#!/usr/bin/env node
/**
 * Fail if the baked catalog disagrees with @fylun/ai's registry.
 *
 * Two rules, both learned the hard way:
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
  ROOT,
  "../../fylun-web/packages/ai/src/providers.ts"
);

if (!fs.existsSync(PROVIDERS_TS)) {
  console.log(`check-catalog-drift: no registry at ${PROVIDERS_TS}, skipping.`);
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
