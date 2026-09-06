#!/usr/bin/env bash
#
# One-shot: turn this folder into the standalone Obsidian-plugin repo on GitHub,
# push it, and cut the 0.1.0 release (which the release workflow will populate
# with manifest.json / main.js / versions.json).
#
# Prereqs: `gh auth login` done, and you have rights to create a repo under the
# Internet-of-Humans org. Run from inside this folder:
#
#   bash push.sh
#
set -euo pipefail

ORG="Internet-of-Humans"
REPO="ruune-obsidian-plugin"
VERSION="$(node -p "require('./manifest.json').version")"

echo "==> Plugin version from manifest.json: ${VERSION}"

# 1. Fresh git history (this is a brand-new standalone repo).
if [ ! -d .git ]; then
  git init -b main
fi
git add -A
git commit -m "Ruune Sync ${VERSION}: initial standalone plugin repo" || echo "(nothing to commit)"

# 2. Create the GitHub repo (public so it's eligible for the community store).
if ! gh repo view "${ORG}/${REPO}" >/dev/null 2>&1; then
  echo "==> Creating https://github.com/${ORG}/${REPO}"
  gh repo create "${ORG}/${REPO}" --public --source=. --remote=origin --push
else
  echo "==> ${ORG}/${REPO} already exists; wiring remote + pushing"
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/${ORG}/${REPO}.git"
  git push -u origin main
fi

# 3. Tag + push -> triggers .github/workflows/release.yml to build the release.
#    The tag is bare (no "v") so it matches manifest.json exactly, as Obsidian
#    requires.
echo "==> Tagging ${VERSION}"
git tag -f "${VERSION}"
git push -f origin "refs/tags/${VERSION}"

echo
echo "Done. Watch the release build here:"
echo "  https://github.com/${ORG}/${REPO}/actions"
echo "and the release should appear at:"
echo "  https://github.com/${ORG}/${REPO}/releases/tag/${VERSION}"
