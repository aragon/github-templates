// Extracts the public interface — inputs, secrets, outputs — of every reusable workflow
// (`on: workflow_call`) and composite action in this repo, straight from the YAML source.
// Vendored strict-subset parser, same policy as flatYaml.js: no YAML dependency (these checks
// must run on a bare runner via `node --test`), and a hard error on shapes it does not
// recognize rather than a silent misparse. It understands exactly the layout this repo uses:
// 2-space indentation, one `name:` entry per line, scalar `required`/`type`/`default` props,
// and block-scalar descriptions (which it skips by indentation).
//
// Consumed by lib/backcompat.test.js, which compares the extracted interfaces against the
// committed snapshot in contracts/interfaces.json — see contracts/README.md for the rules.

const fs = require('node:fs');
const path = require('node:path');

// Props that form the compat contract. `description` is parsed (so single-line descriptions are
// recognized as props, not entries) but dropped from the result — prose is not part of the
// contract. `value` (workflow outputs) is likewise dropped: only the output's existence is.
const PROP_RE = /^(description|required|type|default|value):(.*)$/;
const ENTRY_RE = /^([A-Za-z0-9_.-]+):\s*(#.*)?$/;

const indentOf = (line) => line.length - line.trimStart().length;

const isSkippable = (line) => {
    const t = line.trim();
    return t === '' || t.startsWith('#');
};

const parseScalar = (raw) => {
    const v = raw.trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
    if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
    return v.replace(/\s+#.*$/, '');
};

// First non-skippable line at or below `indent` — the exclusive end of the block starting at
// `start`.
const blockEnd = (lines, start, indent) => {
    for (let i = start; i < lines.length; i++) {
        if (isSkippable(lines[i])) continue;
        if (indentOf(lines[i]) <= indent) return i;
    }
    return lines.length;
};

// Collects the `name:` entries of an inputs/secrets/outputs section whose entries sit at
// `entryIndent`, with scalar props two spaces deeper. Anything deeper than the props level is
// block-scalar description content and is skipped; a non-entry line at the entry level is a
// shape this parser does not understand and fails hard.
const collectEntries = (lines, start, entryIndent, file) => {
    const entries = {};
    let current = null;
    let i = start;
    for (; i < lines.length; i++) {
        const line = lines[i];
        if (isSkippable(line)) continue;
        const indent = indentOf(line);
        if (indent < entryIndent) break;
        if (indent === entryIndent) {
            const m = line.trim().match(ENTRY_RE);
            if (!m) throw new Error(`${file}: unexpected line in interface section: "${line.trim()}"`);
            current = m[1];
            entries[current] = {};
        } else if (indent === entryIndent + 2 && current !== null) {
            const m = line.trim().match(PROP_RE);
            if (m) entries[current][m[1]] = parseScalar(m[2]);
        }
    }
    return { entries, end: i };
};

// Normalizes raw props into the contract shape: `required` becomes a boolean (absent = false),
// `type` and `default` are kept verbatim when present (a missing default is distinct from
// `default: ""` — both matter for callers), prose props are dropped.
const normalizeEntry = (props) => {
    const out = { required: props.required === 'true' };
    if (props.type !== undefined) out.type = props.type;
    if (props.default !== undefined) out.default = props.default;
    return out;
};

const normalizeSection = (entries, keep) => {
    const out = {};
    for (const name of Object.keys(entries).sort()) {
        const entry = normalizeEntry(entries[name]);
        const kept = {};
        for (const k of keep) if (entry[k] !== undefined) kept[k] = entry[k];
        out[name] = kept;
    }
    return out;
};

// Returns the interface of a reusable workflow, or null when the file is not `workflow_call`
// (e.g. this repo's own CI) and therefore has no caller-facing contract.
const extractWorkflowInterface = (text, file) => {
    const lines = text.split('\n');
    const onIdx = lines.findIndex((l) => /^on:\s*(#.*)?$/.test(l));
    if (onIdx === -1) return null;
    const onEnd = blockEnd(lines, onIdx + 1, 0);

    let wcIdx = -1;
    for (let i = onIdx + 1; i < onEnd; i++) {
        if (!isSkippable(lines[i]) && indentOf(lines[i]) === 2
            && /^workflow_call:\s*(#.*)?$/.test(lines[i].trim())) { wcIdx = i; break; }
    }
    if (wcIdx === -1) return null;
    const wcEnd = blockEnd(lines, wcIdx + 1, 2);

    const sections = { inputs: {}, secrets: {}, outputs: {} };
    for (let i = wcIdx + 1; i < wcEnd; i++) {
        const line = lines[i];
        if (isSkippable(line) || indentOf(line) !== 4) continue;
        const m = line.trim().match(/^(inputs|secrets|outputs):\s*(#.*)?$/);
        if (!m) throw new Error(`${file}: unexpected workflow_call section: "${line.trim()}"`);
        const { entries, end } = collectEntries(lines, i + 1, 6, file);
        sections[m[1]] = entries;
        i = end - 1;
    }
    return {
        inputs: normalizeSection(sections.inputs, ['required', 'type', 'default']),
        secrets: normalizeSection(sections.secrets, ['required']),
        outputs: Object.keys(sections.outputs).sort(),
    };
};

// Composite actions: top-level `inputs:` / `outputs:` sections, entries at indent 2, props at 4.
const extractActionInterface = (text, file) => {
    const lines = text.split('\n');
    const sections = { inputs: {}, outputs: {} };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isSkippable(line) || indentOf(line) !== 0) continue;
        const m = line.trim().match(/^(inputs|outputs):\s*(#.*)?$/);
        if (!m) continue;
        const { entries, end } = collectEntries(lines, i + 1, 2, file);
        sections[m[1]] = entries;
        i = end - 1;
    }
    return {
        inputs: normalizeSection(sections.inputs, ['required', 'default']),
        outputs: Object.keys(sections.outputs).sort(),
    };
};

// The full contract of the repo at `root`: every workflow_call workflow under
// .github/workflows/ and every steps/<name>/action.yml.
const collectInterfaces = (root) => {
    const workflows = {};
    const wfDir = path.join(root, '.github', 'workflows');
    for (const f of fs.readdirSync(wfDir).sort()) {
        if (!f.endsWith('.yml') && !f.endsWith('.yaml')) continue;
        const iface = extractWorkflowInterface(fs.readFileSync(path.join(wfDir, f), 'utf8'), f);
        if (iface) workflows[f] = iface;
    }
    const steps = {};
    const stepsDir = path.join(root, 'steps');
    for (const d of fs.readdirSync(stepsDir).sort()) {
        const p = path.join(stepsDir, d, 'action.yml');
        if (!fs.existsSync(p)) continue;
        steps[d] = extractActionInterface(fs.readFileSync(p, 'utf8'), `steps/${d}/action.yml`);
    }
    return { workflows, steps };
};

module.exports = { extractWorkflowInterface, extractActionInterface, collectInterfaces };
