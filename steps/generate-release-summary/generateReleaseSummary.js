const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { parse: parseFlatYaml } = require(path.join(__dirname, '..', '..', 'lib', 'flatYaml.js'));
const { setOutput } = require(path.join(__dirname, '..', '..', 'lib', 'output.js'));

// Run git via execFile (no shell) so user-controlled inputs (BASE_REF, tag names)
// cannot be interpreted as shell metacharacters. Inputs are still validated below.
const runGit = (args, options = {}) => {
    try {
        return execFileSync('git', args, {
            cwd: options.cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: 64 * 1024 * 1024,
        })
            .toString()
            .trim();
    } catch (error) {
        console.error(`Failed to run git ${args.join(' ')}`, error.message);
        return '';
    }
};

// Allow only characters valid in the git refs we accept here: tags (including
// monorepo-style '@scope/pkg@1.2.3'), SHAs, branch names.
const GIT_REF_RE = /^[A-Za-z0-9@._/-]{1,255}$/;
const isSafeGitRef = (ref) => typeof ref === 'string' && GIT_REF_RE.test(ref);

// owner/repo used to linkify PR numbers. Validate strictly; fall back to a non-linking
// placeholder if the env value is malformed so we never build a broken/injected URL.
const resolveRepo = () => {
    const repo = process.env.REPO || '';
    return /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : '';
};

// Latest release-boundary tag by version (not reachability): 'v*' for single-package repos,
// '@scope/pkg@*' for monorepo package tag namespaces.
const detectLatestTag = (tagGlob, git = runGit) => {
    const out = git(['tag', '--list', tagGlob, '--sort=-v:refname']);
    return out.split('\n')[0]?.trim() ?? '';
};

// Named path filter from the consumer's central mapper (.github/filters.yml by convention).
const readPathFilter = (filterPath, filterName) => {
    const filters = parseFlatYaml(require('node:fs').readFileSync(filterPath, 'utf8'));
    const patterns = filters?.[filterName];

    if (
        !Array.isArray(patterns) ||
        patterns.length === 0 ||
        patterns.some((pattern) => typeof pattern !== 'string')
    ) {
        throw new Error(`Path filter "${filterName}" is missing or invalid in ${filterPath}.`);
    }

    return patterns;
};

const commitMatchesPathFilter = (commit, patterns, git = runGit) => {
    const parents = git(['show', '-s', '--format=%P', commit])
        .split(' ')
        .filter(Boolean);
    const files =
        parents.length === 0
            ? git(['show', '--pretty=format:', '--name-only', commit])
            : git(['diff', '--name-only', parents[0], commit]);

    // path.matchesGlob needs Node >= 22.5 — fine on the setup action's default (24), but a
    // consumer pointing node-version-file at an older runtime would break here.
    return files
        .split('\n')
        .filter(Boolean)
        .some((file) => patterns.some((pattern) => path.matchesGlob(file, pattern)));
};

// Any release commit is dropped, not just this package's: in a monorepo, other flows' release
// commits (e.g. "Release @aragon/assistant@0.2.0") touch paths shared with this filter's scope
// and would otherwise leak into the summary as "Other Changes". The default covers the commit
// styles of the templates' own release-start ("chore(release): …") and the app monorepo
// ("Release @scope/pkg@x.y.z") plus plain "Release v1.2.3".
const DEFAULT_RELEASE_COMMIT_RE = /^(Release|chore\(release\):) (@[\w./-]+@|v)?\d+\.\d+\.\d+/;

// A PR landed as a merge commit carries its PR title in the commit body; the subject only says
// "Merge pull request #N from org/branch". Surface the title so the entry reads like a squash.
const resolveCommitTitle = (commit, subject, git = runGit) => {
    const merge = subject.match(/^Merge pull request #(\d+)\b/);
    if (!merge) {
        return subject;
    }

    const bodyTitle = git(['show', '-s', '--format=%b', commit])
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean);

    return bodyTitle ? `${bodyTitle} (#${merge[1]})` : subject;
};

