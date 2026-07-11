#!/usr/bin/env bash
# Apply the committed branch-protection config (.github/branch-protection/main.json) to main.
# Idempotent — re-run any time to reconcile drift.
#
# Two ways to run:
#   - LOCAL (no secret): `gh auth login` as a repo admin, then `bash scripts/apply-branch-protection.sh`.
#   - CI: from the Apply-branch-protection workflow, with an admin PAT in GH_TOKEN.
#
# NOTE: branch protection needs repo-ADMIN scope. The built-in GITHUB_TOKEN can't do it; a
# fine-grained PAT with "Administration: read and write" (or your own admin `gh` login) is required.
set -euo pipefail

REPO="${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
CONFIG="$(cd "$(dirname "$0")/.." && pwd)/.github/branch-protection/main.json"

gh api --method PUT "repos/${REPO}/branches/main/protection" \
  -H "Accept: application/vnd.github+json" \
  --input "$CONFIG"

echo "applied — current protection on ${REPO}@main:"
gh api "repos/${REPO}/branches/main/protection" \
  --jq '{required_checks: .required_status_checks.contexts, strict: .required_status_checks.strict, enforce_admins: .enforce_admins.enabled}'
