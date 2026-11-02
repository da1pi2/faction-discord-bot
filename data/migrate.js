const MAIN_GUILD_ID = '1513221403833536552';
const TABLES = ['activity_log', 'map_objectives', 'user_timezones', 'user_availabilities', 'active_events', 'event_rsvps', 'event_history', 'event_history_rsvps'];
const LEGACY_SCHEMA = `
CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, utc_hour REAL NOT NULL, day_count INTEGER NOT NULL, peak_count INTEGER NOT NULL DEFAULT 0, night_count INTEGER NOT NULL, region_json TEXT NOT NULL DEFAULT '{}', available_count INTEGER DEFAULT 0);
CREATE TABLE map_objectives (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, x INTEGER NOT NULL, y INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE user_timezones (user_id TEXT PRIMARY KEY, utc_offset REAL NOT NULL, available_start INTEGER, available_end INTEGER);
CREATE TABLE user_availabilities (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, available_start INTEGER NOT NULL, available_end INTEGER NOT NULL);
CREATE TABLE active_events (id TEXT PRIMARY KEY, name TEXT NOT NULL, target_date TEXT NOT NULL, description TEXT, x INTEGER, y INTEGER, channel_id TEXT, message_id TEXT);
CREATE TABLE event_rsvps (event_id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY (event_id, user_id));
CREATE TABLE event_history (event_id TEXT PRIMARY KEY, name TEXT, target_date TEXT);
CREATE TABLE event_history_rsvps (event_id TEXT, user_id TEXT, status TEXT, PRIMARY KEY (event_id, user_id));`;
function validateGuildId(guildId) {
  if (typeof guildId !== 'string' || !/^\d{17,20}$/.test(guildId)) throw new Error('A valid guildId is required');
  return guildId;
}
function migrate(db, { beforeCommit } = {}) {
  const version = db.pragma('user_version', { simple: true });
  if (version === 1) {
    for (const table of [...TABLES, 'guild_settings']) {
      if (!db.pragma(`table_info(${table})`).some(c => c.name === 'guild_id')) throw new Error(`Invalid v1 schema: ${table}`);
    }
    return false;
  }
  if (version !== 0) throw new Error(`Unsupported database version ${version}`);
  db.transaction(() => {
    const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    if (!existing.length) db.exec(LEGACY_SCHEMA);
    for (const name of TABLES) {
      const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name);
      if (!row || db.pragma(`table_info(${name})`).some(c => c.name === 'guild_id')) throw new Error(`Unexpected legacy schema: ${name}`);
      const extras = db.prepare("SELECT name FROM sqlite_master WHERE tbl_name=? AND type IN ('trigger','index') AND sql IS NOT NULL").all(name);
      if (extras.length) throw new Error(`Review custom indexes/triggers before migrating ${name}`);
      if (db.pragma(`foreign_key_list(${name})`).length) throw new Error(`Review foreign keys before migrating ${name}`);
      const columns = db.pragma(`table_info(${name})`).map(c => c.name);
      const quoted = columns.map(c => '"' + c.replace(/"/g, '""') + '"').join(',');
      const oldRows = db.prepare(`SELECT ${quoted} FROM ${name} ORDER BY rowid`).all();
      const sequence = db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get(name);
      let sql = row.sql.replace(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`\[]?\w+["`\]]?/i, `CREATE TABLE ${name}_multiserver`);
      sql = sql.replace('(', '(guild_id TEXT NOT NULL, ');
      if (name === 'map_objectives') sql = sql.replace(/\bUNIQUE\b/i, '').replace(/\)\s*$/, ', UNIQUE(guild_id, name))');
      if (['user_timezones','active_events','event_history'].includes(name)) {
        const key = name === 'user_timezones' ? 'user_id' : name === 'active_events' ? 'id' : 'event_id';
        sql = sql.replace(/TEXT PRIMARY KEY/i, 'TEXT NOT NULL').replace(/\)\s*$/, `, PRIMARY KEY(guild_id, ${key}))`);
      }
      sql = sql.replace(/PRIMARY KEY\s*\(event_id,\s*user_id\)/i, 'PRIMARY KEY(guild_id, event_id, user_id)');
      db.exec(sql);
      db.prepare(`INSERT INTO ${name}_multiserver (guild_id, ${quoted}) SELECT ?, ${quoted} FROM ${name} ORDER BY rowid`).run(MAIN_GUILD_ID);
      const newRows = db.prepare(`SELECT ${quoted} FROM ${name}_multiserver ORDER BY rowid`).all();
      if (JSON.stringify(oldRows) !== JSON.stringify(newRows)) throw new Error(`Data mismatch: ${name}`);
      db.exec(`DROP TABLE ${name}; ALTER TABLE ${name}_multiserver RENAME TO ${name}`);
      if (sequence) {
        const updated = db.prepare('UPDATE sqlite_sequence SET seq=? WHERE name=?').run(sequence.seq, name);
        if (!updated.changes) db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').run(name,sequence.seq);
      }
      db.exec(`CREATE INDEX ${name}_guild_idx ON ${name}(guild_id)`);
    }
    const activityColumns = db.pragma('table_info(activity_log)').map(c => c.name);
    for (const [name,definition] of [['peak_count','INTEGER NOT NULL DEFAULT 0'],['region_json',"TEXT NOT NULL DEFAULT '{}'"],['available_count','INTEGER DEFAULT 0']]) {
      if (!activityColumns.includes(name)) db.exec(`ALTER TABLE activity_log ADD COLUMN ${name} ${definition}`);
    }
    db.exec(`CREATE INDEX activity_log_guild_timestamp_idx ON activity_log(guild_id,timestamp);
      CREATE INDEX user_availabilities_guild_user_idx ON user_availabilities(guild_id,user_id);
      CREATE TABLE guild_settings (guild_id TEXT PRIMARY KEY NOT NULL, status_channel_id TEXT, backup_channel_id TEXT);
      PRAGMA user_version = 1;`);
    db.prepare('INSERT INTO guild_settings(guild_id,status_channel_id,backup_channel_id) VALUES(?,?,?)').run(MAIN_GUILD_ID, '1535252222626111651', process.env.BACKUP_CHANNEL_ID || null);
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Integrity check failed');
    if (beforeCommit) beforeCommit();
  }).immediate();
  return true;
}
module.exports = { MAIN_GUILD_ID, TABLES, LEGACY_SCHEMA, validateGuildId, migrate };
