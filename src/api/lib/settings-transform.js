/**
 * Pure transform for the /settings2 browse tree.
 *
 * Takes an array of stream objects (each already carrying a nested `.logs`
 * object and a `.name`) and returns the nested
 * `{ "Station Name": { year: { month: { day: [hours] } } } }` tree.
 *
 * Behavior is preserved byte-for-byte from the original inline implementation
 * in src/api/routes/api.js (including the implicit-global `transformedJson`
 * and the leaking `station['test']` field, which are deferred follow-ups).
 */
function buildBrowseTree(streams) {
    transformedJson = {};
    streams.forEach((item) => {
        const key = item.name;
        transformedJson[key] = { ...item };
        delete transformedJson[key].name;
    });
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
    transformedJson = transformData(transformedJson);
    const transformedData = {};

    for (const key in transformedJson) {
        const newKey = key.replace(/_/g, ' ');
        transformedData[newKey] = transformedJson[key];
    }
    return transformedData;
}

module.exports = { buildBrowseTree };
