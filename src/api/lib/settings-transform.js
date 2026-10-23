/**
 * Pure transform for the /settings2 browse tree.
 *
 * Takes an array of stream objects (each already carrying a nested `.logs`
 * object and a `.name`) and returns the nested
 * `{ "Station Name": { year: { month: { day: [hours] } } } }` tree.
 *
 * Output is byte-for-byte identical to the original inline implementation in
 * src/api/routes/api.js. Two earlier cleanups have now been applied: the
 * `transformedJson` accumulator is a local (no longer an implicit global shared
 * across requests), and the `transformData` helper is defined once at module
 * scope instead of being redefined on every call.
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
    transformedJson = transformData(transformedJson);
    const transformedData = {};

    for (const key in transformedJson) {
        const newKey = key.replace(/_/g, ' ');
        transformedData[newKey] = transformedJson[key];
    }
    return transformedData;
}

module.exports = { buildBrowseTree };
