const fs = require('node:fs');
const path = require('node:path');
const { resolveReleaseScope } = require(path.join(__dirname, '..', '..', 'lib', 'releaseScopes.js'));

// Fails when pending changesets that belong to the release are still present at the release
// commit — someone added a changeset after `changeset version` consumed the batch, so the tagged
// build would silently ship an unreleased entry. With a scope, only changesets naming an
// in-scope package trip the guard: other lineages' changesets are expected to survive the merge.

const listChangesets = (changesetDir) => {
    if (!fs.existsSync(changesetDir)) {
        return [];
    }
    return fs
        .readdirSync(changesetDir)
        .filter((file) => file.endsWith('.md') && file !== 'README.md')
        .map((file) => path.join(changesetDir, file));
};

const findOffendingChangesets = ({ scope = '', scopesFile, changesetDir = '.changeset' }) => {
    const files = listChangesets(changesetDir);

    if (!scope) {
        return files;
    }

    const packages = resolveReleaseScope(scope, scopesFile);
    // Changeset frontmatter lists one package per line: "@scope/name": patch
    const packageRes = packages.map(
        (name) => new RegExp(`^"${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}":`, 'm'),
    );

    return files.filter((file) => {
        const content = fs.readFileSync(file, 'utf8');
        return packageRes.some((re) => re.test(content));
    });
};

module.exports = { findOffendingChangesets };

if (require.main === module) {
    const { SCOPE, SCOPES_FILE } = process.env;

    const offending = findOffendingChangesets({
        scope: SCOPE || '',
        scopesFile: SCOPES_FILE || undefined,
    });

    if (offending.length > 0) {
        console.error(
            `Pending changesets found at the release commit (added after 'changeset version'?):\n${offending.join('\n')}`,
        );
        process.exit(1);
    }
    console.log('No pending changesets for this release.');
}
