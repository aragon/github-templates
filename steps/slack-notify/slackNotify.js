const https = require('node:https');
const fs = require('node:fs');

// Slack message timestamps are strictly `seconds.microseconds` with exactly 6
// fractional digits (e.g. `1234567890.123456`). Reject anything else before
// writing to GITHUB_OUTPUT so a poisoned API response cannot inject extra keys.
const isValidSlackTs = (ts) =>
    typeof ts === 'string' && /^\d{10}\.\d{6}$/.test(ts);

// Convert GitHub Markdown to Slack mrkdwn
const markdownToMrkdwn = (text) => {
    return (
        text
            // Convert links: [text](url) -> <url|text>
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>')
            // Convert bold: **text** -> *text* (mrkdwn renders ** literally)
            .replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, '*$1*')
            // Convert headers: ## Header -> *Header*
            .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
            // Convert list items: - item -> • item
            .replace(/^-\s+/gm, '• ')
    );
};

// chat.update rejects `text` over 4,000 characters (`msg_too_long`), and a long
// release changelog gets there. The body is cut at the last line break that fits,
// so no mrkdwn link is split, and the cut is marked. A short closing paragraph
// survives the cut: release flags such as the DB-migration warning live there.
const MAX_TEXT_LENGTH = 4000;
const MAX_KEPT_TAIL_LENGTH = 500;
const TRUNCATION_MARK = '\n… (truncated)';

const truncateText = (text, limit = MAX_TEXT_LENGTH) => {
    if (text.length <= limit) {
        return text;
    }
    const trimmed = text.trimEnd();
    if (trimmed.length <= limit) {
        return trimmed;
    }
    const tailStart = trimmed.lastIndexOf('\n\n');
    const tail =
        tailStart > 0 && trimmed.length - tailStart <= MAX_KEPT_TAIL_LENGTH
            ? trimmed.slice(tailStart)
            : '';
    const room = limit - TRUNCATION_MARK.length - tail.length;
    const lineEnd = trimmed.lastIndexOf('\n', room);
    return `${trimmed.slice(0, lineEnd > 0 ? lineEnd : room)}${TRUNCATION_MARK}${tail}`;
};

// Sanitize untrusted values before logging to avoid log-forging/control chars.
const sanitizeForLog = (value) =>
    String(value ?? '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/[\x00-\x1F\x7F]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

// Posts a new message, or edits an existing one when `updateTs` is set
// (chat.update) — used to reflect lifecycle status (started → cancelled →
// completed) in the release's head message rather than only as thread replies.
const sendMessage = (token, channel, text, threadTs, updateTs) =>
    new Promise((resolve, reject) => {
        const isUpdate = Boolean(updateTs);
        const payload = isUpdate
            ? { channel, ts: updateTs, text }
            : { channel, text };
        if (!isUpdate && threadTs) {
            payload.thread_ts = threadTs;
        }

        const data = JSON.stringify(payload);

        const options = {
            hostname: 'slack.com',
            port: 443,
            path: isUpdate ? '/api/chat.update' : '/api/chat.postMessage',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                'Content-Length': Buffer.byteLength(data),
            },
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const parsed = JSON.parse(body);
                        if (parsed.ok) {
                            resolve(parsed.ts);
                        } else {
                            reject(
                                new Error(`Slack API error: ${parsed.error}`),
                            );
                        }
                    } catch (e) {
                        reject(new Error('Failed to parse Slack response', e));
                    }
                } else {
                    reject(
                        new Error(`Slack request failed: ${res.statusCode}`),
                    );
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(data);
        req.end();
    });

module.exports = { isValidSlackTs, markdownToMrkdwn, truncateText };

// Standalone runner
if (require.main === module) {
    const token = process.env.SLACK_BOT_TOKEN;
    const channel = process.env.SLACK_CHANNEL_ID;
    const threadTs = process.env.SLACK_THREAD_TS;
    const updateTs = process.env.SLACK_UPDATE_TS;

    // Get message from args (3rd arg)
    const message = process.argv[2];

    if (!(token && channel)) {
        console.log('Skipping Slack notification: Missing token or channel.');
        process.exit(0);
    }

    if (!message) {
        console.error('Missing message argument.');
        process.exit(1);
    }

    console.log('Sending Slack notification.');

    const text = markdownToMrkdwn(message);
    const fittedText = truncateText(text);
    if (fittedText.length < text.trimEnd().length) {
        console.log(
            `::warning::Slack message truncated from ${text.length} to ${fittedText.length} characters.`,
        );
    }

    sendMessage(token, channel, fittedText, threadTs, updateTs)
        .then((ts) => {
            if (!isValidSlackTs(ts)) {
                console.error('Slack returned an invalid ts.');
                process.exit(1);
            }
            console.log('Message sent.');
            const outputFile = process.env.GITHUB_OUTPUT;
            if (outputFile) {
                fs.appendFileSync(outputFile, `ts=${ts}\n`);
            } else {
                console.log(`::set-output name=ts::${ts}`);
            }
        })
        .catch((error) => {
            const safeErrorMessage = sanitizeForLog(error?.message ?? error);
            console.error(`Failed to send Slack message: ${safeErrorMessage}`);
            process.exit(1);
        });
}
