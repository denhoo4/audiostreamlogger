/**
 * Amsterdam-local hour-slot helper — TODO item 21 (stream-health TZ fix).
 *
 * The recorder stamps hour-slot files/rows in LOCAL time (its container TZ is
 * Europe/Amsterdam — see src/recorder/time-helpers.js::currentHourStamp, which
 * uses getFullYear()/getMonth()/getDate()/getHours()). The stream-health route
 * must compute the current slot + window in the SAME wall clock, but it MUST NOT
 * depend on the ambient process TZ (a bare getHours() is only correct if the API
 * process also runs Europe/Amsterdam).
 *
 * This helper computes Amsterdam-local Y-M-D-HH explicitly via
 * Intl.DateTimeFormat with timeZone 'Europe/Amsterdam', so the slot math is
 * correct regardless of the process clock. CEST/CET DST is handled by the
 * formatter (never a hardcoded +2), and `hourCycle:'h23'` makes midnight '00'
 * (never '24'). `formatToParts` is used (not a formatted string) so field
 * extraction is robust against locale punctuation.
 *
 * Pure: no DB, no fs, no Date.now() — the caller injects the Date instant.
 */
const AMS_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
});

/**
 * The Amsterdam-local hour-slot for a Date instant, as
 * { date:'YYYY-MM-DD', hour:'HH' }. DST-correct via Intl (CEST +2 / CET +1).
 * @param {Date} date
 * @returns {{date:string, hour:string}}
 */
function amsterdamSlot(date) {
    const parts = AMS_FORMATTER.formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    const year = get('year');
    const month = get('month');
    const day = get('day');
    let hour = get('hour');
    // hourCycle h23 yields 00..23, but some ICU builds emit '24' for midnight;
    // normalize defensively so the slot key is always 'HH' in [00,23].
    if (hour === '24') {
        hour = '00';
    }
    return { date: `${year}-${month}-${day}`, hour };
}

module.exports = { amsterdamSlot };
