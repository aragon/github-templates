// Pass-through actions: steps/<name>/action.yml files that wrap exactly one upstream action
// (actions/checkout, actions/setup-node, …) with the same inputs, outputs and defaults, so a
// consumer swaps `uses: actions/checkout@…` for `uses: aragon/github-templates/steps/checkout@v1`
// and changes nothing else. The pin lives here once; Dependabot bumps it, the major tag carries it
// to every consumer (README "Pass-through actions").
//
// The wrapper's interface is never written by hand: it is copied from the upstream action.yml at
// the pinned SHA. A wrapper is recognized by its first line (MARKER) and needs only its pin to be
// (re)generated:
//
//   node lib/passthrough.js           — npm run passthrough:sync: rewrite every wrapper from its pin
//   node lib/passthrough.js --check   — npm run passthrough:check: fail if one is out of date (CI)
//
// Inputs that carry a `deprecationMessage` upstream are not exposed: a wrapper passes every input
// it declares, and the runner warns whenever a deprecated input is passed — on every run, for a
// value the caller never set. The header of the generated file names them.
//
// The section splitting is strict, like the rest of lib/: 2-space entries, props two spaces
// deeper, anything else is a hard error rather than a silent misparse. The rendered wrapper is
// re-read through lib/workflowInterfaces.js and must match the upstream interface exactly.

const fs = require('node:fs');
const path = require('node:path');
const { extractActionInterface } = require('./workflowInterfaces');

const MARKER = '# Pass-through of ';
const STEP_ID = 'upstream';
const PIN_RE = /^\s+uses:\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?)@([0-9a-f]{40})\s+#\s*(\S+)\s*$/;
const ENTRY_RE = /^ {2}([A-Za-z0-9_.-]+):\s*(#.*)?$/;
const indentOf = (line) => line.length - line.trimStart().length;

const isPassthrough = (text) => text.startsWith(MARKER);

// The one SHA-pinned `uses:` line, with the version comment Dependabot keeps next to it.
const readPin = (text, file) => {
    const pins = text.split('\n').map((line) => line.match(PIN_RE)).filter(Boolean);
    if (pins.length !== 1) {
        throw new Error(`${file}: expected exactly one \`uses: owner/repo@<40-hex sha> # <version>\` line, `
            + `found ${pins.length}`);
    }
    const [, action, sha, version] = pins[0];
    return { action, sha, version };
};

// The lines of a top-level section (`inputs:` / `outputs:`) without its header, up to the next
// top-level line; trailing blank lines dropped. An absent section is empty.
const sectionLines = (text, key) => {
    const lines = text.split('\n');
    const header = new RegExp(`^${key}:\\s*(#.*)?$`);
    const start = lines.findIndex((line) => header.test(line));
    if (start === -1) return [];
    const body = [];
    for (let i = start + 1; i < lines.length; i++) {
        if (lines[i].trim() !== '' && indentOf(lines[i]) === 0) break;
        body.push(lines[i]);
    }
    while (body.length > 0 && body.at(-1).trim() === '') body.pop();
    return body;
};

// Splits a section into its entries, each with every line that belongs to it (props, block-scalar
// content, blank lines inside a block scalar). Comment lines at the entry level are dropped.
const splitEntries = (lines, file, key) => {
    const entries = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') {
            if (entries.length > 0) entries.at(-1).lines.push(line);
            continue;
        }
        const indent = indentOf(line);
        if (indent === 2 && trimmed.startsWith('#')) continue;
        if (indent === 2) {
            const match = line.match(ENTRY_RE);
            if (!match) throw new Error(`${file}: unexpected line in ${key}: "${trimmed}"`);
            entries.push({ name: match[1], lines: [line] });
        } else if (indent > 2 && entries.length > 0) {
            entries.at(-1).lines.push(line);
        } else {
            throw new Error(`${file}: unexpected indentation in ${key}: "${trimmed}"`);
        }
    }
    for (const entry of entries) {
        while (entry.lines.at(-1).trim() === '') entry.lines.pop();
    }
    return entries;
};

const isDeprecated = (entry) => entry.lines.some((line) => /^ {4}deprecationMessage:/.test(line));

// An upstream output keeps its description; its `value:` (only a composite upstream has one)
// is replaced by the wiring to the wrapped step.
const outputLines = (entry, file) => {
    const kept = [];
    for (const line of entry.lines) {
        const value = line.match(/^ {4}value:(.*)$/);
        if (!value) {
            kept.push(line);
            continue;
        }
        if (/^\s*[|>]/.test(value[1])) {
            throw new Error(`${file}: output "${entry.name}" has a block-scalar value; not supported`);
        }
    }
    kept.push(`    value: \${{ steps.${STEP_ID}.outputs.${entry.name} }}`);
    return kept;
};

