// Extracts the changelog section for a version from a changesets-generated CHANGELOG
// (sections start with "## x.y.z"). Returns null when the version has no section.
const extractChangelogSection = (changelog, version) => {
    const versionChanges = changelog
        .split(/(?=## \d+\.\d+\.\d+)/g)
        .find((changes) => changes.startsWith(`## ${version}`));

    if (!versionChanges) {
        return null;
    }

    return versionChanges.replace(`## ${version}`, '').trim();
};

module.exports = { extractChangelogSection };
