# Modular release system — design (APP-963)

> **Status:** design + first module drop.
> **Ticket:** [APP-963](https://linear.app/aragon/issue/APP-963) (SEAL best-practices; blocks SREDO-695/697/698).
> **Goal:** one set of loadable modules in `aragon/github-templates` so every repo releases the same
> way — centralised secret handling, restricted Vercel access, fast vulnerability patching.

This document is the deliverable of the *study & design* phase: it identifies the release scenarios,
standardises the steps, and defines the module structure. The actual modules ship in the same PR under
`steps/` and `.github/workflows/`; migrating consumer repos onto them is downstream work
(SREDO-695/697/698).

---

## 1. The four canonical steps

Every system at Aragon — frontend app, npm library, backend service, indexer — follows the same shape:

```
Build  →  Test  →  Release package  →  Deploy
```

The modules are organised along this spine. Each step is one or more independently loadable modules so a
repo composes only what it needs.

| Step | Responsibility | Modules |
|------|----------------|---------|
| **Build** | checkout + toolchain + compile/bundle | `steps/setup` (checkout + pnpm + Node); build happens inside the deploy/publish modules (next build / lib build / docker build / envio codegen) |
| **Test** | quality gates before release | `.github/workflows/e2e.yml` (Playwright smoke/BV) + `steps/parse-playwright-results`. Unit / lint / type / integration / SCA stay as thin per-repo jobs that call `steps/setup` — they are repo-shaped and cheap, not worth a shared workflow yet |
| **Release package** | version → changelog → tag → publish | `steps/compute-version` (engine-pluggable), `.github/workflows/release-start.yml`, `release-finalize.yml`, `steps/read-changelog`, `steps/build-release-notes`, `steps/generate-release-summary`, `steps/gh-ensure-{pr,tag,release}`, `steps/git-ensure-branch` |
| **Deploy** | ship a built artifact to an environment | `.github/workflows/deploy-vercel.yml`, `.github/workflows/deploy-docker.yml`; rollback / env gates / post-deploy health are compositions of these |

Cross-cutting (used by every step): `steps/credential-retrieval` (already shipped, v0.4),
`steps/slack-notify`, `steps/extract-slack-ts`, and the security contract in §5.

---

## 2. Scenarios

Four release shapes cover every repo in scope. `app` + `app-backend` between them exercise both version
engines and both deploy targets, so the modules can be designed and dogfooded from those two alone.

### A — Frontend app on Vercel (`app`)
Build → Test (unit + Playwright smoke + build-verification) → Release (**Changesets**, tag created only
on release-PR merge) → Deploy (**Vercel**, multi-env: preview/dev/staging/prod, staging gate, hotfix,
rollback). The richest scenario and the Changesets + Vercel reference. `app` is a **pnpm monorepo**
(`apps/app`, `apps/assistant`, `packages/*`): each workspace releases independently through the same
flow, with per-package tags (`@aragon/app@1.2.3`), release scopes (which packages version together) and
per-workspace deploys — the reference for seam 3 below.

### B — npm library (`gov-ui-kit`, `aragon-domain` — identical to each other)
Build → Test → Release (**Changesets** + GitHub Release) → Deploy = **npm publish via OIDC trusted
publisher** (no `NPM_TOKEN`). `gov-ui-kit` additionally deploys Storybook to Vercel. Both repos are
single-package today and expected to migrate to monorepos while still importing these workflows — the
migration must be an input diff (seam 3), not a rewiring.

### C — Backend service (`app-backend`)
Build (Docker) → Test (unit + integration via docker-compose + SCA/Trivy) → Release
(**semantic-release**, tag on merge) → Deploy (**Docker-over-SSH**, multi-env, three approval gates,
rollback, back-merge main→dev, hotfix cherry-pick). The semantic-release + Docker reference.

### D — Indexer (`aragon-indexer`) — future
Build (Envio codegen) → Test. No release/deploy today. The design leaves a slot; not built in v1.

### Scenario × step × module matrix

| | Build | Test | Release package | Deploy |
|---|---|---|---|---|
| **A app** | `setup` | `e2e` (smoke+bv), `parse-playwright-results` | `compute-version[changesets]`, `release-start`, `release-finalize`, `read-changelog`, `build-release-notes`, `generate-release-summary`, `gh-ensure-*`, `git-ensure-branch` | `deploy-vercel` |
| **B lib** | `setup` | `e2e` (optional) | `compute-version[changesets]`, `release-start`, `release-finalize`, `read-changelog` | npm OIDC publish (+ `deploy-vercel` for Storybook) |
| **C backend** | `setup` + docker build | `e2e`, repo integration/SCA jobs | `compute-version[semantic-release]`, `release-start`, `release-finalize`, `generate-release-summary`, `gh-ensure-*` | `deploy-docker` |
| **D indexer** | `setup` + codegen | repo job | *(future)* | *(future)* |

Everything common is shared; what genuinely differs per scenario is **(a) the version engine** and
**(b) the deploy target** — see §3.

---

## 3. The three seams that differ (and how they're abstracted)

The release *orchestration* (guard one-active-release → cut branch → bump+changelog → summary → open PR
→ Slack thread → tag only on merge → GitHub Release → deploy) is **identical** across scenarios. Only
three adjacent things vary:

**Seam 1 — version engine.** Changesets (A/B) vs semantic-release (C). Encapsulated in one composite
action `steps/compute-version` with input `engine: changesets | semantic-release`. It computes the next
version, bumps `package.json`, and writes `CHANGELOG.md`; the surrounding workflow doesn't care which
engine ran. Adding a third engine later = one branch in one action.

**Seam 2 — deploy target.** Vercel (A/B) vs Docker-over-SSH (C) vs npm-OIDC (B). Each is its own reusable
workflow (`deploy-vercel.yml`, `deploy-docker.yml`, npm publish stays a thin repo job because OIDC must
run in the repo's own trust context). A repo's release workflow calls the deploy module that fits it.

**Seam 3 — package location & repo shape.** Single package at the repo root (B/C, `v1.2.3` tags) vs a
pnpm-workspace package (A, `@aragon/app@1.2.3` tags, several release lineages in one repo). Every
release/deploy module defaults to the single-package shape and takes the monorepo as inputs:

- `package-dir` — the package whose version names the release (`.` vs `apps/app`); version, changelog
  and tag all read from it.
- `tag-prefix` — `v` vs `@aragon/app@`; also drives the summary's previous-release boundary detection.
- `scope` — Changesets only: the set of packages one release flow versions together, named in the
  consumer's `.github/release-scopes.yml` (a flat `scope: [package names]` map). The shared
  `compute-version` action **inverts** the scope into `changeset version --ignore` flags against the
  live workspace list, so a newly added package fails safe (stays unreleased until it joins a scope).
  Consumers without a scopes file pass `ignore-packages` directly.
- `release-branch-prefix` — namespaces branches and the one-active-release guard per lineage
  (`release/` vs `release/app/`), so two lineages in one repo release independently.
- `workspace` / `working-directory` (deploy-vercel / e2e) — which directory to deploy or test.
- path filters for release summaries come from the consumer's `.github/filters.yml` (same flat map
  shape), naming which paths belong to which workspace.

The two mapper files (`release-scopes.yml`, `filters.yml`) are consumer-owned data; the shared modules
ship the parser (a strict vendored flat-YAML subset in `lib/`) and the resolution logic. Monorepo
semantic-release is explicitly out of scope (only Changesets repos are monorepos here).

Repo-specific quirks plug in through small optional inputs instead of forked workflows:
- the backend stale-lineage guard (refuse a computed version ≤ latest tag) is
  `require-version-above-latest-tag: true` on `release-start`;
- caller-computed blocks like the backend DB-migration warning ride `body-extras` on
  `release-start` / `release-pr-refresh` (the caller recomputes the block on each refresh);
- app's Synpress build-verification rides the `e2e.yml` generics (`env-secret-refs`,
  `pre-test-command`, `use-xvfb`, `extra-cache-path`).
