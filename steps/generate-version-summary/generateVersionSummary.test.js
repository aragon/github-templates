const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateSummary } = require('./generateVersionSummary');

const gitEnvironment = {
    ...process.env,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_SYSTEM: os.devNull,
};

const git = (repository, args) =>
    execFileSync(
        'git',
        ['-c', 'user.name=Version Summary Test', '-c', 'user.email=version-summary@example.com', ...args],
        { cwd: repository, stdio: ['ignore', 'pipe', 'pipe'], env: gitEnvironment },
    );

const createPackage = (repository, dir, name, version, changelog) => {
    const target = path.join(repository, dir);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name, version }));
    fs.writeFileSync(path.join(target, 'CHANGELOG.md'), changelog);
};

const createRepository = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'version-summary-'));
    git(directory, ['init', '--initial-branch=main']);
    return directory;
};

const captureSummary = () => {
    const outputs = {};
    return {
        outputs,
        core: {
            setOutput: (name, value) => {
                outputs[name] = value;
            },
        },
    };
};

test('single-package mode: renders the section when package.json is dirty', () => {
    const repository = createRepository();

    try {
        createPackage(repository, '.', 'my-lib', '1.0.0', '## 1.0.0\n\n- initial\n');
        git(repository, ['add', '.']);
        git(repository, ['commit', '-m', 'initial']);

        const clean = captureSummary();
        generateSummary({ core: clean.core, cwd: repository });
        assert.equal(clean.outputs.summary, 'No packages bumped.');

        // Simulate `changeset version`: bump the manifest and prepend the new section.
        createPackage(
            repository,
            '.',
            'my-lib',
            '1.1.0',
            '## 1.1.0\n\n- feat: new thing\n\n## 1.0.0\n\n- initial\n',
        );

        const bumped = captureSummary();
        generateSummary({ core: bumped.core, cwd: repository });
        assert.equal(bumped.outputs.summary, '## my-lib@1.1.0\n\n- feat: new thing');
    } finally {
        fs.rmSync(repository, { recursive: true, force: true });
    }
});

test('single-package mode: handles a missing CHANGELOG gracefully', () => {
    const repository = createRepository();

    try {
        createPackage(repository, '.', 'my-lib', '1.0.0', '');
        fs.rmSync(path.join(repository, 'CHANGELOG.md'));
        fs.writeFileSync(path.join(repository, '.gitignore'), '');
        git(repository, ['add', '.']);
        git(repository, ['commit', '-m', 'initial']);
        fs.writeFileSync(
            path.join(repository, 'package.json'),
            JSON.stringify({ name: 'my-lib', version: '1.0.1' }),
        );

        const { core, outputs } = captureSummary();
        generateSummary({ core, cwd: repository });
        assert.equal(outputs.summary, '## my-lib@1.0.1\n\nNo changes.');
    } finally {
        fs.rmSync(repository, { recursive: true, force: true });
    }
});
