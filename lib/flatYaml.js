// Strict parser for the one YAML shape the shared actions read from consumer repos: a flat map
// of `name:` keys to string lists (.github/release-scopes.yml, .github/filters.yml). Vendored so
// actions need no node_modules at runtime; anything outside that shape is a hard error rather
// than a silent misparse — consumers with richer YAML must pass explicit list inputs instead.

const KEY_RE = /^([A-Za-z0-9_-]+):\s*(#.*)?$/;
const ITEM_RE = /^\s+-\s+(.+?)\s*$/;
const DOUBLE_QUOTED_RE = /^"([^"]*)"\s*(#.*)?$/;
const SINGLE_QUOTED_RE = /^'([^']*)'\s*(#.*)?$/;

const parseItemValue = (raw, line) => {
    if (raw.startsWith('"') || raw.startsWith("'")) {
        const match = raw.match(raw.startsWith('"') ? DOUBLE_QUOTED_RE : SINGLE_QUOTED_RE);
        if (!match) {
            throw new Error(`Malformed quoted list item: ${line}`);
        }
        return match[1];
    }

    // Unquoted scalar: cut an inline comment, then reject YAML syntax this parser does not
    // implement (anchors, aliases, tags, flow/block collections) instead of misreading it.
    const value = raw.replace(/\s+#.*$/, '').trim();
    if (!value) {
        throw new Error(`Empty list item: ${line}`);
    }
    if (/^[&*!{}[\]|>]/.test(value)) {
        throw new Error(`Unsupported YAML syntax in list item: ${line}`);
    }
    return value;
};

const parse = (text) => {
    if (typeof text !== 'string') {
        throw new Error('flatYaml.parse expects a string.');
    }

    const result = {};
    let currentKey = null;

    for (const line of text.split('\n')) {
        if (!line.trim() || line.trim().startsWith('#')) {
            continue;
        }
        if (line.includes('\t')) {
            throw new Error(`Tabs are not allowed: ${line}`);
        }

        const keyMatch = line.match(KEY_RE);
        if (keyMatch) {
            currentKey = keyMatch[1];
            if (Object.hasOwn(result, currentKey)) {
                throw new Error(`Duplicate key: ${currentKey}`);
            }
            result[currentKey] = [];
            continue;
        }

        const itemMatch = line.match(ITEM_RE);
        if (itemMatch) {
            if (!currentKey) {
                throw new Error(`List item without a key: ${line}`);
            }
            result[currentKey].push(parseItemValue(itemMatch[1], line));
            continue;
        }

        throw new Error(`Unsupported YAML (only a flat "name:" → string-list map is allowed): ${line}`);
    }

    return result;
};

module.exports = { parse };