What stays in the consumer's thin caller: forward-only rollback policy, hotfix
cherry-pick / back-merge specifics, per-service server config downloads.

---

## 4. Credential model

Decision: **explicit paths**, with one exception (Vercel, below). Each consumer repo knows its own
`op://vault/item/field` paths and passes them into the shared workflow as inputs; the shared job
resolves them centrally. No vault layout is hardcoded in the modules.

- **Isolation boundary:** each repo has its own `OP_SERVICE_ACCOUNT_TOKEN`, scoped in 1Password to that
  repo's vault only (`kv_app_infra`, `kv_backend2_infra`, `kv_gov-ui-kit_infra`, …). A bad/forged path
  can't reach another project's vault.
- **Vercel is a vault, not a single path.** `deploy-vercel.yml` takes one input, `op-infra-vault`, and
  resolves all three Vercel credentials it needs (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`)
  from three same-named items in that vault — a small, deliberate exception to the "explicit paths"
  rule because these three always travel together per Vercel project/environment. They are referenced
  **only** inside `deploy-vercel.yml` — no consumer workflow YAML touches them. That is how this design
  "restricts access to Vercel": the broad-permission credentials have exactly one place they can be read.
- **One resolution mechanism, two access patterns, both inside `steps/credential-retrieval`** — the
  only module in this repo that installs the 1Password CLI or calls `op`:
  - `mode: alltoenv` / `alltofile` — bulk-load every item in one vault (used for `.env` materialisation).
  - `mode: byref` — resolve a short list of named `op://` references into a JSON output (used for
    release/deploy secrets: GitHub PAT, GPG key, Slack token, Vercel token, SSH key, …). This replaces
    calling `1password/load-secrets-action` directly, which every reusable workflow used to do
    independently (each with its own copy of the `op://` validation regex). Values stay out of
    `$GITHUB_ENV` — a step reads a field explicitly with `fromJSON(steps.<id>.outputs.secrets).NAME`, so
    only steps that ask for a given secret see it.

