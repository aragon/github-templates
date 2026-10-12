# Example callers

Copy these into a consumer repo's `.github/workflows/` and adapt them. They are **references**, not
executed from this repo.

## Referencing

The consumer repos reference `@main` while the modules settle, and move to a commit SHA (with a
`# vX.Y.Z` comment) bumped by Dependabot once they do — see the README's "Versioning". Either way,
add the `github-actions` ecosystem to the consumer's `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule: { interval: "weekly" }
```

## Credentials

Every workflow takes its 1Password paths as inputs and a single `OP_SERVICE_ACCOUNT_TOKEN` secret
(scoped in 1Password to that repo's vault). Nothing else is inherited. See
[`../docs/release-design.md`](../docs/release-design.md) §4–5.

## Files

| File | Scenario | Shows |
|------|----------|-------|
| `release-changesets.yml` | A frontend / B library / D indexer, single package | `release-start` + `release-pr-refresh` + `release-finalize` + `release-pr-cancel` with `engine: changesets` |
| `release-changesets-monorepo.yml` | A monorepo workspace | the whole PR lifecycle of one lineage: scheduled start (`on-active-release: skip`), refresh, staging deploy + smoke in the release thread, finalize, cancel — one file per lineage, with `package-dir` / `tag-prefix` / `scope` / `release-branch-prefix` |
| `deploy-production.yml` | A / B | the production deploy off the GitHub Release: `deploy-vercel` behind required reviewers (`gated`), smoke, `release-complete` |
| `publish-npm.yml` | B | the npm publish off the GitHub Release: inline OIDC publish between `notify` gate / result jobs, then `release-complete` |
| `release-semantic-release.yml` | C backend | the same lifecycle with `engine: semantic-release`, `deploy-docker` on the release PR behind the staging gate, and the backend-specific pre-hooks |
| `deploy-docker.yml` | C | calling `deploy-docker` by hand, with `prepare-command` and the gate ceremony |
