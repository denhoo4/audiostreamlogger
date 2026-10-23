// Pure validation helpers for cleaner settings.

// Validate a cron "minute" value: integer in the range 0..59.
// Returns {ok:true} on success, else {ok:false, message}.
function validateMinute(name, value) {
    if (!Number.isInteger(value) || value < 0 || value > 59) {
        return {
            ok: false,
            message: `ERROR! The ${name} variable in settings.json must be an integer between 0 and 59.`,
        };
    }
    return { ok: true };
}

// Validate a retention value expressed in hours: integer in the range 1..8760
// (1 hour up to one year). Returns {ok:true} on success, else {ok:false, message}.
function validateRetentionHours(value) {
    if (!Number.isInteger(value) || value < 1 || value > 8760) {
        return {
            ok: false,
            message: `ERROR! The log_retention variable in settings.json must be an integer number of hours between 1 and 8760. The cleaner will be shutdown.`,
        };
    }
    return { ok: true };
}

module.exports = { validateMinute, validateRetentionHours };