---

## 5. Security contract (enforced in every module)

1. **Per-repo scoped `OP_SERVICE_ACCOUNT_TOKEN`** — the wall between projects.
2. **No `secrets: inherit`.** Reusable workflows receive exactly one `OP_SERVICE_ACCOUNT_TOKEN` via an
   explicit `secrets:` block — never the caller's whole secret set.
3. **Input validation + no shell interpolation.** Every `op://` / ref / version input is validated
   (e.g. `^op://[\w .-]+/[\w .-]+/[\w .-]+$`) and passed via `env:`; inputs are never interpolated
   directly into a `run:` line. Helper scripts call `git`/tools via `execFile` (no shell).
4. **Third-party actions pinned to full SHA** (matches existing `1password/install-cli-action@<sha>`).
5. **Secrets resolve only in trusted contexts** — push to a protected branch, `workflow_dispatch`, or a
   merged PR. Never under `pull_request_target` with checkout of untrusted PR code.

---

## 6. Distribution & versioning

- `github-templates` cuts **semver tags `vX.Y.Z`** plus a **moving major `vX`**, produced by its own
  release workflow (`release-self.yml`) — the repo dogfoods the very modules it ships.
- **Consumers pin to a full commit SHA** (with a `# vX.Y.Z` comment) and rely on **Dependabot**
  (`github-actions` ecosystem) to auto-open bump PRs. This keeps the supply chain pinned while still
  propagating security patches quickly — merge the Dependabot PR and the fix lands.
