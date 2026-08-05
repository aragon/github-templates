// Extracts the changelog section for a version out of a CHANGELOG produced by either version
// engine, so read-changelog works for both:
//   - changesets:            '## 1.2.0'
//   - conventional-changelog '## [1.2.0](…/compare/v1.1.0...v1.2.0) (2026-01-31)', and '# [2.0.0](…)'
//     (the semantic-release path)  for a major.
// Returns null when the version has no section.

// A version reaches these patterns as data ('.' and, for prereleases, '+'/'-' are metacharacters).
const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Section boundaries: a heading at the start of a line, its version optionally wrapped in a link.
const SECTION_SPLIT_RE = /^(?=#{1,3} +\[?\d+\.\d+\.\d+)/gm;

// The heading has to end AT the requested version. Matched as a prefix instead, '## 1.0.10' answers
// a lookup for '1.0.1' — returning the wrong release's notes, with the stray '0' left where the
// heading was stripped — and '## 1.0.0-rc.1' answers one for '1.0.0'; compute-version accepts such
// prerelease versions. The trailing '.*' swallows the rest of the heading line so a
// conventional-changelog compare link and date don't lead the notes.
const headingPattern = (version) =>
    new RegExp(`^#{1,3} +\\[?${escapeForRegExp(version)}\\]?(?![\\w.+-]).*(?:\\r?\\n|$)`);

const extractChangelogSection = (changelog, version) => {
    const heading = headingPattern(version);
    const versionChanges = changelog
        .split(SECTION_SPLIT_RE)
        .find((changes) => heading.test(changes));

    if (!versionChanges) {
        return null;
    }

    return versionChanges.replace(heading, '').trim();
};

module.exports = { extractChangelogSection };
