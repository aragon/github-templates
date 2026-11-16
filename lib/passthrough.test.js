const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { extractActionInterface } = require('./workflowInterfaces');
const { MARKER, STEP_ID, readPin, sectionLines, splitEntries, render, listPassthroughs } = require('./passthrough');

const root = path.join(__dirname, '..');
const SHA = 'a'.repeat(40);

// The upstream shapes the generator has to copy faithfully: block-scalar descriptions with blank
// lines, a block-scalar default carrying an expression, an expression default, a `null` default,
// a deprecated input, and a composite upstream whose outputs carry their own `value:`.
const upstream = [
    "name: 'Example'",
    'description: Example upstream',
    'branding:',
    '  icon: play-circle',
    'inputs:',
    '  version:',
    '    default: "stable"',
    '    description: |',
    '      Version to install.',
    '',
    '      default: not-a-prop (block-scalar content)',
    '    required: false',
    '  # an upstream comment between entries',
    '  restore-keys:',
    '    default: |-',
    '      ${{ github.job }}-',
    '    required: false',
    '  token:',
    "    default: ${{ github.server_url == 'https://github.com' && github.token || '' }}",
    '  filter:',
    '    default: null',
    '  path:',
    '    description: Where',
    '    required: true',
    '  registry-url:',
    '    required: false',
    '    deprecationMessage: "Use registries instead."',
    '',
    'outputs:',
    '  cache-hit:',
    '    description: Whether the cache was hit',
    '    value: ${{ steps.inner.outputs.hit }}',
    '  path:',
    '    description: Installed path',
    '',
    'runs:',
    '  using: composite',
    '  steps:',
    '    - id: inner',
    '      run: echo',
    '      shell: bash',
    '',
].join('\n');

const renderExample = () => render({ dir: 'example', action: 'owner/example', sha: SHA, version: 'v1.2.3', upstream });

test('render copies the upstream inputs verbatim and wires every one of them through', () => {
    const text = renderExample();
    assert.ok(text.startsWith(`${MARKER}owner/example, as aragon/github-templates/steps/example.`));
    assert.ok(text.includes('      default: not-a-prop (block-scalar content)\n'), 'block-scalar content kept');
    assert.ok(text.includes('    default: |-\n      ${{ github.job }}-\n'), 'block-scalar default kept');
    assert.ok(!text.includes('an upstream comment'), 'entry-level comments dropped');
    assert.ok(text.includes(`      uses: owner/example@${SHA} # v1.2.3\n`));
    for (const name of ['version', 'restore-keys', 'token', 'filter', 'path']) {
        assert.ok(text.includes(`        ${name}: \${{ inputs.${name} }}\n`), `${name} passed through`);
    }
});

test('render leaves deprecated inputs out and names them in the header', () => {
    const text = renderExample();
    assert.ok(!/^ {2}registry-url:/m.test(text), 'deprecated input not declared');
    assert.ok(!text.includes('registry-url: ${{'), 'deprecated input not passed');
    assert.ok(text.includes('): registry-url.\n'), 'deprecated input named in the header');
});

test('render maps every output to the wrapped step, replacing an upstream value', () => {
    const text = renderExample();
    assert.ok(text.includes(`    value: \${{ steps.${STEP_ID}.outputs.cache-hit }}\n`));
    assert.ok(text.includes(`    value: \${{ steps.${STEP_ID}.outputs.path }}\n`));
    assert.ok(!text.includes('steps.inner'), 'the upstream composite wiring is dropped');
});

test('the rendered interface equals the upstream one minus the deprecated inputs', () => {
    const expected = extractActionInterface(upstream, 'upstream');
    delete expected.inputs['registry-url'];
    assert.deepEqual(extractActionInterface(renderExample(), 'rendered'), expected);
});

test('render is stable: an unchanged upstream renders the same file', () => {
    assert.equal(renderExample(), renderExample());
});

test('an upstream without inputs or outputs renders no empty sections', () => {
    const text = render({ dir: 'bare', action: 'owner/bare', sha: SHA, version: 'v1', upstream: 'name: bare\nruns:\n  using: node24\n' });
    assert.ok(!text.includes('inputs:'));
    assert.ok(!text.includes('outputs:'));
    assert.ok(!text.includes('with:'));
});

test('shapes the copy cannot be sure of are hard errors', () => {
    const at = (lines) => () => render({ dir: 'x', action: 'owner/x', sha: SHA, version: 'v1', upstream: lines.join('\n') });
    assert.throws(at(['inputs:', '    four-space-entry:', '      required: false']), /unexpected indentation/);
    assert.throws(at(['inputs:', "  'quoted':", '    required: false']), /unexpected line in inputs/);
    assert.throws(at(['outputs:', '  out:', '    value: |', '      ${{ steps.a.outputs.b }}']), /block-scalar value/);
});

test('readPin wants exactly one SHA pin with its version comment', () => {
    const pinned = `    - id: upstream\n      uses: actions/cache/restore@${SHA} # v6.1.0\n`;
    assert.deepEqual(readPin(pinned, 'f'), { action: 'actions/cache/restore', sha: SHA, version: 'v6.1.0' });
    assert.throws(() => readPin('      uses: actions/cache@v6\n', 'f'), /found 0/);
    assert.throws(() => readPin(`      uses: actions/cache@${SHA}\n`, 'f'), /found 0/);
    assert.throws(() => readPin(`${pinned}${pinned}`, 'f'), /found 2/);
});

test('sectionLines stops at the next top-level key and an absent section is empty', () => {
    assert.deepEqual(sectionLines('inputs:\n  a:\n    required: true\n\nruns:\n  using: x\n', 'inputs'),
        ['  a:', '    required: true']);
    assert.deepEqual(sectionLines('runs:\n  using: x\n', 'outputs'), []);
    assert.deepEqual(splitEntries([], 'f', 'inputs'), []);
});

// Offline consistency of the committed wrappers. Fidelity to the upstream at each pin needs the
// network and runs separately (`npm run passthrough:check`, in CI).
test('every committed pass-through wrapper passes each input and output straight through', () => {
    const wrappers = listPassthroughs(root);
    assert.ok(wrappers.length > 0, 'expected pass-through wrappers under steps/');
    for (const { dir, text } of wrappers) {
        const file = `steps/${dir}/action.yml`;
        readPin(text, file);
        const iface = extractActionInterface(text, file);
        const lines = text.split('\n');
        const withAt = lines.indexOf('      with:');
        const withBlock = withAt === -1 ? [] : lines.slice(withAt + 1)
            .filter((line) => /^ {8}\S/.test(line)).map((line) => line.trim());
        assert.deepEqual(withBlock, Object.keys(iface.inputs)
            .sort((a, b) => text.indexOf(`\n  ${a}:`) - text.indexOf(`\n  ${b}:`))
            .map((name) => `${name}: \${{ inputs.${name} }}`), `${file}: with: must pass every input as-is`);
        for (const entry of splitEntries(sectionLines(text, 'outputs'), file, 'outputs')) {
            assert.ok(entry.lines.includes(`    value: \${{ steps.${STEP_ID}.outputs.${entry.name} }}`),
                `${file}: output ${entry.name} must map to the wrapped step`);
        }
    }
});
