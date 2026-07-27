#!/usr/bin/env bash
#
# One-shot publisher: audits the repo for leaked secrets, creates the GitHub
# repo if it doesn't exist, and pushes.
#
#   sh scripts/publish-to-github.sh              # create + push
#   REPO_NAME=my-name sh scripts/publish-to-github.sh
#   VISIBILITY=private sh scripts/publish-to-github.sh
#   DRY_RUN=1 sh scripts/publish-to-github.sh    # audit only, push nothing
#
# The secret audit is the point of this script. It refuses to push if it finds
# a credential in the *history*, not just the working tree — a token that only
# exists in an old commit is still a leaked token once the repo is public.

set -euo pipefail

REPO_NAME="${REPO_NAME:-notetaker-canvas}"
VISIBILITY="${VISIBILITY:-public}"
BRANCH="${BRANCH:-master}"
DRY_RUN="${DRY_RUN:-0}"

cd "$(dirname "$0")/.."

say()  { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '    \033[31m✗\033[0m %s\n' "$1"; }
die()  { printf '\n\033[31mAborted: %s\033[0m\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- preflight

say "Preflight"

command -v gh >/dev/null 2>&1 || die "the GitHub CLI (gh) is not installed — brew install gh"
gh auth status >/dev/null 2>&1 || die "gh is not authenticated — run: gh auth login"
ok "gh authenticated as $(gh api user --jq .login)"

git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository"
ok "git repository found"

# ------------------------------------------------------------ secret audit

say "Secret audit (working tree + full history)"

# Patterns for credentials that would actually be live if leaked. Test
# fixtures use short obvious stubs ('sk-ant-legacy'), so the length floors
# below keep those from tripping the audit.
PATTERNS='sk-ant-oat01-[A-Za-z0-9_-]{20,}|sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{36}|-----BEGIN [A-Z ]*PRIVATE KEY-----'

leaked=0

if git grep -nIE "$PATTERNS" -- . >/dev/null 2>&1; then
  bad "credential found in the working tree:"
  git grep -nIE "$PATTERNS" -- . | sed 's/^/        /'
  leaked=1
else
  ok "working tree clean"
fi

# `log -S` walks every commit's diffs, so this catches a secret that was
# committed and later deleted — exactly the case a plain grep misses.
hits="$(git log --all --oneline -G"$PATTERNS" 2>/dev/null || true)"
if [ -n "$hits" ]; then
  bad "credential found in commit history:"
  printf '%s\n' "$hits" | sed 's/^/        /'
  printf '\n    Purge it before publishing, e.g.:\n'
  printf '        git filter-branch --force --index-filter \\\n'
  printf '          "git rm --cached --ignore-unmatch PATH/TO/FILE" --prune-empty -- --all\n'
  printf '        git for-each-ref --format="%%(refname)" refs/original | xargs -n1 git update-ref -d\n'
  printf '    Then rotate the credential anyway — assume anything committed is compromised.\n'
  leaked=1
else
  ok "history clean"
fi

[ "$leaked" -eq 0 ] || die "secrets detected — nothing was pushed"

# Belt and braces: make sure the file that leaked once is still ignored.
if git check-ignore -q claude-bridge/start_command; then
  ok "claude-bridge/start_command is gitignored"
else
  bad "claude-bridge/start_command is NOT ignored — add it to .gitignore"
  die "refusing to push"
fi

# ------------------------------------------------------------------ checks

say "Repo hygiene"

[ -f LICENSE ] && ok "LICENSE present" || bad "no LICENSE (GitHub will show 'all rights reserved')"
[ -f README.md ] && ok "README.md present" || bad "no README.md"

if [ -n "$(git status --porcelain)" ]; then
  bad "working tree has uncommitted changes — these will NOT be pushed:"
  git status --short | sed 's/^/        /'
else
  ok "working tree clean"
fi

say "Verify gate"
if npm run verify >/tmp/notetaker-verify.log 2>&1; then
  ok "npm run verify passed"
else
  bad "npm run verify FAILED (see /tmp/notetaker-verify.log)"
  tail -20 /tmp/notetaker-verify.log | sed 's/^/        /'
  printf '\n    Publishing with a red build is allowed, but CI will show a failing badge.\n'
  printf '    Continue anyway? [y/N] '
  read -r reply
  case "$reply" in [Yy]*) ;; *) die "stopped at the verify gate" ;; esac
fi

# -------------------------------------------------------------------- push

if [ "$DRY_RUN" != "0" ]; then
  say "DRY_RUN set — audit complete, nothing pushed"
  exit 0
fi

say "Publishing to GitHub"

owner="$(gh api user --jq .login)"

if gh repo view "$owner/$REPO_NAME" >/dev/null 2>&1; then
  ok "repo $owner/$REPO_NAME already exists"
else
  gh repo create "$REPO_NAME" \
    --"$VISIBILITY" \
    --source=. \
    --remote=origin \
    --description "$(node -p "require('./package.json').description")" \
    --disable-wiki
  ok "created $owner/$REPO_NAME ($VISIBILITY)"
fi

git remote get-url origin >/dev/null 2>&1 \
  || git remote add origin "https://github.com/$owner/$REPO_NAME.git"

git push -u origin "$BRANCH"
ok "pushed $BRANCH"

# Topics drive GitHub's own discovery surfaces (search, /topics pages, the
# "explore" feed) — the cheapest audience win available.
gh repo edit "$owner/$REPO_NAME" \
  --add-topic whiteboard \
  --add-topic infinite-canvas \
  --add-topic tldraw \
  --add-topic ipad \
  --add-topic apple-pencil \
  --add-topic pwa \
  --add-topic ai \
  --add-topic llm \
  --add-topic claude \
  --add-topic react \
  --add-topic typescript \
  --add-topic study-tool >/dev/null
ok "topics set"

say "Done — https://github.com/$owner/$REPO_NAME"
printf '\nNext:\n'
printf '  - Add a screenshot or GIF to the README (biggest single conversion lever).\n'
printf '  - Deploy a live demo and link it at the top.\n'
printf '  - See docs/PROMOTION.md for the launch plan.\n\n'