- This module drop is **additive** to `steps/credential-retrieval`: the existing `alltoenv` / `alltofile`
  bulk-load behavior is unchanged, so `@v0.4` SHA pins in app / app-backend / gov-ui-kit keep working.
  What's new is `mode: byref` (§4), consumed only by the reusable workflows in this same PR. New tag:
  **`v0.5`**, with `v1` introduced once the modules stabilise.

---

## 7. Key GitHub Actions constraint

Inside a **reusable workflow**, a relative `uses: ./steps/foo` resolves against the **caller** repo, not
against `github-templates`. Therefore every composite-action reference made from one of our reusable
workflows is **fully qualified**: `aragon/github-templates/steps/foo@<sha>`. Composite actions, by
contrast, can reference their own co-located files via `$GITHUB_ACTION_PATH` — which is why each action
that needs a script (`slack-notify`, `read-changelog`, `generate-release-summary`) **ships that script
inside its own folder** rather than expecting it in the consumer repo. This is the main fidelity fix
versus the per-repo originals, which assumed the script lived in the same checkout.

---

## 8. Module catalog (this PR)

### `steps/` — composite actions
| Module | Purpose | Key inputs → outputs |
|---|---|---|
| `credential-retrieval` *(existing, extended)* | the only module that talks to 1Password: bulk vault → env/file, or named `op://` refs → JSON | `op-token`, `mode`, `op-vault` (bulk modes), `secret-refs` (`byref`) → `secrets` (JSON, `byref`) |
| `setup` | checkout + pnpm + Node + install | `ref`, `node-version`, `registry-url` |
| `compute-version` | next version + bump + changelog(s); scope→`--ignore` inversion in monorepos | `engine`, `package-dir`, `scope`/`ignore-packages`, `tag-prefix`, `prettier-changelog` → `version`, `released`, `tag` |
| `generate-release-summary` | git-log → categorised summary (+Linear); per-package tag boundary + path filtering | `tag-glob`, `path-filter`/`path-patterns`, `linear-api-token`, `base-ref`, `repo` → `summary` |
| `generate-version-summary` | per-package `## name@version` + CHANGELOG sections after `changeset version` | `scope`/`packages`/`package-dir` → `summary` |
| `changesets-guard` | fail on pending changesets at the release commit (optionally scope-aware) | `scope`, `scopes-file` |
| `read-changelog` | extract a version section | `version`, `path` → `changes` |
| `build-release-notes` | notes file + `slack_ts` marker | `changes`, `slack-ts`, `path` → `path` |
| `slack-notify` | post / thread / edit Slack message | `slack-bot-token`, `slack-channel-id`, `message`, `thread-ts`, `update-ts` → `ts` |
| `extract-slack-ts` | parse `<!-- slack_ts -->` marker | `body` → `ts` |
| `parse-playwright-results` | classify Playwright JSON | `report-path`, `step-outcome` → `result`, `result_label`, `summary` |
| `gh-ensure-pr` | idempotent PR create/reuse | `base`, `head`, `title`, `body`, `token` → `url`, `number` |
| `gh-ensure-tag` | idempotent tag on SHA | `tag`, `sha`, `remote` → `created` |
| `gh-ensure-release` | idempotent GitHub Release | `tag`, `title`, `notes-path`, `token` |
| `git-ensure-branch` | idempotent branch from base | `branch`, `base-ref`, `remote` → `created` |
| `gh-pr-get-body` / `gh-pr-edit-body` | heredoc-safe PR body read / body-file write | `pr-number`, `token` (+`body`) → `body` |

