#!/usr/bin/env bash
# Update the Homebrew tap and Scoop bucket for a Fylun Code release.
#
# Called by release.yml after the platform binaries are uploaded to the GitHub
# Release. Renders Formula/fylun-code.rb (usefylun/homebrew-tap) and
# bucket/fylun-code.json (usefylun/scoop-bucket) with the release's real
# sha256 hashes, then commits + pushes both.
#
# Required env:
#   TAG        release tag, e.g. v0.1.4
#   GH_TOKEN   token for `gh release download` (workflow github.token is fine)
#   TAP_TOKEN  PAT with contents:write on usefylun/homebrew-tap AND
#              usefylun/scoop-bucket. If unset/empty this is a no-op (so the
#              release still succeeds before the secret is added).
set -euo pipefail

TAG="${TAG:?TAG required (e.g. v0.1.4)}"
VERSION="${TAG#v}"
REPO="usefylun/fylun-code"

if [ -z "${TAP_TOKEN:-}" ]; then
  echo "TAP_TOKEN not set — skipping Homebrew/Scoop publish for ${TAG}."
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"

# Pull the assets brew + scoop reference and hash them from the real artifacts.
assets="fylun-code-darwin-arm64.zip fylun-code-darwin-x64.zip \
        fylun-code-linux-arm64.tar.gz fylun-code-linux-x64.tar.gz \
        fylun-code-windows-x64.zip fylun-code-windows-arm64.zip"
for a in $assets; do
  gh release download "$TAG" --repo "$REPO" --pattern "$a" --dir .
done
sha() { sha256sum "$1" | cut -d' ' -f1; }
DA="$(sha fylun-code-darwin-arm64.zip)"
DX="$(sha fylun-code-darwin-x64.zip)"
LA="$(sha fylun-code-linux-arm64.tar.gz)"
LX="$(sha fylun-code-linux-x64.tar.gz)"
WX="$(sha fylun-code-windows-x64.zip)"
WA="$(sha fylun-code-windows-arm64.zip)"

base="https://github.com/${REPO}/releases/download/${TAG}"
desc="Terminal AI coding agent connected to your Fylun account (built on OpenCode, MIT)"

# ---- Homebrew formula -----------------------------------------------------
git clone --quiet "https://x-access-token:${TAP_TOKEN}@github.com/usefylun/homebrew-tap.git" tap
mkdir -p tap/Formula
cat > tap/Formula/fylun-code.rb <<EOF
class FylunCode < Formula
  desc "${desc}"
  homepage "https://fylun.ai/code"
  version "${VERSION}"
  license "MIT"

  on_macos do
    on_arm do
      url "${base}/fylun-code-darwin-arm64.zip"
      sha256 "${DA}"
    end
    on_intel do
      url "${base}/fylun-code-darwin-x64.zip"
      sha256 "${DX}"
    end
  end

  on_linux do
    on_arm do
      url "${base}/fylun-code-linux-arm64.tar.gz"
      sha256 "${LA}"
    end
    on_intel do
      url "${base}/fylun-code-linux-x64.tar.gz"
      sha256 "${LX}"
    end
  end

  def install
    bin.install "fylun-code"
    bin.install "fylun-code-bin"
    bin.install_symlink bin/"fylun-code" => "fylun"
  end

  test do
    system bin/"fylun-code", "--version"
  end
end
EOF

# ---- Scoop manifest -------------------------------------------------------
git clone --quiet "https://x-access-token:${TAP_TOKEN}@github.com/usefylun/scoop-bucket.git" bucket
mkdir -p bucket/bucket
cat > bucket/bucket/fylun-code.json <<EOF
{
  "version": "${VERSION}",
  "description": "${desc}",
  "homepage": "https://fylun.ai/code",
  "license": "MIT",
  "architecture": {
    "64bit": {
      "url": "${base}/fylun-code-windows-x64.zip",
      "hash": "${WX}"
    },
    "arm64": {
      "url": "${base}/fylun-code-windows-arm64.zip",
      "hash": "${WA}"
    }
  },
  "bin": [
    ["fylun-code.exe", "fylun-code"],
    ["fylun-code.exe", "fylun"]
  ],
  "checkver": { "github": "https://github.com/${REPO}" },
  "autoupdate": {
    "architecture": {
      "64bit": { "url": "https://github.com/${REPO}/releases/download/v\$version/fylun-code-windows-x64.zip" },
      "arm64": { "url": "https://github.com/${REPO}/releases/download/v\$version/fylun-code-windows-arm64.zip" }
    }
  }
}
EOF

# ---- commit + push both ---------------------------------------------------
publish() { # <dir> <file>
  ( cd "$1"
    git config user.name "fylun-bot"
    git config user.email "bot@fylun.ai"
    git add "$2"
    if git diff --cached --quiet; then
      echo "$1: no change for ${VERSION}"
    else
      git commit --quiet -m "fylun-code ${VERSION}"
      git push --quiet
      echo "$1: published ${VERSION}"
    fi )
}
publish tap Formula/fylun-code.rb
publish bucket bucket/fylun-code.json
echo "Homebrew tap + Scoop bucket updated to ${VERSION}."
