const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseJobs, findings, checkDirs } = require('./workflowGuards');

const check = (text) => findings(parseJobs(text, 'wf.yml'), 'wf.yml');

test('parses needs and if in every layout GitHub accepts', () => {
    const text = [
        'name: x',
        'on:',
        '  release:',
        '    types: [published]',
        'jobs:',
        '  a:',
        '    if: github.event_name == "workflow_dispatch"',
        '    runs-on: ubuntu-latest',
        '  b: # comment',
        '    needs: a',
        "    if: ${{ !cancelled() && needs.a.result != 'failure' }}",
        '  c:',
        '    needs: [a, b]',
        '    if: >',
        '      github.event_name == "release"',
        '      && always()',
        '    uses: ./x.yml',
        '  d:',
        '    needs:',
        '      - "b"',
        '      - c',
    ].join('\n');
    assert.deepEqual(parseJobs(text, 'wf.yml'), {
        a: { needs: [], if: 'github.event_name == "workflow_dispatch"' },
        b: { needs: ['a'], if: "${{ !cancelled() && needs.a.result != 'failure' }}" },
        c: { needs: ['a', 'b'], if: 'github.event_name == "release" && always()' },
        d: { needs: ['b', 'c'], if: null },
    });
});

test('reports a job without a status function after a guarded job with a skippable ancestor', () => {
    const text = [
        'jobs:',
        '  validate:',
        '    if: github.event_name == "workflow_dispatch"',
        '  deploy:',
        '    needs: validate',
        "    if: ${{ !cancelled() && needs.validate.result != 'failure' }}",
        '  e2e:',
        '    needs: deploy',
        '  complete:',
        '    needs: deploy',
        '    if: github.event_name == "release"',
        '  notify:',
        '    needs: [deploy, e2e]',
        "    if: ${{ always() && needs.e2e.result != 'skipped' }}",
    ].join('\n');
    assert.deepEqual(check(text), [
        { job: 'e2e', through: ['deploy'] },
        { job: 'complete', through: ['deploy'] },
    ]);
});

test('reports through a transitive guarded ancestor', () => {
    const text = [
        'jobs:',
        '  a:',
        '    if: github.event_name == "push"',
        '  b:',
        '    needs: a',
        '    if: ${{ !cancelled() }}',
        '  c:',
        '    needs: b',
        '    if: ${{ !cancelled() }}',
        '  d:',
        '    needs: c',
    ].join('\n');
    assert.deepEqual(check(text), [{ job: 'd', through: ['b', 'c'] }]);
});

test('accepts a plain chain, where a skipped parent means a skipped child', () => {
    const text = [
        'jobs:',
        '  test:',
        '    if: github.event_name == "pull_request"',
        '  deploy:',
        '    needs: test',
        '  smoke:',
        '    needs: deploy',
    ].join('\n');
    assert.deepEqual(check(text), []);
});

test('accepts a guarded job whose ancestors cannot be skipped', () => {
    const text = [
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '  deploy:',
        '    needs: build',
        '    if: ${{ !cancelled() }}',
        '  smoke:',
        '    needs: deploy',
    ].join('\n');
    assert.deepEqual(check(text), []);
});

test('rejects shapes it does not understand', () => {
    assert.throws(() => check('jobs:\n  a:\n    needs: *alias'), /unsupported needs value/);
    assert.throws(() => check('jobs:\n  a:\n    needs: [b'), /unsupported needs list/);
    assert.throws(() => check('jobs:\n  a:\n    needs: b'), /unknown job/);
    assert.throws(() => check('jobs:\n\ta:\n'), /tabs/);
    assert.throws(() => check('jobs:\n  - a\n'), /unexpected line under jobs/);
});

test('this repo and its examples are clean', () => {
    const root = path.join(__dirname, '..', '..');
    assert.deepEqual(checkDirs([path.join(root, '.github', 'workflows'), path.join(root, 'examples')]), []);
});
