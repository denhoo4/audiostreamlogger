// Pure validation helpers for the worker, ported from src/cleaner/settings-utils.js
// (verbatim behavior). The worker image only COPYs src/worker/, so the helper is
// ported here rather than required across services.

// Validate a retention value expressed in hours: integer in the range 1..8760
// (1 hour up to one year). Returns {ok:true} on success, else {ok:false, message}.
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

module.exports = { validateRetentionHours };
