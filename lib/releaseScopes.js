const fs = require('node:fs');
const { parse } = require('./flatYaml');

// Reads a consumer repo's central package→release-scope mapper (.github/release-scopes.yml by
// convention): each scope is the set of packages one release flow versions together. Consumed by
// compute-version (scope → changesets --ignore inversion) and the release-finalize changeset guard.
const readReleaseScopes = (scopesPath = '.github/release-scopes.yml') =>
    parse(fs.readFileSync(scopesPath, 'utf8'));

const resolveReleaseScope = (scopeName, scopesPath) => {
    const packages = readReleaseScopes(scopesPath)[scopeName];

    if (!Array.isArray(packages) || packages.length === 0) {
        throw new Error(`Unknown release scope: ${scopeName}`);
    }

    return packages;
};

module.exports = { readReleaseScopes, resolveReleaseScope };
