// gha.sh is bash, so every case runs it the way a composite step does: source the library, call the
// function, read the workflow commands it printed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

// The script goes in on stdin and the library is sourced by its relative name from cwd, so no path
// of this checkout ends up on the command line.
const runBash = (script, env = {}) =>
    execFileSync('bash', ['-s'], {
        input: `set -euo pipefail\n. ./gha.sh\n${script}`,
        cwd: __dirname,
        encoding: 'utf8',
        env: { ...process.env, ...env },
    });

test('masks values long enough to be secrets, line by line', () => {
    const output = runBash(`gha_mask 'ghp_0123456789abcdef' TOKEN`);
    assert.equal(output, '::add-mask::ghp_0123456789abcdef\n');

    const multiline = runBash(`gha_mask 'first-line-of-a-key\nsecond-line-of-a-key' SSH_KEY`);
    assert.deepEqual(multiline.trim().split('\n'), [
        '::add-mask::first-line-of-a-key',
        '::add-mask::second-line-of-a-key',
    ]);
});

test('warns instead of masking a value too short to be a secret', () => {
    const output = runBash(`gha_mask 'app-next' SENTRY_PROJECT`);

    assert.match(output, /^::warning::Not masking 'SENTRY_PROJECT' — shorter than 12 characters\./);
    assert.doesNotMatch(output, /add-mask/);
    // The warning must not leak the value it declined to mask.
    assert.doesNotMatch(output, /app-next/);
});

test('names the value only when the caller passes one', () => {
    assert.match(runBash(`gha_mask 'app-next'`), /Not masking a value — shorter than/);
});

test('applies the threshold per line, so a long secret with a short line keeps its masks', () => {
    const output = runBash(`gha_mask 'short\nlong-enough-to-mask' KEY`);

    assert.deepEqual(output.trim().split('\n'), [
        "::warning::Not masking 'KEY' — shorter than 12 characters. Non-secret config does not belong in a secret store: masking it corrupts every output that contains it.",
        '::add-mask::long-enough-to-mask',
    ]);
});

test('takes the threshold from GHA_MASK_MIN_LENGTH when the caller sets one', () => {
    assert.equal(runBash(`gha_mask 'app-next' NAME`, { GHA_MASK_MIN_LENGTH: '4' }), '::add-mask::app-next\n');
    assert.match(runBash(`gha_mask 'ghp_0123456789abcdef' NAME`, { GHA_MASK_MIN_LENGTH: '64' }), /^::warning::/);
});

test('skips blank lines without warning about them', () => {
    assert.equal(runBash(`gha_mask '\n\nlong-enough-to-mask' KEY`), '::add-mask::long-enough-to-mask\n');
    assert.equal(runBash(`gha_mask '' KEY`), '');
});

test('gha_set_multiline writes a heredoc block that a value cannot terminate', () => {
    const output = runBash(
        `file=$(mktemp)\ngha_set_multiline "$file" SECRETS 'line-one\nline-two'\ncat "$file"`
    );
    const [header, ...rest] = output.trimEnd().split('\n');
    const delimiter = header.replace('SECRETS<<', '');

    assert.match(delimiter, /^ghadelim_[0-9a-f]{32}$/);
    assert.deepEqual(rest, ['line-one', 'line-two', delimiter]);
});

test('gha_set_multiline refuses a value containing the generated delimiter', () => {
    // A value carrying the delimiter would close the block early and let the rest be read as further
    // keys. The delimiter is random per call, so the collision is forced by stubbing `od`.
    const output = runBash(
        `od() { echo deadbeef; }\nfile=$(mktemp)\n` +
            `gha_set_multiline "$file" SECRETS 'value with ghadelim_deadbeef inside' 2>&1 || echo "exit=$?"\n` +
            `cat "$file"`
    );

    assert.match(output, /^::error::Value for 'SECRETS' collides with the generated delimiter\n/);
    assert.match(output, /exit=1/);
    // Nothing is appended when the guard trips.
    assert.doesNotMatch(output, /SECRETS<</);
});
