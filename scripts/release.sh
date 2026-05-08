#!/usr/bin/env bash
#
# Release script for reader-sdks (JS + Python)
#
# Usage:
#   ./scripts/release.sh 0.3.0
#   ./scripts/release.sh 0.3.0 --dry-run
#
# Both SDKs are versioned together. This script:
#   1. Validates: clean tree, on main, tag doesn't exist
#   2. Bumps both package versions
#   3. Runs all checks (JS typecheck+test+build, Python tests)
#   4. If checks fail: reverts version bumps, exits
#   5. If checks pass: commits, tags, pushes, creates release
#
# Nothing is pushed until all checks pass. Dry run never modifies files.
#

set -euo pipefail

VERSION="${1:-}"
DRY_RUN="${2:-}"

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release.sh <version> [--dry-run]"
  echo "Example: ./scripts/release.sh 0.3.0"
  exit 1
fi

if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Error: Version must be in X.Y.Z format, got: $VERSION"
  exit 1
fi

TAG="v$VERSION"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Load nvm if available
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use v22 > /dev/null 2>&1 || true

echo "=== reader-sdks release $TAG ==="
echo ""

# ─── Preflight ────────────────────────────────────────────────────────

if ! command -v gh &>/dev/null; then
  echo "Error: GitHub CLI (gh) is required. Install: brew install gh"
  exit 1
fi

BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  echo "Error: Must be on main branch (currently on $BRANCH)"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working tree is dirty. Commit or stash changes first."
  git status --short
  exit 1
fi

if git rev-parse "$TAG" &>/dev/null; then
  echo "Error: Tag $TAG already exists"
  exit 1
fi

JS_VERSION=$(node -p "require('./packages/reader-js/package.json').version")
PY_VERSION=$(grep '^version = ' packages/reader-py/pyproject.toml | sed 's/version = "\(.*\)"/\1/')

echo "Current JS:  $JS_VERSION"
echo "Current Py:  $PY_VERSION"
echo "Release:     $VERSION"
echo ""

if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "[DRY RUN] No files will be modified."
  echo ""
fi

# ─── Step 1: Bump versions ───────────────────────────────────────────

echo "[1/5] Bumping versions..."
if [ "$DRY_RUN" != "--dry-run" ]; then
  cd packages/reader-js
  npm version "$VERSION" --no-git-tag-version --allow-same-version > /dev/null
  cd "$REPO_ROOT"
  sed -i '' "s/^version = \"$PY_VERSION\"/version = \"$VERSION\"/" packages/reader-py/pyproject.toml
fi
echo "  reader-js: $JS_VERSION -> $VERSION"
echo "  reader-py: $PY_VERSION -> $VERSION"

# ─── Step 2: Run all checks ──────────────────────────────────────────

echo "[2/5] Running checks..."

revert_on_failure() {
  if [ "$DRY_RUN" != "--dry-run" ]; then
    git checkout -- packages/reader-js/package.json packages/reader-js/package-lock.json packages/reader-py/pyproject.toml 2>/dev/null || true
    echo ""
    echo "  Version bumps reverted. Fix the issue and re-run."
  fi
}
trap revert_on_failure ERR

echo "  JS typecheck..."
cd packages/reader-js && npx tsc --noEmit && cd "$REPO_ROOT"

echo "  JS tests..."
JS_TEST=$(cd packages/reader-js && npm test 2>&1)
echo "$JS_TEST" | grep -E "Test Files|Tests " | sed 's/^/  /'
cd "$REPO_ROOT"

echo "  JS build..."
cd packages/reader-js && npm run build > /dev/null 2>&1 && cd "$REPO_ROOT"

echo "  Python tests..."
cd packages/reader-py && python3 -m pytest tests/ -q 2>&1 | tail -1 | sed 's/^/  /'
cd "$REPO_ROOT"

trap - ERR
echo "  All checks passed."

# ─── Step 3: Commit + tag ────────────────────────────────────────────

echo "[3/5] Committing..."
if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "  Would commit: chore: release $TAG"
else
  git add packages/reader-js/package.json packages/reader-js/package-lock.json packages/reader-py/pyproject.toml
  git commit -m "chore: release $TAG"
  git tag "$TAG"
  echo "  Committed and tagged $TAG"
fi

# ─── Step 4: Push ────────────────────────────────────────────────────

echo "[4/5] Pushing..."
if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "  Would push main + $TAG"
else
  git push origin main --tags --no-verify
  echo "  Pushed main + $TAG"
fi

# ─── Step 5: GitHub release ──────────────────────────────────────────

echo "[5/5] Creating release..."

PREV_TAG=$(git describe --tags --abbrev=0 "$TAG^" 2>/dev/null || echo "")
if [ -n "$PREV_TAG" ]; then
  NOTES=$(git log "$PREV_TAG..$TAG" --pretty=format:"- %s" --no-merges)
else
  NOTES="Initial release"
fi

if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "  Would create release $TAG with notes:"
  echo "$NOTES" | sed 's/^/    /'
  echo ""
  echo "[DRY RUN] Nothing was modified."
else
  gh release create "$TAG" --title "$TAG" --notes "$NOTES"
  echo "  https://github.com/vakra-dev/reader-sdks/releases/tag/$TAG"
  echo "  npm + PyPI publish will trigger automatically"
fi

echo ""
echo "=== Done ==="
