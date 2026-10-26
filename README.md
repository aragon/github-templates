# github-templates

Shared, loadable CI/release modules used across Aragon repos. One place to standardise releases,
centralise secret handling, restrict access to sensitive tokens (e.g. Vercel), and patch quickly.

> **Design:** [`docs/release-design.md`](docs/release-design.md) — scenarios, the
> Build→Test→Release→Deploy spine, the module catalog, the Slack ceremony and the
> security/credential model.
> **Examples:** [`examples/`](examples/) — copy-paste caller workflows per scenario.

## What's here

- **`steps/`** — composite actions (step-level building blocks).
- **`.github/workflows/`** — reusable workflows (`workflow_call`, job-level).
- **`lib/`** — shared helpers used by the action scripts (unit-tested; zero runtime dependencies).

Every release/deploy module works for a **single-package repo with the defaults** and for a
**pnpm monorepo via inputs** (`package-dir`, `tag-prefix`, `scope`, `workspace`, …) — see
[`docs/release-design.md §3`](docs/release-design.md) seam 3 and
[`examples/release-changesets-monorepo.yml`](examples/release-changesets-monorepo.yml).

The philosophy: the templates hold what every repo does the same way — the release PR lifecycle,
the deploy transports, the Slack thread every release lives in, the Linear mirror — and each repo
keeps a thin caller for what is genuinely its own (hotfix cherry-picks, back-merges, server config
downloads, an inline npm publish). Nothing that a single repo needs belongs here.

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
| `resolve-slack-thread` | find the release thread from an explicit ts, a PR number or a release tag (+ the body without markers) |
| `linear-release` | mirror a release into a Linear release pipeline: `sync` (optionally from an explicit `base-ref`), `update` (stage), `complete`; a no-op without an access key |
| `parse-playwright-results` | classify a Playwright JSON report |
| `gh-ensure-pr` / `gh-ensure-tag` / `gh-ensure-release` | idempotent PR / tag / release |
| `gh-ensure-pr-comment` | one tagged PR comment that reruns edit in place (preview URLs, test results) |
| `git-ensure-branch` | idempotent branch from a base ref — for consumer flows only (`release-start.yml` names its branch inline); a hotfix flow, which stays in the consumer, is the caller |
| `gh-pr-get-body` / `gh-pr-edit-body` | heredoc-safe PR body read / write |

### Reusable workflows (`.github/workflows/`)

| Workflow | Purpose |
|----------|---------|
| `release-start.yml` | guard → compute version → cut the release branch → summary → open PR → Slack thread (+ Linear release); optional stale-version guard, `body-extras`, codeowners ping; `on-active-release: skip` for scheduled trains — a skip (open release PR, nothing to release) is posted to the channel with the manual-run link |
| `release-pr-refresh.yml` | on release-PR push: regenerate the summary (incl. the ⚠️ open-tickets warning), rewrite the PR body preserving the `slack_ts` marker, and optionally edit the Slack head message in place |
| `release-finalize.yml` | on release-PR merge: tag (the only tagging point) + GitHub Release — the caller picks the tag target (`sha`: tested head vs merge commit) and says what happens next (`after-release-note`) |
| `release-pr-cancel.yml` | on release-PR close without merge: thread message, head message flipped to Cancelled, Linear release canceled; optionally cancels runs still waiting on an approval |
| `release-complete.yml` | once the tag is live (production deploy, npm publish): head message flipped to Completed, Linear release completed |
| `notify.yml` | the Slack ceremony texts — `start`, `gate` (waiting for approval + team ping), `result`, `tests`, `failure`, `message` — threaded under the release conversation; called by the deploy/e2e workflows and by consumer jobs that cannot go through them (an inline npm publish) |
| `deploy-vercel.yml` | Vercel build + deploy (token resolved only here); monorepo `workspace`, build-only secrets, runtime env lifting, optional Sentry source maps; Slack ceremony with `gated` |
| `deploy-docker.yml` | build-on-server Docker deploy over SSH; `prepare-command` for repo-specific config files, vault-sourced env file; Slack ceremony with `gated` |
| `e2e.yml` | Playwright smoke / build-verification runner (`working-directory` for monorepos; wallet/extension suites via `env-secret-refs`, `pre-test-command`, `use-xvfb`, `extra-cache-path`); result into the release thread |
| `release-self.yml` | this repo's own release (semver tag + moving major) |

Every release/deploy workflow ends with a `notify-failure` job: a red run is told to the release
thread (or the channel) with a link to the run.

## Using a module

```yaml
jobs:
  release:
    uses: aragon/github-templates/.github/workflows/release-start.yml@main
    with:
      engine: changesets
      op-release-token-path: op://kv_app_infra/ARABOT_PAT/credential
    secrets:
      OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets.OP_SERVICE_ACCOUNT_TOKEN }}
```

See [`examples/`](examples/) for the full lifecycle per scenario.

## Security contract (every module)

1. Per-repo `OP_SERVICE_ACCOUNT_TOKEN`, scoped in 1Password to that repo's vault only.
2. No `secrets: inherit` — reusable workflows take exactly one `OP_SERVICE_ACCOUNT_TOKEN`.
3. `op://` / ref inputs are validated and passed via `env:` — never interpolated into a `run:` line.
4. Third-party actions are pinned to full SHAs.
5. Secrets resolve only in trusted contexts — never under `pull_request_target` with untrusted code.

## Versioning

Semver tags `vX.Y.Z` + a moving major `vX`, cut by `release-self.yml`.

Consumers reference `@main` while the modules settle after a migration (a fix lands once, every
repo picks it up), and move to a **commit SHA** (with a `# vX.Y.Z` comment, bumped by Dependabot)
once they do — the pinned state is the target, `@main` the bootstrap. The reusable workflows
reference the composite actions and each other `@main` as well (see `docs/release-design.md` §7).

`credential-retrieval` gained an additive `mode: byref` (named `op://` references, JSON output) that
every reusable workflow now uses instead of calling `1password/load-secrets-action` directly — see
[`docs/release-design.md §4`](docs/release-design.md#4-credential-model). Existing `alltoenv` /
`alltofile` behavior for consumers pinned to an older SHA is unchanged.

## Developing

- `node --test 'lib/*.test.js' 'steps/**/*.test.js'` runs the unit tests for the action scripts
  and `lib/` helpers (also run by `.github/workflows/ci.yml` on every PR). No install needed —
  the scripts must stay dependency-free to run on a bare runner.
- `npm run contracts:update` registers interface additions in `contracts/interfaces.json`; the
  test suite fails on unregistered additions and on breaking changes (see `contracts/README.md`).
- Run **Self-test (steps)** (`.github/workflows/_selftest.yml`, manual dispatch) to smoke-test the
  leaf actions.
- Inside a **reusable workflow**, reference composite actions by their **fully-qualified** path
  (`aragon/github-templates/steps/foo@<ref>`) — a relative `./steps/foo` would resolve against the
  caller repo. In-repo workflows (like `_selftest`/`release-self`) may use `./steps/foo`.
