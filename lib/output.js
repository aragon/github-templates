const crypto = require('node:crypto');
const fs = require('node:fs');

// Appends a step output to $GITHUB_OUTPUT with a random heredoc delimiter, so a value can never
// terminate its own block and smuggle extra outputs (same hardening as credential-retrieval).
const setOutput = (name, value) => {
    const outputFile = process.env.GITHUB_OUTPUT;
    const text = String(value);

    if (!outputFile) {
        console.log(`(no GITHUB_OUTPUT) ${name}=${text}`);
        return;
    }

    const delimiter = `EOF_${crypto.randomBytes(16).toString('hex')}`;
    if (text.includes(delimiter)) {
        throw new Error(`Output value for "${name}" collides with the heredoc delimiter.`);
    }
    fs.appendFileSync(outputFile, `${name}<<${delimiter}\n${text}\n${delimiter}\n`);
};

module.exports = { setOutput };
