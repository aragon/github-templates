const test = require('node:test');
const assert = require('node:assert/strict');
const { markdownToMrkdwn, truncateText, truncationMark } = require('./slackNotify');

test('converts markdown bold to mrkdwn and leaves mrkdwn bold alone', () => {
    assert.equal(
        markdownToMrkdwn('⚠️ **Contains DB migrations** — roll-forward only'),
        '⚠️ *Contains DB migrations* — roll-forward only',
    );
    assert.equal(markdownToMrkdwn('*Release — Started*'), '*Release — Started*');
    assert.equal(markdownToMrkdwn('a ** b ** c'), 'a ** b ** c');
});

test('converts links, headers and list items', () => {
    assert.equal(
        markdownToMrkdwn('## Features\n- [APP-1: title](https://x.y/z)'),
        '*Features*\n• <https://x.y/z|APP-1: title>',
    );
});

test('converts star bullets and nested items, and leaves bold alone', () => {
    assert.equal(
        markdownToMrkdwn('* **APP-1332**: repair tool ([c91d3a5](https://x.y/c))\n  * nested\n*Header*'),
        '• *APP-1332*: repair tool (<https://x.y/c|c91d3a5>)\n  • nested\n*Header*',
    );
});

test('keeps text within the limit unchanged', () => {
    assert.equal(truncateText('a\nb', 3), 'a\nb');
});

test('cuts over-limit text at the last line break that fits and marks it', () => {
    const line = '• <https://x.y/z|APP-1: title>';
    const text = Array.from({ length: 200 }, () => line).join('\n');
    const truncated = truncateText(text);

    assert.ok(truncated.length <= 4000);
    assert.ok(truncated.endsWith('\n… (truncated)'));
    const kept = truncated.slice(0, -'\n… (truncated)'.length).split('\n');
    assert.ok(kept.every((keptLine) => keptLine === line));
});

test('keeps a short closing paragraph after the cut', () => {
    const list = Array.from({ length: 200 }, () => '• item').join('\n');
    const truncated = truncateText(`${list}\n\n⚠️ *Contains DB migrations*\n`, 100);

    assert.ok(truncated.length <= 100);
    assert.ok(truncated.endsWith('\n… (truncated)\n\n⚠️ *Contains DB migrations*'));
});

test('hard-cuts a single over-limit line', () => {
    const truncated = truncateText('x'.repeat(5000));

    assert.equal(truncated.length, 4000);
    assert.ok(truncated.endsWith('\n… (truncated)'));
});

test('marks the cut with a link to the full text when given one', () => {
    const mark = truncationMark('<https://x.y/pull/1|the PR>');
    assert.equal(mark, '\n… the rest is in <https://x.y/pull/1|the PR>');
    assert.equal(truncationMark(''), '\n… (truncated)');

    const list = Array.from({ length: 200 }, () => '• item').join('\n');
    const truncated = truncateText(list, 100, mark);
    assert.ok(truncated.length <= 100);
    assert.ok(truncated.endsWith(mark));
});
