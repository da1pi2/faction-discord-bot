const Database = require('better-sqlite3');
const path = require('path');
const EventEmitter = require('events'); // <-- 1. Importa EventEmitter

const db = new Database(path.join(__dirname, 'activity.sqlite'));
const dbEvents = new EventEmitter(); // <-- 2. Crea il gestore eventi

db.exec(`
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    utc_hour REAL NOT NULL,
    day_count INTEGER NOT NULL,
    peak_count INTEGER NOT NULL,
    night_count INTEGER NOT NULL,
    region_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS map_objectives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
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
  dbEvents.emit('update', 'Snapshot automatico attività (sync 15 min)');
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

function upsertObjective(name, x, y) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO map_objectives (name, x, y, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       x = excluded.x,
       y = excluded.y,
       updated_at = excluded.updated_at`
  ).run(name, x, y, now, now);
  dbEvents.emit('update', `Obiettivo inserito/aggiornato: ${name}`);
}

function addObjective(name, x, y) {
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO map_objectives (name, x, y, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(name, x, y, now, now);
  
  dbEvents.emit('update', `Aggiunto nuovo obiettivo: ${name}`);
  return result;
}

function updateObjective(name, x, y) {
  const now = new Date().toISOString();
  const result = db.prepare(
    `UPDATE map_objectives
     SET x = ?, y = ?, updated_at = ?
     WHERE name = ?`
  ).run(x, y, now, name);
  
  if (result.changes > 0) dbEvents.emit('update', `Aggiornato obiettivo: ${name}`);
  return result;
}

function deleteObjective(name) {
  const result = db.prepare('DELETE FROM map_objectives WHERE name = ?').run(name);
  if (result.changes > 0) dbEvents.emit('update', `Eliminato obiettivo: ${name}`);
  return result;
}

function clearObjectives() {
  const result = db.prepare('DELETE FROM map_objectives').run();
  if (result.changes > 0) dbEvents.emit('update', 'Tutti gli obiettivi sono stati eliminati');
  return result;
}

function listObjectives() {
  return db.prepare('SELECT name, x, y, created_at, updated_at FROM map_objectives ORDER BY name COLLATE NOCASE').all();
}

function createBackup(destinationPath) {
  return db.backup(destinationPath);
}

module.exports = {
  db,
  dbEvents,
  logSnapshot,
  getHistoricalAverageByHour,
  addObjective,
  upsertObjective,
  updateObjective,
  deleteObjective,
  clearObjectives,
  listObjectives,
  createBackup,
};
