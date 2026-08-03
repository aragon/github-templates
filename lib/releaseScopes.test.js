const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { readReleaseScopes, resolveReleaseScope } = require('./releaseScopes');

const withScopesFile = (content, callback) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-scopes-'));
    const scopesPath = path.join(directory, 'release-scopes.yml');

    try {
        fs.writeFileSync(scopesPath, content);
        callback(scopesPath);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
};

test('resolves a scope to its package list', () => {
    const content = [
        '# packages each release flow versions together',
        'app:',
        '  - "@aragon/app"',
        '  - "@aragon/assistant-chat"',
        'assistant:',
        '  - "@aragon/assistant"',
    ].join('\n');

    withScopesFile(content, (scopesPath) => {
        assert.deepEqual(readReleaseScopes(scopesPath), {
            app: ['@aragon/app', '@aragon/assistant-chat'],
            assistant: ['@aragon/assistant'],
        });
        assert.deepEqual(resolveReleaseScope('app', scopesPath), [
            '@aragon/app',
            '@aragon/assistant-chat',
        ]);
    });
});

test('rejects unknown and empty scopes', () => {
    withScopesFile('app:\n  - "@aragon/app"\nempty:\n', (scopesPath) => {
        assert.throws(() => resolveReleaseScope('missing', scopesPath), /Unknown release scope/);
        assert.throws(() => resolveReleaseScope('empty', scopesPath), /Unknown release scope/);
    });
});
