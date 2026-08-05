# Bash counterpart of lib/output.js, for composite-action steps that have no node process handy.
# Source it as: . "$GITHUB_ACTION_PATH/../../lib/gha.sh"
#
# gha_set_multiline FILE NAME VALUE — append NAME=VALUE to a GitHub Actions file
# ($GITHUB_OUTPUT / $GITHUB_ENV) using GitHub's heredoc syntax with a random delimiter, so a value
# containing a newline cannot terminate its own block and smuggle in extra keys.
gha_set_multiline() {
    local file="$1" name="$2" value="$3" delimiter
    delimiter="ghadelim_$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
    if printf '%s' "$value" | grep -qF "$delimiter"; then
        echo "::error::Value for '$name' collides with the generated delimiter" >&2
        return 1
    fi
    {
        printf '%s<<%s\n' "$name" "$delimiter"
        printf '%s\n' "$value"
        printf '%s\n' "$delimiter"
    } >> "$file"
}

# gha_mask VALUE — mask a secret in the job log. ::add-mask:: only masks the exact line it is
# given, so a multi-line credential needs one call per line or everything after the first line
# shows up in cleartext.
gha_mask() {
    local line
    while IFS= read -r line || [ -n "$line" ]; do
        [ -n "$line" ] && echo "::add-mask::$line"
    done <<< "$1"
}
