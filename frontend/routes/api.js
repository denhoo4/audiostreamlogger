const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

router.get('/settings', (req, res) => {
    const filePath = path.join(__dirname, '../settings.json');

    fs.readFile(filePath, 'utf-8', (err, fileContent) => {
        if (err) {
            console.error('Error reading settings.json:', err);
            return res.status(500).json({ error: `Internal Server Error: ${err.message}` });
        }

        try {
            const settingsData = JSON.parse(fileContent);
            res.json(settingsData.streams);
        } catch (jsonError) {
            console.error('Error parsing JSON:', jsonError);
            res.status(500).json({ error: `Internal Server Error: ${jsonError.message}` });
        }
    });
});

router.get('/settings2', async (req, res) => {
    const filePath = path.join(__dirname, '../settings.json');

    try {
        const fileContent = await fs.promises.readFile(filePath, 'utf-8');
        const settingsData = JSON.parse(fileContent);

        const promises = settingsData.map(async (station) => {
            const folder = station["folder"];
            const audioFolderPath = path.join(__dirname, '../audio');
            const folderPath = path.join(audioFolderPath, folder);

            const logs = await folderContent(folderPath);
            station['logs'] = logs;
            station['test'] = folderPath;
        });

        await Promise.all(promises);
        transformedJson = {};
        settingsData.forEach((item) => {
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
        res.json(transformedData);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: `Internal Server Error: ${error.message}` });
    }
});

async function folderContent(folderPath) {
    try {
      const files = await fs.promises.readdir(folderPath);
  
      const dateMap = new Map();
  
      files.forEach((file) => {
        const match = file.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})\.mp3$/);
        if (match) {
          const [year, month, day, hour] = match.slice(1);
  
          if (!dateMap.has(year)) {
            dateMap.set(year, new Map());
          }
  
          const yearMap = dateMap.get(year);
  
          if (!yearMap.has(month)) {
            yearMap.set(month, new Map());
          }
  
          const monthMap = yearMap.get(month);
  
          if (!monthMap.has(day)) {
            monthMap.set(day, new Set());
          }
  
          const daySet = monthMap.get(day);
          daySet.add(hour);
        }
      });
  
      const result = {};
  
      for (const [year, yearMap] of dateMap) {
        result[year] = {};
  
        for (const [month, monthMap] of yearMap) {
          result[year][month] = {};
  
          for (const [day, daySet] of monthMap) {
            result[year][month][day] = Array.from(daySet);
          }
        }
      }
  
      return result;
    } catch (err) {
      console.error(`Error reading folder: ${err}`);
      throw err;
    }
  }

  module.exports = router;