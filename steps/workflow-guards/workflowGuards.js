// Finds jobs that GitHub skips by surprise. A job with a skipped job anywhere in its `needs`
// chain is skipped too, unless its own `if` carries a status function (`always()`,
// `!cancelled()`, `failure()`) that replaces the implicit `success()` check. The trap: an
// ancestor P carries such a guard, so P runs even though one of P's ancestors A was skipped —
// and every descendant of P without a guard of its own is then skipped, no matter that P
// succeeded. app-production.yml of aragon/app shipped 1.41.0 without smoke tests this way:
// `validate` (dispatch only) → `deploy` (`!cancelled()`) → `e2e` (no `if`).
//
// Reported: a job J without a status function in its `if` that has an ancestor P which carries
// one and has a skippable ancestor itself (a job with an `if`, or with a skippable ancestor).
// A job whose skip is *consistent* — a plain chain where a skipped parent means a skipped
// child — is not reported.
//
// Vendored strict-subset YAML reading, same policy as lib/flatYaml.js: no dependency, and a hard
// error on shapes it does not recognize rather than a silent misparse. It reads exactly the job
// layout GitHub Actions workflows use: `jobs:` at column 0, job ids at 2 spaces, `needs:` / `if:`
// at 4 spaces (scalar, flow list, block list or block scalar).

const fs = require('node:fs');
const path = require('node:path');

const STATUS_FN_RE = /\b(always|cancelled|failure)\s*\(\s*\)/;
const JOB_RE = /^  ([A-Za-z0-9_-]+):\s*(#.*)?$/;
const PROP_RE = /^    (needs|if):(.*)$/;

const indentOf = (line) => line.length - line.trimStart().length;
const isSkippable = (line) => line.trim() === '' || line.trim().startsWith('#');

const stripQuotes = (raw) => {
    const v = raw.trim();
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
        return v.slice(1, -1);
    }
    return v;
};

// Lines deeper than `indent`, starting at `start`; returns [lines, nextIndex].
const collectBlock = (lines, start, indent) => {
    const block = [];
    let i = start;
    for (; i < lines.length; i++) {
        if (isSkippable(lines[i])) continue;
        if (indentOf(lines[i]) <= indent) break;
        block.push(lines[i].trim());
    }
    return [block, i];
};

const parseNeeds = (raw, lines, index, file, job) => {
    const value = raw.replace(/\s+#.*$/, '').trim();
    if (value === '') {
        const [block, next] = collectBlock(lines, index + 1, 4);
        const needs = block.map((line) => {
            const m = line.match(/^-\s+(.+?)\s*$/);
            if (!m) throw new Error(`${file}: job "${job}": unsupported needs item "${line}"`);
            return stripQuotes(m[1]);
        });
        return [needs, next];
    }
    if (value.startsWith('[')) {
        if (!value.endsWith(']')) throw new Error(`${file}: job "${job}": unsupported needs list "${value}"`);
        const needs = value
            .slice(1, -1)
            .split(',')
            .map((item) => stripQuotes(item))
            .filter((item) => item !== '');
        return [needs, index + 1];
    }
    if (/^[&*!{|>]/.test(value)) throw new Error(`${file}: job "${job}": unsupported needs value "${value}"`);
    return [[stripQuotes(value)], index + 1];
};

const parseIf = (raw, lines, index) => {
    const value = raw.trim();
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
        const [block, next] = collectBlock(lines, index + 1, 4);
        return [block.join(' '), next];
    }
    return [stripQuotes(value), index + 1];
};

// Parses a workflow file into { jobId: { needs: [], if: string | null } }.
const parseJobs = (text, file) => {
    if (text.includes('\t')) throw new Error(`${file}: tabs are not allowed`);
    const lines = text.split('\n');
    const jobs = {};
    let inJobs = false;
    let current = null;
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (isSkippable(line)) {
            i++;
            continue;
        }
        const indent = indentOf(line);
        if (indent === 0) {
            inJobs = /^jobs:\s*(#.*)?$/.test(line);
            current = null;
            i++;
            continue;
        }
        if (!inJobs) {
            i++;
            continue;
        }
        if (indent === 2) {
            const m = line.match(JOB_RE);
            if (!m) throw new Error(`${file}: unexpected line under jobs: "${line.trim()}"`);
            current = m[1];
            if (Object.hasOwn(jobs, current)) throw new Error(`${file}: duplicate job "${current}"`);
            jobs[current] = { needs: [], if: null };
            i++;
            continue;
        }
        const prop = current ? line.match(PROP_RE) : null;
        if (!prop) {
            i++;
            continue;
        }
        if (prop[1] === 'needs') {
            const [needs, next] = parseNeeds(prop[2], lines, i, file, current);
            jobs[current].needs = needs;
            i = next;
        } else {
            const [condition, next] = parseIf(prop[2], lines, i);
            jobs[current].if = condition;
            i = next;
        }
    }
    return jobs;
};

const hasStatusFn = (condition) => condition !== null && STATUS_FN_RE.test(condition);

// Every job reachable through `needs`, nearest first.
const ancestorsOf = (jobs, id, file) => {
    const seen = new Set();
    const stack = [...jobs[id].needs];
    while (stack.length > 0) {
        const next = stack.pop();
        if (seen.has(next)) continue;
        if (!Object.hasOwn(jobs, next)) throw new Error(`${file}: job "${id}" needs unknown job "${next}"`);
        seen.add(next);
        stack.push(...jobs[next].needs);
    }
    return [...seen];
};

const findings = (jobs, file) => {
    const skippable = (id) => jobs[id].if !== null || ancestorsOf(jobs, id, file).some((a) => jobs[a].if !== null);
    const result = [];
    for (const id of Object.keys(jobs)) {
        if (hasStatusFn(jobs[id].if)) continue;
        const guardedAncestors = ancestorsOf(jobs, id, file).filter(
            (p) => hasStatusFn(jobs[p].if) && ancestorsOf(jobs, p, file).some((a) => skippable(a)),
        );
        if (guardedAncestors.length === 0) continue;
        result.push({ job: id, through: guardedAncestors.sort() });
    }
    return result;
};

const checkFile = (file) => findings(parseJobs(fs.readFileSync(file, 'utf8'), file), file);

const listWorkflows = (dir) =>
    fs
        .readdirSync(dir)
        .filter((name) => /\.ya?ml$/.test(name))
        .map((name) => path.join(dir, name))
        .sort();

const checkDirs = (dirs) => {
    const report = [];
    for (const dir of dirs) {
        for (const file of listWorkflows(dir)) {
            for (const finding of checkFile(file)) report.push({ file, ...finding });
        }
    }
    return report;
};

const main = () => {
    const dirs = (process.env.WORKFLOW_DIRS || '.github/workflows')
        .split(/\s+/)
        .filter((dir) => dir !== '');
    const report = checkDirs(dirs);
    for (const { file, job, through } of report) {
        const guarded = through.map((p) => `"${p}"`).join(', ');
        console.error(
            `::error file=${file}::job "${job}" has no status function in its \`if\`, but ${guarded} ` +
                `run(s) on a guard even when an earlier job was skipped — GitHub then skips "${job}" ` +
                `regardless. Add \`if: \${{ !cancelled() && needs.<job>.result == 'success' }}\`.`,
        );
    }
    if (report.length > 0) process.exit(1);
    console.log(`workflow-guards: ${dirs.join(' ')} — no unguarded job after a guarded one`);
};

if (require.main === module) main();

module.exports = { parseJobs, findings, checkFile, checkDirs };
