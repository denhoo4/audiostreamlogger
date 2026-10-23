/**
 * Pure validation helpers for app_config scalars (design §1.3 / §1.4).
 *
 * validateRetentionHours is ported verbatim (behaviorally identical) from
 * src/cleaner/settings-utils.js: the api owns config writes and its Docker image
 * only copies src/api/, so the helper lives here rather than being required
 * across services (matches the codebase's "ported pure helpers" convention).
 */

/**
 * Validate a retention value expressed in hours: integer in the range 1..8760
 * (1 hour up to one year). Returns {ok:true} on success, else {ok:false, message}.
 */
function validateRetentionHours(value) {
    if (!Number.isInteger(value) || value < 1 || value > 8760) {
        return {
            ok: false,
            message:
                'log_retention must be an integer number of hours between 1 and 8760.',
        };
    }
    return { ok: true };
}

/**
 * Parse the job-output retention count (A3 / NIT-5). Returns a POSITIVE integer,
 * falling back to 100 when the stored value is missing, non-numeric, or not a
 * positive integer. The reader re-validates defensively before use so a hand-edited
 * app_config row can never shrink retention to zero/negative.
 */
function parseOutputRetentionCount(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) {
        return 100;
    }
    return n;
}

module.exports = { validateRetentionHours, parseOutputRetentionCount };