// Mainline commits since the release boundary. The boundary is the previous release tag itself:
// everything the tag already contains is excluded, while PRs merged to main during the previous
// release window (after its branch was cut, before it merged) stay in — they ship with THIS
// release, even though they sit below the previous release's integration commit on the mainline.
const collectScopedCommits = ({
    baseRef,
    headRef = 'HEAD',
    patterns = null,
    releaseCommitRe = DEFAULT_RELEASE_COMMIT_RE,
    git = runGit,
}) => {
    const range = baseRef ? `${baseRef}..${headRef}` : headRef;
    const log = git(['log', '--first-parent', range, '--pretty=format:%H%x00%s']);

    return (
        log
            .split('\n')
            .filter(Boolean)
            .map((line) => {
                const [commit, subject] = line.split('\0');
                return { commit, subject };
            })
            // Resolve titles before filtering: a release PR merged with GitHub's default
            // merge subject only reveals its "Release …" title after resolution, and
            // releaseCommitRe must see that title to drop the commit.
            .map(({ commit, subject }) => ({
                commit,
                subject: resolveCommitTitle(commit, subject, git),
            }))
            .filter(
                ({ commit, subject }) =>
                    !releaseCommitRe.test(subject) &&
                    (patterns == null || commitMatchesPathFilter(commit, patterns, git)),
            )
    );
};

// Linear state types that mean a ticket is finished; anything else (triage, backlog,
// unstarted, started) counts as open and is surfaced in the summary's warning section.
const CLOSED_STATE_TYPES = new Set(['completed', 'canceled']);

// Linear personal API keys (lin_api_…) are sent bare; OAuth2 access tokens need a
// 'Bearer ' prefix or the API returns 401. Accept either, and an already-prefixed value.
const linearAuthorization = (token) =>
    token.startsWith('lin_api_') || token.startsWith('Bearer ') ? token : `Bearer ${token}`;

// Helper to fetch Linear issue details
const fetchLinearIssue = async (issueId, token) => {
    if (!token) {
        console.error('No Linear API token provided.');
        return null;
    }

    try {
        const response = await fetch('https://api.linear.app/graphql', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: linearAuthorization(token),
            },
            body: JSON.stringify({
                query: `
          query Issue($id: String!) {
            issue(id: $id) {
              title
              url
              state {
                name
                type
              }
            }
          }
        `,
                variables: { id: issueId },
            }),
        });

        const data = await response.json();
        return data?.data?.issue ? { ...data.data.issue, id: issueId } : null;
    } catch (err) {
        console.error(`Failed to fetch Linear issue ${issueId}:`, err);
        return null;
    }
};

