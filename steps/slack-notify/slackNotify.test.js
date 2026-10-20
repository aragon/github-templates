const test = require('node:test');
const assert = require('node:assert/strict');
const { markdownToMrkdwn } = require('./slackNotify');

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
