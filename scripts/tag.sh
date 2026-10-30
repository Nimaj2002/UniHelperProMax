#!/usr/bin/env bash
# Bumps the app version everywhere, commits "Release X.Y.Z" and creates the annotated tag vX.Y.Z.
#
#   scripts/tag.sh 1.0.4                          opens your editor for the tag notes
#   scripts/tag.sh 1.0.4 "Features
#   - Something new"                              uses the given notes
#
# Does not push. Afterwards: git push && git push origin vX.Y.Z
set -euo pipefail

new="${1:?usage: scripts/tag.sh X.Y.Z [notes]}"
notes="${2:-}"
[[ "$new" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "tag: '$new' is not X.Y.Z" >&2; exit 2; }

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

[ -z "$(git status --porcelain)" ] || { echo "tag: working tree is not clean" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$new" >/dev/null && { echo "tag: v$new already exists" >&2; exit 1; }

old="$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' frontend/package.json | head -1)"
[ -n "$old" ] || { echo "tag: can't read current version from frontend/package.json" >&2; exit 1; }
[ "$old" != "$new" ] || { echo "tag: already at $new" >&2; exit 1; }
o="${old//./\\.}"

sed -i.bak "s/^version = \"$o\"/version = \"$new\"/" backend/pyproject.toml
# uv.lock: only the version line right after our own package's name
sed -i.bak "/^name = \"unihelper\"/{n;s/^version = \"$o\"/version = \"$new\"/;}" backend/uv.lock
sed -i.bak "s/^  \"version\": \"$o\",/  \"version\": \"$new\",/" desktop/package.json frontend/package.json
# package-lock: the root "version" and packages[""].version are the first two matches
perl -pi -e "\$n < 2 && s/\"version\": \"$o\"/\"version\": \"$new\"/ && \$n++" desktop/package-lock.json
rm -f backend/*.bak desktop/*.bak frontend/*.bak

changed="$(git diff --numstat | awk '{s+=$1} END {print s+0}')"
[ "$changed" -eq 6 ] || { echo "tag: expected 6 changed lines, got $changed; check git diff" >&2; exit 1; }

git commit -qam "Release $new"
if [ -n "$notes" ]; then
  git tag -a "v$new" -m "UniHelperProMax $new

$notes"
else
  git tag -a "v$new" -e -m "UniHelperProMax $new"
fi
echo "Released $old -> $new as v$new. Push with: git push && git push origin v$new"