Shared helpers live in `lib/` (`flatYaml`, `releaseScopes`, `changelog`, `output`, `gha.sh`) —
required by the action scripts via their co-located paths, unit-tested with `node --test` (root
`package.json` + `.github/workflows/ci.yml`). `lib/flatYaml` is a strict vendored parser for the one
YAML shape the mapper files use; action scripts must not depend on consumer `node_modules`.
`lib/gha.sh` is the bash counterpart of `lib/output.js` for composite steps with no node process
handy; a composite action reaches both via `$GITHUB_ACTION_PATH/../../lib/`, but a **reusable
workflow** cannot (it runs in the caller's checkout), so the one such call site inlines it.

### `.github/workflows/` — reusable workflows (`workflow_call`)
| Module | Purpose |
|---|---|
| `release-start.yml` | guard → branch → `compute-version` → summary → open PR → Slack thread root; monorepo via `package-dir`/`tag-prefix`/`scope`/`release-branch-prefix`; PR body style via `summary-mode: history\|packages`; optional `require-version-above-latest-tag` (stale-lineage guard), `body-extras` (caller block in PR body + Slack), `op-slack-codeowners-group-path` (subteam ping) |
| `release-pr-refresh.yml` | on release-PR push (opened/synchronize/reopened): regenerate the history summary (incl. the ⚠️ open-tickets warning) and rewrite the PR body, re-appending the `slack_ts` marker so Slack threading survives; with the optional `op-slack-*` paths it also edits the Slack head message in place (`chat.update`), and `body-extras` re-appends the caller block. History mode only — `packages` summaries detect bumps via dirty files and cannot be re-derived after the release commit |
| `release-finalize.yml` | on release-PR merge: tag (the *only* tagging point) + GitHub Release + notify. The caller picks the tag target via `sha` — the PR head SHA (the staging-**tested** commit, recommended) or the merge SHA (linear-history repos); optional `changesets-guard` |
| `deploy-vercel.yml` | Vercel build+deploy; `VERCEL_TOKEN` referenced only here; optional domain alias, `workspace` for monorepos, runtime env lifting, Sentry source maps |
| `deploy-docker.yml` | build-on-server Docker-over-SSH deploy to an environment; optional Slack gate/result ceremony (`gate-ts` output for rollback threading, gate job never blocks the deploy) and `op-env-vault` env-file materialization |
| `e2e.yml` | Playwright smoke/BV runner + result parsing + report artifact; `working-directory` for monorepos; wallet/extension suites via the optional generics `env-secret-refs` (+ optional `OP_SERVICE_ACCOUNT_TOKEN`), `pre-test-command`, `use-xvfb`, `extra-cache-path` |
| `release-self.yml` | github-templates' own semver + moving-major release (dogfood) |

### Other
- `examples/` — thin caller workflows per scenario (A/B/C) as copy-paste references for migration.
  (Not `workflow-templates/`: that only auto-surfaces from an org's `.github` repo, which this is not.)
- `.github/workflows/_selftest.yml` — manual smoke test exercising the leaf actions.
- `.github/dependabot.yml` — `github-actions` ecosystem for self; documents the consumer pin+bump flow.

---

## 9. Migration playbook (downstream — SREDO-695/697/698)

Per consumer repo, **bottom-up strangler**, pilot `app` first:
1. Replace leaf actions (`setup`, `slack-notify`, `extract-slack-ts`, changelog/summary helpers) with
   `aragon/github-templates/steps/*@<sha>`. Lowest risk, immediate de-duplication. Old workflows still run.
2. Switch deploy/e2e jobs to call `deploy-vercel.yml` / `deploy-docker.yml` / `e2e.yml`.
3. Switch the release orchestration to `release-start.yml` + `release-finalize.yml` (highest risk — last).
4. Delete the now-dead per-repo copies once the new path is green.
Then repeat for gov-ui-kit / aragon-domain (clone of `app`'s changesets path) and `app-backend`
(semantic-release + docker). Each repo keeps its own thin caller for repo-specific hooks (§3).

---

## 10. Out of scope (follow-up)
- Consumer-repo migrations (the steps above) — SREDO tickets, DevOps-owned.
- Greenfield release for indexers (scenario D).
- Vercel-side hardening: dedicated project-scoped machine user; a spike on whether OIDC-for-deploy is
  viable for Vercel (likely unsupported today — Vercel OIDC targets the deployed app reaching backends,
  not the deploy itself).
