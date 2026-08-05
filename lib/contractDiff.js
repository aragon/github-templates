// Compares two interface snapshots (see lib/workflowInterfaces.js) and classifies every
// difference as either BREAKING for existing callers or a benign ADDITION that just needs to be
// registered in contracts/interfaces.json. Shared by lib/backcompat.test.js (which fails CI on
// breaking changes) and lib/updateContracts.js (which refuses to bake them into the snapshot
// without ALLOW_BREAKING=1). The rules, from the caller's point of view:
//
// - Removing an input/secret makes every caller that passes it fail validation ("Invalid
//   input, X is not defined in the referenced workflow") — breaking. For composite actions the
//   runner only warns, but the value silently stops being honored — worse, so same rule.
// - Flipping optional -> required (or adding a NEW required input/secret) makes callers that
//   omit it fail — breaking. Loosening required -> optional is fine.
// - Changing a default (including adding/removing one) silently changes behavior for every
//   caller that omits the input — breaking.
// - Changing an input's type changes how the caller's value is coerced — breaking.
// - Removing an output breaks callers that read it — breaking.
// - Everything else (new workflow/action, new optional input, new output) is an addition.

const eq = (a, b) => (a ?? null) === (b ?? null);

const diffEntryMaps = (oldMap, newMap, label, opts, breaking, additions) => {
    for (const name of Object.keys(oldMap)) {
        const o = oldMap[name];
        const n = newMap[name];
        if (!n) {
            breaking.push(`${label} "${name}" was removed`);
            continue;
        }
        if (!o.required && n.required) breaking.push(`${label} "${name}" went from optional to required`);
        if (opts.type && !eq(o.type, n.type)) breaking.push(`${label} "${name}" changed type: ${o.type ?? '(none)'} -> ${n.type ?? '(none)'}`);
        if (opts.default && !eq(o.default, n.default)) {
            breaking.push(`${label} "${name}" changed default: ${JSON.stringify(o.default ?? null)} -> ${JSON.stringify(n.default ?? null)}`);
        }
    }
    for (const name of Object.keys(newMap)) {
        if (oldMap[name]) continue;
        const n = newMap[name];
        // workflow_call enforces `required` even when a default exists, so a new required
        // input/secret always breaks existing callers — new interface must be optional.
        if (n.required) {
            breaking.push(`new ${label} "${name}" is required — existing callers that do not pass it break`);
        } else {
            additions.push(`new ${label} "${name}"`);
        }
    }
};

const diffOutputs = (oldList, newList, label, breaking, additions) => {
    for (const name of oldList) {
        if (!newList.includes(name)) breaking.push(`${label} output "${name}" was removed`);
    }
    for (const name of newList) {
        if (!oldList.includes(name)) additions.push(`new ${label} output "${name}"`);
    }
};

const diffContracts = (snapshot, current) => {
    const breaking = [];
    const additions = [];

    for (const file of Object.keys(snapshot.workflows)) {
        const o = snapshot.workflows[file];
        const n = current.workflows[file];
        if (!n) {
            breaking.push(`reusable workflow ${file} was removed (or is no longer workflow_call)`);
            continue;
        }
        diffEntryMaps(o.inputs, n.inputs, `${file} input`, { type: true, default: true }, breaking, additions);
        diffEntryMaps(o.secrets, n.secrets, `${file} secret`, {}, breaking, additions);
        diffOutputs(o.outputs, n.outputs, file, breaking, additions);
    }
    for (const file of Object.keys(current.workflows)) {
        if (!snapshot.workflows[file]) additions.push(`new reusable workflow ${file}`);
    }

    for (const step of Object.keys(snapshot.steps)) {
        const o = snapshot.steps[step];
        const n = current.steps[step];
        if (!n) {
            breaking.push(`composite action steps/${step} was removed`);
            continue;
        }
        diffEntryMaps(o.inputs, n.inputs, `steps/${step} input`, { default: true }, breaking, additions);
        diffOutputs(o.outputs, n.outputs, `steps/${step}`, breaking, additions);
    }
    for (const step of Object.keys(current.steps)) {
        if (!snapshot.steps[step]) additions.push(`new composite action steps/${step}`);
    }

    return { breaking, additions };
};

module.exports = { diffContracts };
