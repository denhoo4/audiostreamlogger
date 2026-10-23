/**
 * Pure transform for the /settings2 browse tree.
 *
 * Takes an array of stream objects (each already carrying a nested `.logs`
 * object and a `.name`) and returns the nested
 * `{ "Station_Name": { year: { month: { day: [hours] } } } }` tree keyed by the
 * stored station name VERBATIM (the historical underscore-to-space display
 * workaround was removed — names are shown exactly as stored everywhere).
 *
 * Two earlier cleanups remain: the `transformedJson` accumulator is a local (no
 * longer an implicit global shared across requests), and the `transformData`
 * helper is defined once at module scope instead of being redefined per call.
 */
function transformData(originalData) {
    const transformedData = {};

    for (const station in originalData) {
        const stationData = originalData[station].logs;
        transformedData[station] = {};

        for (const year in stationData) {
            transformedData[station][year] = {};

            for (const month in stationData[year]) {
                transformedData[station][year][month] = {};
                const days = Object.keys(stationData[year][month]);

                for (const day of days) {
                    transformedData[station][year][month][day] = stationData[year][month][day];
                }
            }
        }
    }
    return transformedData;
}

function buildBrowseTree(streams) {
    let transformedJson = {};
    streams.forEach((item) => {
        const key = item.name;
        transformedJson[key] = { ...item };
        delete transformedJson[key].name;
    });
    // Keys are the stored station name verbatim — no underscore-to-space
    // substitution (the historical `_`->space display workaround was removed).
    return transformData(transformedJson);
}

module.exports = { buildBrowseTree };
