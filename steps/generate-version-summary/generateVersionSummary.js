const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { extractChangelogSection } = require(path.join(__dirname, '..', '..', 'lib', 'changelog.js'));
const { resolveReleaseScope } = require(path.join(__dirname, '..', '..', 'lib', 'releaseScopes.js'));
const { setOutput } = require(path.join(__dirname, '..', '..', 'lib', 'output.js'));

// Builds a release-PR summary from the CHANGELOG entries written by `changeset version`: one
// "## <package>@<version>" section per bumped package. Runs after `changeset version` and before
// the release commit, so a bumped package is simply one whose package.json has an uncommitted
// change. (Its sibling, generateReleaseSummary.js, builds the commit-history summary used by
// flows that describe a release in terms of merged PRs instead.)

const run = (command, args, cwd) =>
    execFileSync(command, args, { cwd, maxBuffer: 64 * 1024 * 1024 })
        .toString()
        .trim();

const renderPackage = (packagePath) => {
    const { name, version } = JSON.parse(
        fs.readFileSync(path.join(packagePath, 'package.json'), 'utf8'),
    );
    const changelogPath = path.join(packagePath, 'CHANGELOG.md');
    const changelog = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '';
    const changes = extractChangelogSection(changelog, version) ?? 'No changes.';

    return `## ${name}@${version}\n\n${changes}`;
};

const isBumped = (packagePath, cwd) =>
    run('git', ['status', '--porcelain', '--', path.join(packagePath, 'package.json')], cwd);

const generateSummary = ({ core, packageNames = null, packageDir = '.', cwd = process.cwd() }) => {
    let bumpedPaths;

    if (packageNames == null) {
        // Single-package mode: one section from <package-dir>, no pnpm workspace required.
        const packagePath = path.resolve(cwd, packageDir);
        bumpedPaths = isBumped(packagePath, cwd) ? [packagePath] : [];
    } else {
        // Workspace mode: map the requested package names to their directories.
        const workspaces = JSON.parse(run('pnpm', ['m', 'ls', '--json', '--depth', '-1'], cwd));
        bumpedPaths = packageNames
            .map((name) => workspaces.find((workspace) => workspace.name === name))
            .filter((workspace) => workspace != null)
            .filter((workspace) => isBumped(workspace.path, cwd))
            .map((workspace) => workspace.path);
    }

    const sections = bumpedPaths.map(renderPackage);
    core.setOutput('summary', sections.join('\n\n') || 'No packages bumped.');
};

module.exports = { generateSummary };

// Standalone runner: SCOPE names a release scope in the scopes file, PACKAGES is an explicit
// newline-separated package-name list, PACKAGE_DIR selects single-package mode when both are empty.
if (require.main === module) {
    const { SCOPE, SCOPES_FILE, PACKAGES, PACKAGE_DIR } = process.env;

    let packageNames = null;
    if (SCOPE && PACKAGES) {
        console.error("'scope' and 'packages' are mutually exclusive.");
        process.exit(1);
    } else if (SCOPE) {
        packageNames = resolveReleaseScope(SCOPE, SCOPES_FILE || undefined);
    } else if (PACKAGES) {
        packageNames = PACKAGES.split('\n')
            .map((name) => name.trim())
            .filter(Boolean);
    }

    try {
        generateSummary({
            core: { setOutput },
            packageNames,
            packageDir: PACKAGE_DIR || '.',
        });
    } catch (err) {
        console.error('Failed to generate version summary:', err);
        process.exit(1);
    }
}
