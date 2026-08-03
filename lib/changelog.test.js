const test = require('node:test');
const assert = require('node:assert/strict');
const { extractChangelogSection } = require('./changelog');

const changelog = [
    '# @aragon/app',
    '',
    '## 1.2.0',
    '',
    '### Minor Changes',
    '',
    '- feat: new thing',
    '',
    '## 1.1.0',
    '',
    '- older entry',
].join('\n');

test('extracts the section matching the version', () => {
    assert.equal(
        extractChangelogSection(changelog, '1.2.0'),
        '### Minor Changes\n\n- feat: new thing',
    );
    assert.equal(extractChangelogSection(changelog, '1.1.0'), '- older entry');
});

test('returns null when the version has no section', () => {
    assert.equal(extractChangelogSection(changelog, '9.9.9'), null);
    assert.equal(extractChangelogSection('', '1.0.0'), null);
});
