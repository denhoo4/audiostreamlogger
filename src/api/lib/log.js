/**
 * Tiny dependency-free structured logger. Each line is prefixed with an ISO-8601
 * timestamp and a level token, then the usual console args, so operational log
 * lines carry a level + timestamp without pulling in a logging framework.
 *
 * info  -> console.log  (stdout)
 * warn  -> console.warn (stderr)
 * error -> console.error (stderr)
 *
 * The variadic signature matches console.* so existing call sites map 1:1.
 *
 * NOTE: identical per-service copies live at src/worker/log.js and
 * src/recorder/log.js (each service is a separate Docker build context, so a
 * small duplicated helper keeps the Dockerfile COPY lists trivial). The unit
 * test for this helper lives in src/worker/test/log.test.js and covers all
 * three copies since they are identical.
 */
function emit(method, level, args) {
    method(`${new Date().toISOString()} ${level}`, ...args);
}

module.exports = {
    info: (...args) => emit(console.log, 'INFO', args),
    warn: (...args) => emit(console.warn, 'WARN', args),
    error: (...args) => emit(console.error, 'ERROR', args),
};
