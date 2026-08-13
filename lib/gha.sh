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

# gha_mask VALUE [NAME] — mask a secret in the job log. ::add-mask:: only masks the exact line it is
# given, so a multi-line credential needs one call per line or everything after the first line
# shows up in cleartext.
#
# Lines shorter than GHA_MASK_MIN_LENGTH are left unmasked. The mask registry is job-wide and
# matches substrings, so registering a short non-secret (a project name, an environment name)
# replaces it everywhere it later appears — including inside unrelated values, where the runner then
# drops the whole thing ("Skip output '<name>' since it may contain secret"). Nothing that short
# carries enough entropy to be worth protecting at that price. NAME, when given, is named in the
# warning so the value can be moved out of the secret store.
: "${GHA_MASK_MIN_LENGTH:=12}"
gha_mask() {
    local value="$1" name="${2:-}" label="a value" line
    [ -n "$name" ] && label="'$name'"
    while IFS= read -r line || [ -n "$line" ]; do
        [ -z "$line" ] && continue
        if [ "${#line}" -lt "$GHA_MASK_MIN_LENGTH" ]; then
            echo "::warning::Not masking $label — shorter than $GHA_MASK_MIN_LENGTH characters. Non-secret config does not belong in a secret store: masking it corrupts every output that contains it."
            continue
        fi
        echo "::add-mask::$line"
    done <<< "$value"
}
