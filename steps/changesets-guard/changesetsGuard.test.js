const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { findOffendingChangesets } = require('./changesetsGuard');

const createFixture = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'changesets-guard-'));
    const changesetDir = path.join(directory, '.changeset');
    fs.mkdirSync(changesetDir);
    fs.writeFileSync(path.join(changesetDir, 'README.md'), '# Changesets');
    fs.writeFileSync(
        path.join(directory, 'release-scopes.yml'),
        'app:\n  - "@aragon/app"\nassistant:\n  - "@aragon/assistant"\n',
    );
    return { directory, changesetDir };
};

test('without a scope, any pending changeset offends (README.md excluded)', () => {
    const { directory, changesetDir } = createFixture();

    try {
        assert.deepEqual(findOffendingChangesets({ changesetDir }), []);

        const changeset = path.join(changesetDir, 'wild-pandas-dance.md');
        fs.writeFileSync(changeset, '---\n"@aragon/app": patch\n---\n\nfix: thing\n');
        assert.deepEqual(findOffendingChangesets({ changesetDir }), [changeset]);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('with a scope, only changesets naming in-scope packages offend', () => {
    const { directory, changesetDir } = createFixture();
    const scopesFile = path.join(directory, 'release-scopes.yml');

    try {
        const appChangeset = path.join(changesetDir, 'app-change.md');
        const assistantChangeset = path.join(changesetDir, 'assistant-change.md');
        fs.writeFileSync(appChangeset, '---\n"@aragon/app": minor\n---\n\nfeat: app\n');
        fs.writeFileSync(
            assistantChangeset,
            '---\n"@aragon/assistant": patch\n---\n\nfix: assistant\n',
        );

        assert.deepEqual(findOffendingChangesets({ scope: 'app', scopesFile, changesetDir }), [
            appChangeset,
        ]);
        assert.deepEqual(
            findOffendingChangesets({ scope: 'assistant', scopesFile, changesetDir }),
            [assistantChangeset],
        );
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('a missing .changeset directory never offends', () => {
    assert.deepEqual(findOffendingChangesets({ changesetDir: '/nonexistent/.changeset' }), []);
});
