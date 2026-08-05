const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('./flatYaml');

test('parses a flat map of string lists with comments and both quote styles', () => {
    const text = [
        '# central mapper',
        '',
        'app:',
        '  - "@aragon/app"',
        "  - '@aragon/assistant-chat'",
        '  - apps/app/** # inline comment',
        '',
        'assistant: # trailing comment on key',
        '  - "apps/assistant/**"',
    ].join('\n');

    assert.deepEqual(parse(text), {
        app: ['@aragon/app', '@aragon/assistant-chat', 'apps/app/**'],
        assistant: ['apps/assistant/**'],
    });
});

test('parses an empty list for a key without items', () => {
    assert.deepEqual(parse('app:\nassistant:\n  - "x"'), {
        app: [],
        assistant: ['x'],
    });
});

test('rejects everything outside the flat name → string-list shape', () => {
    assert.throws(() => parse('app: [a, b]'), /Unsupported YAML/);
    assert.throws(() => parse('app: value'), /Unsupported YAML/);
    assert.throws(() => parse('app:\n  nested:\n    - x'), /Unsupported YAML/);
    assert.throws(() => parse('- orphan item'), /Unsupported YAML/);
    assert.throws(() => parse('app:\n  - x\n  - x\napp:\n  - y'), /Duplicate key/);
    assert.throws(() => parse('app:\n\t- x'), /Tabs/);
    assert.throws(() => parse('app:\n  - &anchor value'), /Unsupported YAML syntax/);
    assert.throws(() => parse('app:\n  - "unterminated'), /Malformed quoted/);
    assert.throws(() => parse('app:\n  -   '), /Empty list item/);
});
