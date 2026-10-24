/**
 * The single audio base-dir expression used by every stream-folder lifecycle
 * fs op (delete/rename — TODO items 25/26).
 *
 * It is DELIBERATELY the recorder/worker's paths.js expression
 * `process.env.AUDIO_DIR || '/usr/src/app/audio'`, NOT browse.js's
 * `path.join(__dirname, '../audio')`. Rationale: the worker's reconcile scan
 * builds every recordings `file_path` as `path.join(AUDIO_DIR, folder, name)`
 * with this exact base (src/worker/handlers/paths.js + reconcile.js), and the
 * reconcile planner compares raw `file_path` strings. For a rename to leave
 * disk and DB in agreement — so a later reconcile is a TRUE no-op — the rebuilt
 * file_path MUST use the identical base. Reading it from the env (not a fixed
 * path.join against this module's __dirname) is what makes that identity hold,
 * and lets the tests point AUDIO_DIR at a throwaway temp dir.
 *
 * Read lazily (a function, not a constant) so a test that sets
 * process.env.AUDIO_DIR before calling is honoured without require-order games.
 */
function audioBaseDir() {
    return process.env.AUDIO_DIR || '/usr/src/app/audio';
}

module.exports = { audioBaseDir };
