#!/usr/bin/env bash
# Reset upstream/ to the pinned tag and apply the Fylun Code overlay patches.
# Fails loudly (before changing anything) if upstream drifted under a patch —
# that is the signal to re-derive the patch against the new version.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d upstream/.git ] || { echo "run scripts/fetch-upstream.sh first" >&2; exit 1; }

git -C upstream checkout -f -- .

for p in overlay/patches/*.patch; do
  if ! git -C upstream apply --check "../$p"; then
    echo "FAILED (dry run): $p — upstream changed, re-derive this patch" >&2
    exit 1
  fi
done

for p in overlay/patches/*.patch; do
  git -C upstream apply "../$p"
  echo "applied $(basename "$p")"
done