const generateSummary = async ({ core }) => {
    const linearToken = process.env.LINEAR_API_TOKEN;
    const tagGlob = process.env.TAG_GLOB || 'v*';
    const pathFilter = process.env.PATH_FILTER || '';
    const pathPatterns = (process.env.PATH_PATTERNS || '')
        .split('\n')
        .map((pattern) => pattern.trim())
        .filter(Boolean);
    const filtersFile = process.env.FILTERS_FILE || '.github/filters.yml';
    const repo = resolveRepo();
    let baseRef = process.env.BASE_REF;

    if (!isSafeGitRef(tagGlob.replace(/\*/g, 'x'))) {
        throw new Error(`Refusing unsafe tag glob: ${tagGlob}`);
    }

    let releaseCommitRe = DEFAULT_RELEASE_COMMIT_RE;
    if (process.env.RELEASE_COMMIT_PATTERN) {
        try {
            releaseCommitRe = new RegExp(process.env.RELEASE_COMMIT_PATTERN);
        } catch (error) {
            throw new Error(`Invalid release-commit-pattern: ${error.message}`);
        }
    }

    if (baseRef) {
        if (!isSafeGitRef(baseRef)) {
            throw new Error(`Refusing unsafe BASE_REF: ${baseRef}`);
        }
    } else {
        // The boundary is the previous release tag itself, used directly as the range base.
        // Tags created on release branches are handled too: `tag..HEAD` excludes exactly what
        // the tag contains, keeping release-window commits in the next summary.
        baseRef = detectLatestTag(tagGlob);
        if (baseRef) {
            console.log(`Auto-detected release boundary: ${baseRef}`);
        } else {
            console.log(`No ${tagGlob} tags found. Treating this as the first release.`);
        }
    }

    if (pathPatterns.length > 0 && pathFilter) {
        throw new Error("'path-filter' and 'path-patterns' are mutually exclusive.");
    }
    let patterns = null;
    if (pathPatterns.length > 0) {
        patterns = pathPatterns;
    } else if (pathFilter) {
        patterns = readPathFilter(filtersFile, pathFilter);
    }

    const range = baseRef ? `${baseRef}..HEAD` : 'HEAD';
    console.log(
        `Generating release summary for range ${range}${pathFilter ? ` with path filter "${pathFilter}"` : ''}.`,
    );

    const commits = collectScopedCommits({ baseRef, patterns, releaseCommitRe });

    const categories = {
        features: [],
        fixes: [],
        others: [],
    };

    const linearRegex = /([a-zA-Z]{2,}-\d+)/g;
    const issuesFound = new Set();
    const openIssues = [];

    for (const { subject: line } of commits) {
        const lower = line.toLowerCase();
        const linearMatches = line.match(linearRegex);

        let category = 'others';
        if (lower.startsWith('feat')) {
            category = 'features';
        } else if (lower.startsWith('fix')) {
            category = 'fixes';
        }

        // Clean line prefix
        let cleanLine = line
            .replace(/^(feat|fix|chore|docs|style|refactor|perf|test)(\(.*\))?:/, '')
            .trim();

        // Linkify PR numbers (#123 -> [#123](url)) when we know the repo.
        if (repo) {
            cleanLine = cleanLine.replace(
                /\(#(\d+)\)/g,
                `([#$1](https://github.com/${repo}/pull/$1))`,
            );
        }

        // Extract linear issues
        let additionalInfo = '';
        if (linearMatches && linearToken) {
            const addedIssues = new Set();
            for (const issueId of linearMatches) {
                if (issuesFound.has(issueId) || addedIssues.has(issueId)) {
                    continue;
                }
                issuesFound.add(issueId);
                addedIssues.add(issueId);

                const issue = await fetchLinearIssue(issueId, linearToken);
                if (issue) {
                    additionalInfo += ` [${issueId}: ${issue.title}](${issue.url})`;
                    if (issue.state && !CLOSED_STATE_TYPES.has(issue.state.type)) {
                        openIssues.push(issue);
                    }
                } else {
                    additionalInfo += ` ${issueId}`;
                }
            }
        }

        const entry = additionalInfo ? `${cleanLine} —${additionalInfo}` : cleanLine;
        categories[category].push(entry);
    }

    // 2. Format Output
    let summary = '';

    // Tickets referenced by this release that are not completed/canceled yet. Placed
    // first so reviewers see un-QA'd work before merging; the release is never blocked.
    if (openIssues.length > 0) {
        summary += '## ⚠️ Open tickets\n';
        openIssues.forEach(
            (issue) =>
                (summary += `- [${issue.id}: ${issue.title}](${issue.url}) — ${issue.state.name}\n`),
        );
        summary += '\n';
    }

    if (categories.features.length > 0) {
        summary += '## Features\n';
        categories.features.forEach((item) => (summary += `- ${item}\n`));
        summary += '\n';
    }

    if (categories.fixes.length > 0) {
        summary += '## Fixes\n';
        categories.fixes.forEach((item) => (summary += `- ${item}\n`));
        summary += '\n';
    }

    if (categories.others.length > 0) {
        summary += '## Other Changes\n';
        categories.others.forEach((item) => (summary += `- ${item}\n`));
        summary += '\n';
    }

    if (!summary) {
        summary = 'No significant changes detected.';
    }

    core.setOutput('summary', summary);
    console.log('Release summary generated.');
};

module.exports = {
    collectScopedCommits,
    commitMatchesPathFilter,
    detectLatestTag,
    generateSummary,
    linearAuthorization,
    readPathFilter,
    resolveCommitTitle,
    runGit,
};

// Standalone runner
if (require.main === module) {
    generateSummary({ core: { setOutput } }).catch((err) => {
        console.error('Failed to generate release summary:', err);
        process.exit(1);
    });
}
