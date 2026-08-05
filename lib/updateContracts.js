// Regenerates contracts/interfaces.json from the current workflow/action sources.
//
//   npm run contracts:update                  — registers additions; REFUSES breaking changes
//   ALLOW_BREAKING=1 npm run contracts:update — consciously bakes in a breaking change (the
//                                               snapshot diff then shows it in PR review)
//
// See contracts/README.md for what counts as breaking.

const fs = require('node:fs');
const path = require('node:path');
const { collectInterfaces } = require('./workflowInterfaces');
const { diffContracts } = require('./contractDiff');

const root = path.join(__dirname, '..');
const file = path.join(root, 'contracts', 'interfaces.json');

const current = collectInterfaces(root);
const snapshot = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : { workflows: {}, steps: {} };

const { breaking, additions } = diffContracts(snapshot, current);

if (breaking.length > 0 && !process.env.ALLOW_BREAKING) {
    console.error('Refusing to update contracts/interfaces.json: breaking interface changes detected.');
    for (const b of breaking) console.error(`  - ${b}`);
    console.error('If intentional, re-run with ALLOW_BREAKING=1 and describe the migration in your PR.');
    process.exit(1);
}

if (breaking.length === 0 && additions.length === 0) {
    console.log('contracts/interfaces.json is already up to date.');
    process.exit(0);
}

fs.writeFileSync(file, `${JSON.stringify(current, null, 4)}\n`);
for (const a of additions) console.log(`registered: ${a}`);
for (const b of breaking) console.log(`BREAKING (accepted via ALLOW_BREAKING=1): ${b}`);
console.log('contracts/interfaces.json updated.');
