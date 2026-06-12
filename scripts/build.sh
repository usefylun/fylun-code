#!/usr/bin/env bash
# Build the fylun-code binary for the current platform.
# Requires bun (upstream pins bun 1.3.x): https://bun.sh
set -euo pipefail
cd "$(dirname "$0")/.."

command -v bun >/dev/null 2>&1 || { echo "bun is required: curl -fsSL https://bun.sh/install | bash" >&2; exit 1; }

./scripts/fetch-upstream.sh
./scripts/apply-overlay.sh

(cd upstream && bun install)

# Bake a FYLUN-ONLY models.dev catalog. Patch 06 makes the baked snapshot
# authoritative at runtime (no models.dev fetch). We bake just the Fylun
# provider — not an empty catalog — because the provider list (ctrl+a /
# /login) is built from the catalog: an empty catalog removes anomalyco's
# providers but ALSO removes Fylun from the connect/login dialog. Shipping
# the single Fylun entry keeps the dialog showing exactly one provider.
# distribution/models-fylun.json is generated from @fylun/ai's ModelRegistry
# (see README "Regenerating models").
(cd upstream/packages/opencode && MODELS_DEV_API_JSON="../../../distribution/models-fylun.json" bun run script/build.ts --single)

echo
echo "binary:"
ls upstream/packages/opencode/dist/*/bin/fylun-code
