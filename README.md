# github-templates

Shared, loadable CI/release modules used across Aragon repos. One place to standardise releases,
centralise secret handling, restrict access to sensitive tokens (e.g. Vercel), and patch quickly.

> **Design:** [`docs/release-design.md`](docs/release-design.md) — scenarios, the
> Build→Test→Release→Deploy spine, the module catalog, and the security/credential model.
> **Examples:** [`examples/`](examples/) — copy-paste caller workflows per scenario.

## What's here

- **`steps/`** — composite actions (step-level building blocks).
- **`.github/workflows/`** — reusable workflows (`workflow_call`, job-level).

### Composite actions (`steps/`)

| Action | Purpose |
|--------|---------|
| `credential-retrieval` | bulk-load a 1Password vault into env vars or a file |
| `setup` | checkout + pnpm + Node + install |
| `compute-version` | next version + bump + CHANGELOG — engine: `changesets` or `semantic-release` |
| `generate-release-summary` | git-log → categorised summary (optional Linear enrichment) |
| `read-changelog` | extract a version's section from CHANGELOG.md |
| `build-release-notes` | release-notes file + Slack thread marker |
| `slack-notify` | post / thread / edit a Slack message |
| `extract-slack-ts` | parse the `<!-- slack_ts -->` marker from text |
| `parse-playwright-results` | classify a Playwright JSON report |
| `gh-ensure-pr` / `gh-ensure-tag` / `gh-ensure-release` | idempotent PR / tag / release |
| `git-ensure-branch` | idempotent branch from a base ref |

### Reusable workflows (`.github/workflows/`)

| Workflow | Purpose |
|----------|---------|
| `release-start.yml` | guard → compute version → cut `release/<v>` → summary → open PR → Slack thread |
| `release-finalize.yml` | on release-PR merge: tag (the only tagging point) + GitHub Release |
| `deploy-vercel.yml` | Vercel build + deploy (token resolved only here) |
| `deploy-docker.yml` | build-on-server Docker deploy over SSH |
| `e2e.yml` | Playwright smoke / build-verification runner |
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

Semver tags `vX.Y.Z` + a moving major `vX`, cut by `release-self.yml`. This is **additive** to the
existing `credential-retrieval@v0.4`, which is unchanged. Consumers pin SHAs and adopt new releases via
Dependabot.

## Developing

- Run **Self-test (steps)** (`.github/workflows/_selftest.yml`, manual dispatch) to smoke-test the
  leaf actions.
- Inside a **reusable workflow**, reference composite actions by their **fully-qualified** path
  (`aragon/github-templates/steps/foo@<ref>`) — a relative `./steps/foo` would resolve against the
  caller repo. In-repo workflows (like `_selftest`/`release-self`) may use `./steps/foo`.
