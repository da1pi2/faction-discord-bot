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

  CREATE TABLE IF NOT EXISTS user_timezones (
    user_id TEXT PRIMARY KEY,
    utc_offset REAL NOT NULL
  );
`);

function setUserTimezone(userId, offset) {
  db.prepare(`
    INSERT INTO user_timezones (user_id, utc_offset)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET utc_offset = excluded.utc_offset
  `).run(userId, offset);
  dbEvents.emit('update', `Timezone updated for user ${userId}`);
}

function getUserTimezone(userId) {
  const row = db.prepare('SELECT utc_offset FROM user_timezones WHERE user_id = ?').get(userId);
  return row ? row.utc_offset : null;
}

function getAllTimezones() {
  return db.prepare('SELECT user_id, utc_offset FROM user_timezones').all();
}

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
    '{}' // Non tracciamo più le regioni qui
  );
  dbEvents.emit('update', 'Automatic activity snapshot (15 min sync)');
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
  dbEvents.emit('update', `Objective inserted/updated: ${name}`);
}

function addObjective(name, x, y) {
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO map_objectives (name, x, y, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(name, x, y, now, now);
  
  dbEvents.emit('update', `New objective added: ${name}`);
  return result;
}

function updateObjective(name, x, y) {
  const now = new Date().toISOString();
  const result = db.prepare(
    `UPDATE map_objectives
     SET x = ?, y = ?, updated_at = ?
     WHERE name = ?`
  ).run(x, y, now, name);
  
  if (result.changes > 0) dbEvents.emit('update', `Objective updated: ${name}`);
  return result;
}

function deleteObjective(name) {
  const result = db.prepare('DELETE FROM map_objectives WHERE name = ?').run(name);
  if (result.changes > 0) dbEvents.emit('update', `Objective deleted: ${name}`);
  return result;
}

function clearObjectives() {
  const result = db.prepare('DELETE FROM map_objectives').run();
  if (result.changes > 0) dbEvents.emit('update', 'All objectives have been deleted');
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
  setUserTimezone,
  getUserTimezone,
  getAllTimezones,
};
