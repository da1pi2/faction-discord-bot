const Database = require('better-sqlite3');
const path = require('path');
const { EventEmitter } = require('events');
const { migrate, validateGuildId, TABLES } = require('./migrate');
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'activity.sqlite'));
db.pragma('busy_timeout = 5000');
if (db.pragma('user_version', { simple: true }) !== 1) {
  if (db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n) {
    db.close();
    throw new Error('Legacy database: stop the bot and run npm run migrate before starting.');
  }
  migrate(db);
}
migrate(db); // Validate an already migrated schema as well.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
const dbEvents = new EventEmitter();
const run = (sql, ...args) => db.prepare(sql).run(...args);
const all = (sql, ...args) => db.prepare(sql).all(...args);
const get = (sql, ...args) => db.prepare(sql).get(...args);
const functions = {
  setUserTimezone(g, user, offset) {
    return run('INSERT INTO user_timezones(guild_id,user_id,utc_offset) VALUES(?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET utc_offset=excluded.utc_offset', g,user,offset);
  },
  setUserAvailability(g,user,start,end) {
    db.transaction(() => { functions.clearUserAvailabilities(g,user); if(start !== null && end !== null) functions.addUserAvailability(g,user,start,end); })();
    return true;
  },
  getUserTimezone: (g,user) => get('SELECT utc_offset FROM user_timezones WHERE guild_id=? AND user_id=?',g,user) || null,
  getAllTimezones: g => all('SELECT user_id,utc_offset FROM user_timezones WHERE guild_id=?',g),
  addUserAvailability: (g,user,start,end) => run('INSERT INTO user_availabilities(guild_id,user_id,available_start,available_end) VALUES(?,?,?,?)',g,user,start,end),
  clearUserAvailabilities: (g,user) => run('DELETE FROM user_availabilities WHERE guild_id=? AND user_id=?',g,user).changes > 0,
  deleteUserAvailabilityById: (g,id,user) => run('DELETE FROM user_availabilities WHERE guild_id=? AND id=? AND user_id=?',g,id,user).changes > 0,
  getUserAvailabilities: (g,user) => all('SELECT id,available_start,available_end FROM user_availabilities WHERE guild_id=? AND user_id=?',g,user),
  getAllAvailabilities: g => all(`SELECT a.id,a.user_id,t.utc_offset,a.available_start,a.available_end FROM user_availabilities a JOIN user_timezones t ON a.guild_id=t.guild_id AND a.user_id=t.user_id WHERE a.guild_id=? ORDER BY a.user_id`,g),
  logSnapshot(g,summary) {
    db.transaction(() => {
      run('DELETE FROM activity_log WHERE guild_id=? AND timestamp < ?',g,new Date(Date.now()-7*86400000).toISOString());
      run(`INSERT INTO activity_log(guild_id,timestamp,utc_hour,day_count,peak_count,night_count,available_count,region_json) VALUES(?,?,?,?,?,?,?,?)`,g,new Date().toISOString(),summary.utcHour,summary.byStatus.day||0,0,summary.byStatus.night||0,summary.byStatus.available||0,'{}');
    })();
  },
  getHistoricalAverageByHour: g => all(`SELECT CAST(utc_hour AS INTEGER) AS hour_bucket, AVG(day_count+COALESCE(available_count,0)) AS avg_active, COUNT(*) AS samples FROM activity_log WHERE guild_id=? GROUP BY hour_bucket ORDER BY avg_active DESC`,g),
  addObjective(g,name,x,y) {
    const now = new Date().toISOString();
    return run('INSERT INTO map_objectives(guild_id,name,x,y,created_at,updated_at) VALUES(?,?,?,?,?,?)',g,name,x,y,now,now);
  },
  upsertObjective(g,name,x,y) {
    const now = new Date().toISOString();
    return run(`INSERT INTO map_objectives(guild_id,name,x,y,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(guild_id,name) DO UPDATE SET x=excluded.x,y=excluded.y,updated_at=excluded.updated_at`,g,name,x,y,now,now);
  },
  updateObjective: (g,name,x,y) => run('UPDATE map_objectives SET x=?,y=?,updated_at=? WHERE guild_id=? AND name=?',x,y,new Date().toISOString(),g,name),
  deleteObjective: (g,name) => run('DELETE FROM map_objectives WHERE guild_id=? AND name=?',g,name),
  clearObjectives: g => run('DELETE FROM map_objectives WHERE guild_id=?',g),
  listObjectives: g => all('SELECT name,x,y,created_at,updated_at FROM map_objectives WHERE guild_id=? ORDER BY name COLLATE NOCASE',g),
  addEvent: (g,ev) => run(`INSERT INTO active_events(guild_id,id,name,target_date,description,x,y,channel_id,message_id) VALUES(?,?,?,?,?,?,?,?,?)`,g,ev.id,ev.name,ev.target_date,ev.description||null,ev.x??null,ev.y??null,ev.channel_id,ev.message_id),
  updateEventDetails: (g,id,date,x,y) => run('UPDATE active_events SET target_date=?,x=?,y=? WHERE guild_id=? AND id=?',date,x??null,y??null,g,id),
  deleteEvent(g,id) {
    db.transaction(() => { run('DELETE FROM event_rsvps WHERE guild_id=? AND event_id=?',g,id); run('DELETE FROM active_events WHERE guild_id=? AND id=?',g,id); })();
  },
  getEvent: (g,id) => get('SELECT * FROM active_events WHERE guild_id=? AND id=?',g,id),
  eventIdExists: (g,id) => !!get('SELECT 1 FROM active_events WHERE guild_id=? AND id=? UNION ALL SELECT 1 FROM event_history WHERE guild_id=? AND event_id=? LIMIT 1',g,id,g,id),
  getAllEvents: g => all('SELECT * FROM active_events WHERE guild_id=?',g),
  setEventRsvp(g,id,user,status) {
    if (!functions.getEvent(g,id)) throw new Error('Event not found in this guild');
    return run('INSERT INTO event_rsvps(guild_id,event_id,user_id,status) VALUES(?,?,?,?) ON CONFLICT(guild_id,event_id,user_id) DO UPDATE SET status=excluded.status',g,id,user,status);
  },
  getEventRsvps: (g,id) => all('SELECT user_id,status FROM event_rsvps WHERE guild_id=? AND event_id=?',g,id),
  archiveEvent(g,id) {
    db.transaction(() => {
      const ev = functions.getEvent(g,id); if (!ev) return;
      run('INSERT INTO event_history(guild_id,event_id,name,target_date) VALUES(?,?,?,?)',g,id,ev.name,ev.target_date);
      run('INSERT INTO event_history_rsvps(guild_id,event_id,user_id,status) SELECT guild_id,event_id,user_id,status FROM event_rsvps WHERE guild_id=? AND event_id=?',g,id);
      functions.deleteEvent(g,id);
    })();
  },
  getEventStats(g) {
    return {
      topUsers: all("SELECT user_id,COUNT(*) AS count FROM event_history_rsvps WHERE guild_id=? AND status='yes' GROUP BY user_id ORDER BY count DESC LIMIT 10",g),
      bestHours: all(`SELECT strftime('%H',h.target_date) AS hour,COUNT(DISTINCT h.event_id) AS ev_count,SUM((SELECT COUNT(*) FROM event_history_rsvps r WHERE r.guild_id=h.guild_id AND r.event_id=h.event_id AND r.status='yes')) AS total_yes FROM event_history h WHERE h.guild_id=? GROUP BY hour ORDER BY total_yes DESC LIMIT 5`,g)
    };
  },
  getGuildSettings: g => get('SELECT * FROM guild_settings WHERE guild_id=?',g) || {guild_id:g,status_channel_id:null,backup_channel_id:null},
  setGuildSettings(g,{status_channel_id=null,backup_channel_id=null}) {
    return run(`INSERT INTO guild_settings(guild_id,status_channel_id,backup_channel_id) VALUES(?,?,?) ON CONFLICT(guild_id) DO UPDATE SET status_channel_id=excluded.status_channel_id,backup_channel_id=excluded.backup_channel_id`,g,status_channel_id,backup_channel_id);
  },
  async createGuildBackup(g,destination) {
    // Build an isolated export in memory; never upload the shared database to a guild.
    const out = new Database(':memory:');
    try {
      for (const table of [...TABLES,'guild_settings']) {
        out.exec(get("SELECT sql FROM sqlite_master WHERE type='table' AND name=?",table).sql);
        const columns = db.pragma(`table_info(${table})`).map(c=>c.name);
        const insert=out.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
        out.transaction(()=>{for(const row of all(`SELECT * FROM ${table} WHERE guild_id=?`,g)) insert.run(...columns.map(c=>row[c]));})();
      }
      out.pragma('user_version = 1');
      await out.backup(destination);
    } finally { out.close(); }
  }
};
const writes = /^(set|add|clear|delete|update|upsert|archive)/;
module.exports = { db, dbEvents, createBackup: destination => db.backup(destination) };
for (const [name,fn] of Object.entries(functions)) {
  module.exports[name] = (guildId,...args) => {
    validateGuildId(guildId);
    const result = fn(guildId,...args);
    if (writes.test(name)) dbEvents.emit('update',guildId,name);
    return result;
  };
}
