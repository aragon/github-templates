// Backward-compatibility gate for the public interface of this repo's reusable workflows and
// composite actions. Runs in CI on every PR and push to main (via the standard `node --test`
// globs), comparing the interfaces extracted from the YAML sources against the committed
// snapshot in contracts/interfaces.json, plus the known consumer call shapes in
// contracts/consumers.json. See contracts/README.md for the policy and how to update.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { collectInterfaces } = require('./workflowInterfaces');
const { diffContracts } = require('./contractDiff');

const root = path.join(__dirname, '..');
const snapshot = require('../contracts/interfaces.json');
const consumers = require('../contracts/consumers.json');
const current = collectInterfaces(root);

test('no breaking change to any published workflow/action interface', () => {
    const { breaking } = diffContracts(snapshot, current);
    assert.deepEqual(breaking, [], [
        'Breaking interface changes detected against contracts/interfaces.json:',
        ...breaking.map((b) => `  - ${b}`),
        'Existing consumer repos calling these workflows/actions would break.',
        'If the break is intentional, run: ALLOW_BREAKING=1 npm run contracts:update',
        'and call out the migration in the PR description.',
    ].join('\n'));
});

test('every interface addition is registered in contracts/interfaces.json', () => {
    const { additions } = diffContracts(snapshot, current);
    assert.deepEqual(additions, [], [
        'New interface surface is not yet registered in contracts/interfaces.json:',
        ...additions.map((a) => `  - ${a}`),
        'Additions are backward-compatible; register them so future removals are caught.',
        'Run: npm run contracts:update',
    ].join('\n'));
});

test('known consumer call shapes remain valid against the current interfaces', () => {
    for (const consumer of consumers.consumers) {
        const where = `${consumer.repo} (${consumer.workflowFile})`;
        const iface = current.workflows[consumer.calls];
        assert.ok(iface, `${where}: called workflow ${consumer.calls} no longer exists as workflow_call`);

        for (const input of consumer.inputs) {
            assert.ok(iface.inputs[input],
                `${where}: passes input "${input}", which ${consumer.calls} no longer defines — `
                + 'the caller run would fail validation with "Invalid input"');
        }
        for (const secret of consumer.secrets) {
            assert.ok(iface.secrets[secret],
                `${where}: passes secret "${secret}", which ${consumer.calls} no longer defines`);
        }
        for (const [name, spec] of Object.entries(iface.inputs)) {
            if (spec.required) {
                assert.ok(consumer.inputs.includes(name),
                    `${where}: ${consumer.calls} now requires input "${name}", which this consumer does not pass`);
            }
        }
        for (const [name, spec] of Object.entries(iface.secrets)) {
            if (spec.required) {
                assert.ok(consumer.secrets.includes(name),
                    `${where}: ${consumer.calls} now requires secret "${name}", which this consumer does not pass`);
            }
        }
    }
});
