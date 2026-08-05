# Interface contracts

Backward-compatibility guard for the public interface of this repo: the `inputs`, `secrets` and
`outputs` of every reusable workflow (`.github/workflows/*.yml` with `on: workflow_call`) and
every composite action (`steps/*/action.yml`). Consumer repos call these `@main`, so anything
that lands on `main` must keep existing callers working.

`lib/backcompat.test.js` runs in the normal CI test suite (every PR and push to `main`) and
compares the interfaces extracted from the YAML sources (`lib/workflowInterfaces.js`) against
two committed files:

- **`interfaces.json`** — snapshot of the full published interface. CI fails on any
  **breaking** difference:
  - an input, secret or output was removed (callers passing a removed input fail GitHub's
    validation outright; composite actions instead silently ignore it, which is worse);
  - an optional input/secret became required, or a **new** required one appeared
    (`workflow_call` enforces `required` even when a default exists);
  - an input's `default` or `type` changed (silently changes behavior for callers that omit it).

  Backward-compatible **additions** (new workflow/action, new optional input, new output) don't
  break anything, but CI asks you to register them — run `npm run contracts:update` and commit
  the diff. That keeps the snapshot complete so a future removal of your new input is caught.

  For an *intentional* breaking change, run `ALLOW_BREAKING=1 npm run contracts:update`: the
  snapshot diff makes the break explicit in PR review. Describe the consumer migration in the PR.

- **`consumers.json`** — the exact call shapes of known consumer repos. CI fails if a called
  workflow stops defining an input/secret a consumer passes, or starts requiring one it doesn't
  pass. Add an entry when a repo starts consuming a workflow `@main`; update it when the
  consumer's `with:`/`secrets:` blocks change.

The YAML parsing is a vendored strict-subset parser (same policy as `lib/flatYaml.js`): no
dependencies, and a hard error on shapes it doesn't recognize rather than a silent misparse. If
you add YAML constructs it rejects, extend `lib/workflowInterfaces.js` (with tests) rather than
loosening it.
