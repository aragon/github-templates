// The release markers a flow leaves in a PR body and carries into the GitHub Release body:
//   <!-- slack_ts: 1700000000.123456 -->   the Slack thread every later flow replies into
//   <!-- release_actor: login -->          who the release is attributed to (a refresh must not
//                                          re-attribute it to the last pusher)
// One parser for every place that reads them (extract-slack-ts, resolve-slack-thread, the
// cancel/complete flows that rewrite the Slack head message without the markers).

const SLACK_TS_RE = /<!--\s*slack_ts:\s*([0-9]{10}\.[0-9]{6})\s*-->/;
const RELEASE_ACTOR_RE = /<!--\s*release_actor:\s*([A-Za-z0-9_.-]+)\s*-->/;
const MARKER_LINE_RE = /^[ \t]*<!--\s*(?:slack_ts|release_actor):[^>]*-->[ \t]*(?:\r?\n|$)/gm;

const extractSlackTs = (body) => {
    const match = String(body ?? '').match(SLACK_TS_RE);
    return match ? match[1] : '';
};

const extractReleaseActor = (body) => {
    const match = String(body ?? '').match(RELEASE_ACTOR_RE);
    return match ? match[1] : '';
};

// The body as a human wrote (or a flow generated) it: markers removed, trailing blank lines
// trimmed, so the text can be shown again in a Slack message.
const stripMarkers = (body) => String(body ?? '').replace(MARKER_LINE_RE, '').trimEnd();

const slackTsMarker = (ts) => `<!-- slack_ts: ${ts} -->`;
const releaseActorMarker = (actor) => `<!-- release_actor: ${actor} -->`;

module.exports = {
    extractReleaseActor,
    extractSlackTs,
    releaseActorMarker,
    slackTsMarker,
    stripMarkers,
};
