const fs = require('node:fs');
const nodePath = require('node:path');
const { extractChangelogSection } = require(
    nodePath.join(__dirname, '..', '..', 'lib', 'changelog.js'),
);

module.exports = async ({ core }) => {
    const { version, path } = process.env;

    // Check if version and path are provided
    if (!(version && path)) {
        core.setFailed('Missing required environment variables: version or path');
        return;
    }

    // Check if the changelog file exists
    if (!fs.existsSync(path)) {
        core.setFailed(`Changelog file not found at path: ${path}`);
        return;
    }

    try {
        core.info(`Reading changes in version ${version}.`);

        const changelog = fs.readFileSync(path, {
            encoding: 'utf8',
            flag: 'r',
        });

        const parsedChanges = extractChangelogSection(changelog, version);

        if (parsedChanges == null) {
            core.warning(`No changes found for version ${version} in the changelog.`);
            core.setOutput('changes', 'No changes.');
            return;
        }

        core.info(`Setting output: ${parsedChanges}.`);
        core.setOutput('changes', parsedChanges);
    } catch (error) {
        core.setFailed(error);
    }
};