// The full wrapper file for `dir` (the folder under steps/), from the pin and the upstream
// action.yml text at that pin.
const render = ({ dir, action, sha, version, upstream, file = `steps/${dir}/action.yml` }) => {
    const source = `${action}@${sha}`;
    const inputs = splitEntries(sectionLines(upstream, 'inputs'), source, 'inputs');
    const outputs = splitEntries(sectionLines(upstream, 'outputs'), source, 'outputs');
    const exposed = inputs.filter((entry) => !isDeprecated(entry));
    const deprecated = inputs.filter(isDeprecated).map((entry) => entry.name);

    const out = [
        `${MARKER}${action}, as aragon/github-templates/steps/${dir}.`,
        '# Generated by `npm run passthrough:sync` — do not edit by hand. Inputs, outputs and defaults',
        '# are copied verbatim from the upstream action.yml at the pinned SHA, so a caller swaps the',
        '# upstream `uses:` for this action and changes nothing else. Dependabot bumps the pin; CI fails',
        '# until the interface is re-copied (README "Pass-through actions").',
    ];
    if (deprecated.length > 0) {
        out.push(`# Not exposed (deprecated upstream; passing them would warn on every run): ${deprecated.join(', ')}.`);
    }
    out.push(
        `name: "${action} (pass-through)"`,
        `description: "Runs ${action} at the version pinned in aragon/github-templates, with the same inputs, outputs and defaults."`,
    );
    if (exposed.length > 0) {
        out.push('', 'inputs:', ...exposed.flatMap((entry) => entry.lines));
    }
    if (outputs.length > 0) {
        out.push('', 'outputs:', ...outputs.flatMap((entry) => outputLines(entry, source)));
    }
    out.push(
        '',
        'runs:',
        '  using: "composite"',
        '  steps:',
        `    - id: ${STEP_ID}`,
        `      uses: ${action}@${sha} # ${version}`,
    );
    if (exposed.length > 0) {
        out.push('      with:', ...exposed.map((entry) => `        ${entry.name}: \${{ inputs.${entry.name} }}`));
    }
    const text = `${out.join('\n')}\n`;

    // The copy must be exact: same inputs (required, default) minus the deprecated ones, same
    // outputs — read back through the parser the contracts use.
    const expected = extractActionInterface(upstream, source);
    for (const name of deprecated) delete expected.inputs[name];
    const actual = extractActionInterface(text, file);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${file}: the rendered interface does not match ${source}:\n`
            + `  expected ${JSON.stringify(expected)}\n  rendered ${JSON.stringify(actual)}`);
    }
    return text;
};

// Every pass-through wrapper under `root`/steps, in folder order.
const listPassthroughs = (root) => {
    const stepsDir = path.join(root, 'steps');
    const found = [];
    for (const dir of fs.readdirSync(stepsDir).sort()) {
        const file = path.join(stepsDir, dir, 'action.yml');
        let text;
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch (err) {
            if (err.code === 'ENOENT' || err.code === 'ENOTDIR') continue;
            throw err;
        }
        if (isPassthrough(text)) found.push({ dir, file, text });
    }
    return found;
};

// The upstream metadata file at the pinned SHA (`action.yml`, or `action.yaml` as GitHub also
// accepts). An action in a subfolder (`owner/repo/path`) is looked up in that folder.
const fetchUpstream = async ({ action, sha }) => {
    const [owner, repo, ...subPath] = action.split('/');
    const base = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${subPath.map((p) => `${p}/`).join('')}`;
    for (const name of ['action.yml', 'action.yaml']) {
        const response = await fetch(`${base}${name}`);
        if (response.ok) return response.text();
        if (response.status !== 404) throw new Error(`${base}${name}: HTTP ${response.status}`);
    }
    throw new Error(`${action}@${sha}: no action.yml or action.yaml`);
};

const main = async () => {
    const check = process.argv.includes('--check');
    const root = path.join(__dirname, '..');
    const stale = [];
    for (const { dir, file, text } of listPassthroughs(root)) {
        const relative = path.relative(root, file);
        const pin = readPin(text, relative);
        const next = render({ dir, ...pin, upstream: await fetchUpstream(pin), file: relative });
        if (next === text) {
            console.log(`up to date: ${relative} (${pin.action} ${pin.version})`);
        } else if (check) {
            stale.push(relative);
        } else {
            fs.writeFileSync(file, next);
            console.log(`updated:    ${relative} (${pin.action} ${pin.version})`);
        }
    }
    if (stale.length > 0) {
        console.error('Pass-through actions out of date with their pinned upstream action.yml:');
        for (const file of stale) console.error(`  - ${file}`);
        console.error('Run: npm run passthrough:sync (then npm run contracts:update if the interface grew)');
        process.exitCode = 1;
    }
};

if (require.main === module) {
    main().catch((err) => {
        console.error(err.message);
        process.exit(1);
    });
}

module.exports = { MARKER, STEP_ID, isPassthrough, readPin, sectionLines, splitEntries, render, listPassthroughs };
