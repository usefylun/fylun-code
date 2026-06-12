#!/usr/bin/env bash
# Fetch the pinned upstream opencode release into upstream/ (gitignored).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(cat UPSTREAM_VERSION)"
REPO="https://github.com/anomalyco/opencode"

if [ -d upstream/.git ]; then
  git -C upstream fetch --depth 1 origin "refs/tags/${VERSION}:refs/tags/${VERSION}" || true
  git -C upstream checkout -f "${VERSION}"
  git -C upstream clean -fd
else
  git clone --depth 1 --branch "${VERSION}" "${REPO}" upstream
fi

echo "upstream at ${VERSION}"
