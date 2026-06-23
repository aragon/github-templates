# Example callers

Copy these into a consumer repo's `.github/workflows/` and adapt them. They are **references**, not
executed from this repo.

## Pinning

Replace `@main` with a **specific commit SHA** (with a `# vX.Y.Z` comment) and let Dependabot bump it:

```yaml
uses: aragon/github-templates/.github/workflows/release-start.yml@<sha> # v0.5.0
```

Add to the consumer's `.github/dependabot.yml`:

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
| `release-changesets.yml` | A frontend / B library | `release-start` + `release-finalize` with `engine: changesets` |
| `release-semantic-release.yml` | C backend | `release-start` + `release-finalize` with `engine: semantic-release` + repo-specific pre-hooks |
| `deploy-vercel.yml` | A / B | calling `deploy-vercel` behind a protected environment |
| `deploy-docker.yml` | C | calling `deploy-docker` over SSH |
