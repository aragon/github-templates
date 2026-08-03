# github-templates

Shared, loadable CI/release modules used across Aragon repos. One place to standardise releases,
centralise secret handling, restrict access to sensitive tokens (e.g. Vercel), and patch quickly.

> **Design:** [`docs/release-design.md`](docs/release-design.md) — scenarios, the
> Build→Test→Release→Deploy spine, the module catalog, and the security/credential model.
> **Examples:** [`examples/`](examples/) — copy-paste caller workflows per scenario.

## What's here

- **`steps/`** — composite actions (step-level building blocks).
- **`.github/workflows/`** — reusable workflows (`workflow_call`, job-level).
- **`lib/`** — shared helpers used by the action scripts (unit-tested; zero runtime dependencies).

Every release/deploy module works for a **single-package repo with the defaults** and for a
**pnpm monorepo via inputs** (`package-dir`, `tag-prefix`, `scope`, `workspace`, …) — see
[`docs/release-design.md §3`](docs/release-design.md) seam 3 and
[`examples/release-changesets-monorepo.yml`](examples/release-changesets-monorepo.yml).

### Composite actions (`steps/`)

| Action | Purpose |
|--------|---------|
| `credential-retrieval` | the only place this repo talks to 1Password: bulk-load a vault into env vars/a file, or resolve named `op://` references (`mode: byref`) |
| `setup` | checkout + pnpm + Node + install |
| `compute-version` | next version + bump + CHANGELOG — engine: `changesets` or `semantic-release`; monorepo release scopes via `scope` → `changeset version --ignore` inversion |
| `generate-release-summary` | git-log → categorised summary (optional Linear enrichment); `tag-glob` boundary + optional per-workspace path filtering |
| `generate-version-summary` | per-package `## name@version` + CHANGELOG sections after `changeset version` |
| `changesets-guard` | fail on pending changesets at the release commit (optionally scope-aware) |
| `read-changelog` | extract a version's section from CHANGELOG.md |
| `build-release-notes` | release-notes file + Slack thread marker |
| `slack-notify` | post / thread / edit a Slack message |
| `extract-slack-ts` | parse the `<!-- slack_ts -->` marker from text |
| `parse-playwright-results` | classify a Playwright JSON report |
| `gh-ensure-pr` / `gh-ensure-tag` / `gh-ensure-release` | idempotent PR / tag / release |
| `git-ensure-branch` | idempotent branch from a base ref |
| `gh-pr-get-body` / `gh-pr-edit-body` | heredoc-safe PR body read / write |

### Reusable workflows (`.github/workflows/`)

| Workflow | Purpose |
|----------|---------|
| `release-start.yml` | guard → compute version → cut the release branch → summary → open PR → Slack thread; optional stale-version guard, `body-extras`, codeowners ping |
| `release-pr-refresh.yml` | on release-PR push: regenerate the summary (incl. the ⚠️ open-tickets warning), rewrite the PR body preserving the `slack_ts` marker, and optionally edit the Slack head message in place |
| `release-finalize.yml` | on release-PR merge: tag (the only tagging point) + GitHub Release — the caller picks the tag target (`sha`: tested head vs merge commit) |
| `deploy-vercel.yml` | Vercel build + deploy (token resolved only here); monorepo `workspace`, runtime env lifting, optional Sentry source maps |
| `deploy-docker.yml` | build-on-server Docker deploy over SSH; optional Slack gate/result messages (`gate-ts` output) and vault-sourced env file |
| `e2e.yml` | Playwright smoke / build-verification runner (`working-directory` for monorepos; wallet/extension suites via `env-secret-refs`, `pre-test-command`, `use-xvfb`, `extra-cache-path`) |
| `release-self.yml` | this repo's own release (semver tag + moving major) |

## Using a module

Pin to a **commit SHA** (Dependabot keeps it current) — see [`examples/`](examples/):

```yaml
jobs:
  release:
    uses: aragon/github-templates/.github/workflows/release-start.yml@<sha> # v0.5.0
    with:
      engine: changesets
      op-release-token-path: op://kv_app_infra/ARABOT_PAT/credential
    secrets:
      OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets.OP_SERVICE_ACCOUNT_TOKEN }}
```

## Security contract (every module)

1. Per-repo `OP_SERVICE_ACCOUNT_TOKEN`, scoped in 1Password to that repo's vault only.
2. No `secrets: inherit` — reusable workflows take exactly one `OP_SERVICE_ACCOUNT_TOKEN`.
3. `op://` / ref inputs are validated and passed via `env:` — never interpolated into a `run:` line.
4. Third-party actions are pinned to full SHAs.
5. Secrets resolve only in trusted contexts — never under `pull_request_target` with untrusted code.

## Versioning

Semver tags `vX.Y.Z` + a moving major `vX`, cut by `release-self.yml`. Consumers pin SHAs and adopt
new releases via Dependabot.

`credential-retrieval` gained an additive `mode: byref` (named `op://` references, JSON output) that
every reusable workflow now uses instead of calling `1password/load-secrets-action` directly — see
[`docs/release-design.md §4`](docs/release-design.md#4-credential-model). Existing `alltoenv` /
`alltofile` behavior for consumers pinned to an older SHA is unchanged.

## Developing

- `node --test 'lib/*.test.js' 'steps/**/*.test.js'` runs the unit tests for the action scripts
  and `lib/` helpers (also run by `.github/workflows/ci.yml` on every PR). No install needed —
  the scripts must stay dependency-free to run on a bare runner.
- Run **Self-test (steps)** (`.github/workflows/_selftest.yml`, manual dispatch) to smoke-test the
  leaf actions.
- Inside a **reusable workflow**, reference composite actions by their **fully-qualified** path
  (`aragon/github-templates/steps/foo@<ref>`) — a relative `./steps/foo` would resolve against the
  caller repo. In-repo workflows (like `_selftest`/`release-self`) may use `./steps/foo`.
