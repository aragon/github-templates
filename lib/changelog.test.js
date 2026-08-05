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

test('matches the heading at the version, not as a prefix', () => {
    // Newest-first ordering puts 1.0.10 above 1.0.1; a prefix match would answer with its section.
    const collidingPatches = [
        '## 1.0.10',
        '',
        '- content of 1.0.10',
        '',
        '## 1.0.1',
        '',
        '- content of 1.0.1',
    ].join('\n');

    assert.equal(extractChangelogSection(collidingPatches, '1.0.1'), '- content of 1.0.1');
    assert.equal(extractChangelogSection(collidingPatches, '1.0.10'), '- content of 1.0.10');

    const withPrerelease = [
        '## 1.0.0-rc.1',
        '',
        '- release candidate',
        '',
        '## 1.0.0',
        '',
        '- final',
    ].join('\n');

    assert.equal(extractChangelogSection(withPrerelease, '1.0.0'), '- final');
    assert.equal(extractChangelogSection(withPrerelease, '1.0.0-rc.1'), '- release candidate');
});

test('extracts conventional-changelog sections (linked version + date heading)', () => {
    const conventional = [
        '# Changelog',
        '',
        '## [0.33.0](https://github.com/aragon/app-backend/compare/v0.32.0...v0.33.0) (2026-07-27)',
        '',
        '### Features',
        '',
        '* add a thing ([3e08fcd](https://github.com/aragon/app-backend/commit/3e08fcd))',
        '',
        '# [0.32.0](https://github.com/aragon/app-backend/compare/v0.31.0...v0.32.0) (2026-07-01)',
        '',
        '### Bug Fixes',
        '',
        '* fix a thing',
    ].join('\n');

    assert.equal(
        extractChangelogSection(conventional, '0.33.0'),
        '### Features\n\n* add a thing ([3e08fcd](https://github.com/aragon/app-backend/commit/3e08fcd))',
    );
    // Majors get an h1 heading from the conventionalcommits preset.
    assert.equal(extractChangelogSection(conventional, '0.32.0'), '### Bug Fixes\n\n* fix a thing');
});
