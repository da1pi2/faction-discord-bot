const Database = require('better-sqlite3');
const path = require('path');
const EventEmitter = require('events');

const db = new Database(path.join(__dirname, 'activity.sqlite'));
const dbEvents = new EventEmitter();

db.exec(`
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    utc_hour REAL NOT NULL,
    day_count INTEGER NOT NULL,
    night_count INTEGER NOT NULL,
    available_count INTEGER DEFAULT 0
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

  CREATE TABLE IF NOT EXISTS user_availabilities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    available_start INTEGER NOT NULL,
    available_end INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS active_events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    target_date TEXT NOT NULL,
    description TEXT,
    x INTEGER,
    y INTEGER,
    channel_id TEXT,
    message_id TEXT
  );

  CREATE TABLE IF NOT EXISTS event_rsvps (
    event_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL,
    PRIMARY KEY (event_id, user_id)
  );
`);

// Mantieni solo queste due migrazioni per sicurezza sui vecchi DB
try { db.prepare('ALTER TABLE user_timezones ADD COLUMN available_start INTEGER').run(); } catch(e) {}
try { db.prepare('ALTER TABLE user_timezones ADD COLUMN available_end INTEGER').run(); } catch(e) {}

function setUserTimezone(userId, offset) {
  db.prepare(`
    INSERT INTO user_timezones (user_id, utc_offset)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET utc_offset = excluded.utc_offset
  `).run(userId, offset);
  dbEvents.emit('update', `Timezone updated for user ${userId}`);
}

function setUserAvailability(userId, start, end) {
  db.prepare('DELETE FROM user_availabilities WHERE user_id = ?').run(userId);
  if (start !== null && end !== null) {
    db.prepare('INSERT INTO user_availabilities (user_id, available_start, available_end) VALUES (?, ?, ?)').run(userId, start, end);
  }
  dbEvents.emit('update', `Availability updated for user ${userId}`);
  return true;
}

// Ora restituisce l'oggetto completo
function getUserTimezone(userId) {
  const row = db.prepare('SELECT utc_offset FROM user_timezones WHERE user_id = ?').get(userId);
  return row || null;
}

function getAllTimezones() {
  return db.prepare('SELECT user_id, utc_offset FROM user_timezones').all();
}

function logSnapshot(summary) {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM activity_log WHERE timestamp < ?').run(cutoff);

  const stmt = db.prepare(`
    INSERT INTO activity_log (timestamp, utc_hour, day_count, peak_count, night_count, available_count, region_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    new Date().toISOString(),
    summary.utcHour,
    summary.byStatus.day || 0,
    0, // <-- Fornisce 0 per soddisfare il vincolo NOT NULL legacy
    summary.byStatus.night || 0,
    summary.byStatus.available || 0,
    '{}' // <-- Fornisce stringa vuota per region_json
  );
}

function getHistoricalAverageByHour() {
  const rows = db
    .prepare(
      `SELECT CAST(utc_hour AS INTEGER) AS hour_bucket,
              AVG(day_count + COALESCE(available_count, 0)) AS avg_active,
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

function addUserAvailability(userId, start, end) {
  db.prepare(`
    INSERT INTO user_availabilities (user_id, available_start, available_end)
    VALUES (?, ?, ?)
  `).run(userId, start, end);
  dbEvents.emit('update', `Availability added for user ${userId}`);
}

function clearUserAvailabilities(userId) {
  const result = db.prepare('DELETE FROM user_availabilities WHERE user_id = ?').run(userId);
  if (result.changes > 0) dbEvents.emit('update', `Availabilities cleared for user ${userId}`);
  return result.changes > 0;
}

function deleteUserAvailabilityById(id, userId) {
  const result = db.prepare('DELETE FROM user_availabilities WHERE id = ? AND user_id = ?').run(id, userId);
  if (result.changes > 0) dbEvents.emit('update', `Availability slot ${id} deleted`);
  return result.changes > 0;
}

function getUserAvailabilities(userId) {
  return db.prepare('SELECT id, available_start, available_end FROM user_availabilities WHERE user_id = ?').all(userId);
}

function getAllAvailabilities() {
  return db.prepare(`
    SELECT a.id, a.user_id, t.utc_offset, a.available_start, a.available_end
    FROM user_availabilities a
    JOIN user_timezones t ON a.user_id = t.user_id
    ORDER BY a.user_id
  `).all();
}

function addEvent(ev) {
  db.prepare(`
    INSERT INTO active_events (id, name, target_date, description, x, y, channel_id, message_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(ev.id, ev.name, ev.target_date, ev.description || null, ev.x ?? null, ev.y ?? null, ev.channel_id, ev.message_id);
}

function updateEventDetails(id, targetDate, x, y) {
  db.prepare(`UPDATE active_events SET target_date = ?, x = ?, y = ? WHERE id = ?`).run(targetDate, x ?? null, y ?? null, id);
}

function deleteEvent(id) {
  db.prepare('DELETE FROM active_events WHERE id = ?').run(id);
  db.prepare('DELETE FROM event_rsvps WHERE event_id = ?').run(id);
}

function getEvent(id) {
  return db.prepare('SELECT * FROM active_events WHERE id = ?').get(id);
}

function getAllEvents() {
  return db.prepare('SELECT * FROM active_events').all();
}

function setEventRsvp(eventId, userId, status) {
  db.prepare(`
    INSERT INTO event_rsvps (event_id, user_id, status)
    VALUES (?, ?, ?)
    ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status
  `).run(eventId, userId, status);
}

function getEventRsvps(eventId) {
  return db.prepare('SELECT user_id, status FROM event_rsvps WHERE event_id = ?').all(eventId);
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
  setUserAvailability,
  getUserTimezone,
  getAllTimezones,
  getAllAvailabilities,
  getUserAvailabilities,
  addUserAvailability,
  clearUserAvailabilities,
  deleteUserAvailabilityById,
  addEvent,
  updateEventDetails,
  deleteEvent,
  getEvent,
  getAllEvents,
  setEventRsvp,
  getEventRsvps,
};