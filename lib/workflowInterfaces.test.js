const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { extractWorkflowInterface, extractActionInterface, collectInterfaces } = require('./workflowInterfaces');

test('extracts a workflow_call interface: inputs with block descriptions, secrets, outputs', () => {
    const text = [
        'name: Example',
        '',
        'on:',
        '  workflow_call:',
        '    inputs:',
        '      env:',
        '        description: "Target environment"',
        '        required: true',
        '        type: string',
        '      domain:',
        '        description: |',
        '          Multi-line description that must be skipped, even when a line of it',
        '          looks like a prop, e.g.:',
        '          default: not-a-real-default',
        '        required: false',
        '        type: string',
        '        default: ""',
        '      submodules:',
        '        required: false',
        '        type: string',
        '        default: "false"',
        '    secrets:',
        '      OP_SERVICE_ACCOUNT_TOKEN:',
        '        description: "token"',
        '        required: true',
        '    outputs:',
        '      deploymentUrl:',
        '        description: "url"',
        '        value: ${{ jobs.deploy.outputs.deploymentUrl }}',
        '',
        'jobs:',
        '  deploy:',
        '    runs-on: ubuntu-latest',
        '    outputs:',
        '      deploymentUrl: ${{ steps.deploy.outputs.deploymentUrl }}',
    ].join('\n');

    assert.deepEqual(extractWorkflowInterface(text, 'example.yml'), {
        inputs: {
            domain: { required: false, type: 'string', default: '' },
            env: { required: true, type: 'string' },
            submodules: { required: false, type: 'string', default: 'false' },
        },
        secrets: { OP_SERVICE_ACCOUNT_TOKEN: { required: true } },
        outputs: ['deploymentUrl'],
    });
});

test('a workflow without workflow_call has no caller-facing interface', () => {
    const text = ['name: CI', '', 'on:', '  pull_request:', '  push:', '    branches: [main]'].join('\n');
    assert.equal(extractWorkflowInterface(text, 'ci.yml'), null);
});

test('a job-level outputs block never bleeds into the workflow_call interface', () => {
    const text = [
        'on:',
        '  workflow_call:',
        '    inputs:',
        '      env:',
        '        required: true',
        '        type: string',
        'jobs:',
        '  x:',
        '    outputs:',
        '      leaked: value',
    ].join('\n');
    assert.deepEqual(extractWorkflowInterface(text, 'x.yml').outputs, []);
});

test('fails hard on an interface section shape it does not understand', () => {
    const text = [
        'on:',
        '  workflow_call:',
        '    inputs:',
        '      env: {required: true, type: string}',
    ].join('\n');
    assert.throws(() => extractWorkflowInterface(text, 'x.yml'), /unexpected line in interface section/);
});

test('extracts a composite action interface, keeping expression defaults verbatim', () => {
    const text = [
        'name: "Setup"',
        'description: "Checks out the repository."',
        '',
        'inputs:',
        '  repository:',
        '    description: "The repository to checkout"',
        '    required: false',
        '    default: ${{ github.repository }}',
        '  install:',
        '    required: false',
        '    default: "true"',
        '',
        'runs:',
        '  using: "composite"',
        '  steps:',
        '    - name: Checkout repository',
        '      uses: actions/checkout@abc',
    ].join('\n');

    assert.deepEqual(extractActionInterface(text, 'steps/setup/action.yml'), {
        inputs: {
            install: { required: false, default: 'true' },
            repository: { required: false, default: '${{ github.repository }}' },
        },
        outputs: [],
    });
});

test('collectInterfaces parses every real workflow and action in this repo without errors', () => {
    const { workflows, steps } = collectInterfaces(path.join(__dirname, '..'));
    // Spot-check against interfaces that certainly exist; the full set lives in
    // contracts/interfaces.json and is exercised by backcompat.test.js.
    assert.ok(workflows['deploy-vercel.yml'], 'deploy-vercel.yml should expose a workflow_call interface');
    assert.equal(workflows['deploy-vercel.yml'].inputs.env.required, true);
    assert.ok(steps.setup, 'steps/setup should expose an interface');
    assert.equal(steps.setup.inputs.install.default, 'true');
    assert.ok(!workflows['ci.yml'], 'ci.yml is not workflow_call and must not appear');
});
