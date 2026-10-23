// Pure, side-effect-free time helpers shared by recorder.js and its unit tests.
// Kept in a separate module so tests can require them without triggering
// recorder.js's boot side effects (settings read, process.exit, cron register).

// Seconds from `date` until the next top-of-hour, using LOCAL-time components so
// it matches the local-time (TZ) filename formatting the recorder already uses.
// Sub-second milliseconds are ignored. At an exact top-of-hour (mm=00, ss=00)
// this returns a full 3600 (a whole hour remains), never 0, so a catch-up
// launched exactly on the hour still records a sensible full hour.
function secondsUntilNextHour(date = new Date()) {
    const elapsed = date.getMinutes() * 60 + date.getSeconds();
    return 3600 - elapsed;
}

// `YYYY-MM-DD-HH` stamp using the same zero-padded local-time formatting that
// recorder.js uses to build its output filenames (single source of truth).
function currentHourStamp(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}`;
}

module.exports = { secondsUntilNextHour, currentHourStamp };
