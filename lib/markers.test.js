const test = require('node:test');
const assert = require('node:assert/strict');
const {
    extractReleaseActor,
    extractSlackTs,
    releaseActorMarker,
    slackTsMarker,
    stripMarkers,
} = require('./markers');

const body = [
    '## Summary',
    '',
    '- a change',
    '',
    '<!-- slack_ts: 1700000000.123456 -->',
    '<!-- release_actor: octocat -->',
    '',
].join('\n');

test('extractSlackTs reads the marker and rejects malformed values', () => {
    assert.equal(extractSlackTs(body), '1700000000.123456');
    assert.equal(extractSlackTs('<!--slack_ts:1700000000.123456-->'), '1700000000.123456');
    assert.equal(extractSlackTs('<!-- slack_ts: 1700000000.1 -->'), '');
    assert.equal(extractSlackTs('<!-- slack_ts: abc -->'), '');
    assert.equal(extractSlackTs(''), '');
    assert.equal(extractSlackTs(undefined), '');
});

test('extractReleaseActor reads the marker', () => {
    assert.equal(extractReleaseActor(body), 'octocat');
    assert.equal(extractReleaseActor('<!-- release_actor: bad actor -->'), '');
    assert.equal(extractReleaseActor(null), '');
});

test('stripMarkers removes marker lines and trailing whitespace only', () => {
    assert.equal(stripMarkers(body), '## Summary\n\n- a change');
    assert.equal(stripMarkers('text <!-- slack_ts: 1700000000.123456 --> kept'), 'text <!-- slack_ts: 1700000000.123456 --> kept');
    assert.equal(stripMarkers('a\r\n<!-- slack_ts: 1700000000.123456 -->\r\nb'), 'a\r\nb');
    assert.equal(stripMarkers(''), '');
});

test('markers round-trip through the parsers', () => {
    const text = `notes\n\n${slackTsMarker('1700000000.123456')}\n${releaseActorMarker('octocat')}\n`;
    assert.equal(extractSlackTs(text), '1700000000.123456');
    assert.equal(extractReleaseActor(text), 'octocat');
    assert.equal(stripMarkers(text), 'notes');
});
