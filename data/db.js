const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'activity.sqlite'));

db.exec(`
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    utc_hour REAL NOT NULL,
    day_count INTEGER NOT NULL,
    peak_count INTEGER NOT NULL,
    night_count INTEGER NOT NULL,
    region_json TEXT NOT NULL
  )
`);

function logSnapshot(summary) {
  const stmt = db.prepare(`
    INSERT INTO activity_log (timestamp, utc_hour, day_count, peak_count, night_count, region_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    new Date().toISOString(),
    summary.utcHour,
    summary.byStatus.day,
    summary.byStatus.peak,
    summary.byStatus.night,
    JSON.stringify(summary.byRegion)
  );
}

// Media di membri attivi (day+peak, escludendo night) raggruppata per ora UTC intera,
// utile per /besttime versione storica dopo qualche giorno di dati raccolti.
function getHistoricalAverageByHour() {
  const rows = db
    .prepare(
      `SELECT CAST(utc_hour AS INTEGER) AS hour_bucket,
              AVG(day_count + peak_count) AS avg_active,
              COUNT(*) AS samples
       FROM activity_log
       GROUP BY hour_bucket
       ORDER BY avg_active DESC`
    )
    .all();
  return rows;
}

module.exports = { db, logSnapshot, getHistoricalAverageByHour };
