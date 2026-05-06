#!/usr/bin/env bash
#
# Release script for reader-sdks (JS + Python)
#
# Usage:
#   ./scripts/release.sh 0.3.0
#   ./scripts/release.sh 0.3.0 --dry-run
#
# Both SDKs are versioned together. This script bumps both, runs both
# test suites, tags, and creates a GitHub release. CI publishes to npm + PyPI.
#
# Idempotent: safe to rerun after a failure.
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

echo "=== reader-sdks release $TAG ==="
echo ""

if ! command -v gh &>/dev/null; then
  echo "Error: GitHub CLI (gh) is required."
  exit 1
fi

BRANCH=$(git branch --show-current)
echo "Branch: $BRANCH"
echo "Version: $VERSION"
echo ""

# --- Step 1: Bump versions ---
echo "[1/6] Checking versions..."

NEED_BUMP=false

JS_VERSION=$(node -p "require('./packages/reader-js/package.json').version")
if [ "$JS_VERSION" != "$VERSION" ]; then
  cd packages/reader-js
  npm version "$VERSION" --no-git-tag-version --allow-same-version
  cd "$REPO_ROOT"
  echo "  reader-js: $JS_VERSION -> $VERSION"
  NEED_BUMP=true
else
  echo "  reader-js: already $VERSION"
fi

PY_VERSION=$(grep '^version = ' packages/reader-py/pyproject.toml | sed 's/version = "\(.*\)"/\1/')
if [ "$PY_VERSION" != "$VERSION" ]; then
  sed -i '' "s/^version = \"$PY_VERSION\"/version = \"$VERSION\"/" packages/reader-py/pyproject.toml
  echo "  reader-py: $PY_VERSION -> $VERSION"
  NEED_BUMP=true
else
  echo "  reader-py: already $VERSION"
fi

# --- Step 2: JS checks ---
echo ""
echo "[2/6] JS SDK: typecheck + test + build..."
cd packages/reader-js
npx tsc --noEmit
npm test
npm run build
cd "$REPO_ROOT"
echo "  JS SDK passed."

# --- Step 3: Python checks ---
echo ""
echo "[3/6] Python SDK: tests..."
cd packages/reader-py
python3 -m pytest tests/ -q
cd "$REPO_ROOT"
echo "  Python SDK passed."

# --- Step 4: Commit ---
echo ""
echo "[4/6] Committing..."

if [ "$NEED_BUMP" = true ]; then
  if [ "$DRY_RUN" = "--dry-run" ]; then
    echo "  [dry-run] Would commit version bump to $VERSION"
  else
    git add packages/reader-js/package.json packages/reader-js/package-lock.json packages/reader-py/pyproject.toml
    git commit -m "chore: bump version to $VERSION"
    echo "  Committed version bump."
  fi
else
  echo "  Versions already correct, nothing to commit."
fi

# --- Step 5: Push to main ---
echo ""
echo "[5/6] Pushing..."

if [ "$BRANCH" = "main" ]; then
  if [ "$DRY_RUN" != "--dry-run" ]; then
    git push origin main 2>/dev/null || true
  fi
else
  if [ "$DRY_RUN" = "--dry-run" ]; then
    echo "  [dry-run] Would merge $BRANCH -> main"
  else
    git push origin "$BRANCH" 2>/dev/null || true
    git checkout main
    git pull origin main
    git merge "$BRANCH" --no-edit
    git push origin main
    echo "  Merged $BRANCH -> main and pushed."
  fi
fi

# --- Step 6: Tag + release ---
echo ""
echo "[6/6] Tagging and releasing..."

if git rev-parse "$TAG" &>/dev/null; then
  echo "  Tag $TAG already exists, skipping."
else
  if [ "$DRY_RUN" = "--dry-run" ]; then
    echo "  [dry-run] Would create tag $TAG"
  else
    git tag "$TAG"
    git push origin "$TAG"
    echo "  Created and pushed $TAG."
  fi
fi

if gh release view "$TAG" &>/dev/null 2>&1; then
  echo "  Release $TAG already exists, skipping."
else
  PREV_TAG=$(git describe --tags --abbrev=0 "$TAG^" 2>/dev/null || echo "")
  if [ -n "$PREV_TAG" ]; then
    NOTES=$(git log "$PREV_TAG..$TAG" --pretty=format:"- %s" --no-merges)
  else
    NOTES="Initial release"
  fi

  if [ "$DRY_RUN" = "--dry-run" ]; then
    echo "  [dry-run] Would create release $TAG"
    echo "  Notes:"
    echo "$NOTES" | sed 's/^/    /'
  else
    gh release create "$TAG" --title "$TAG" --notes "$NOTES"
    echo "  Release created."
    echo "  -> publish.yml will publish JS to npm + Python to PyPI"
  fi
fi

echo ""
echo "=== Done ==="
