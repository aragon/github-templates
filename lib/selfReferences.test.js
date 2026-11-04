// Every reference this repo makes to itself (a reusable workflow calling a composite action or
// another workflow, an example caller) must use the moving major tag the consumers reference, and
// one and the same major: a `v1` consumer must never run `v2` code, and a stray `@main` would make
// the released line follow unreleased changes. See README "Versioning".

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const sources = ['.github/workflows', 'examples'];
const reference = /aragon\/github-templates\/[\w./-]+@(\S+)/g;

const collectReferences = () => {
    const found = [];
    for (const directory of sources) {
        const files = fs.readdirSync(path.join(root, directory)).filter((file) => file.endsWith('.yml'));
        for (const file of files) {
            const text = fs.readFileSync(path.join(root, directory, file), 'utf8');
            for (const [, ref] of text.matchAll(reference)) {
                found.push({ file: `${directory}/${file}`, ref });
            }
        }
    }
    return found;
};

test('every self-reference uses one moving major tag', () => {
    const references = collectReferences();
    assert.ok(references.length > 0, 'expected the reusable workflows and examples to reference this repo');

    const offenders = references.filter(({ ref }) => !/^v\d+$/.test(ref));
    assert.deepEqual(offenders, [], 'self-references on something other than a major tag (vN)');

    const majors = [...new Set(references.map(({ ref }) => ref))];
    assert.equal(majors.length, 1, `self-references spread over several majors: ${majors.join(', ')}`);
});
