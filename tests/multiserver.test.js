const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { migrate, TABLES, LEGACY_SCHEMA, MAIN_GUILD_ID: A } = require('../data/migrate');
const B='2513221403833536552';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'faction-multi-'));
process.env.DB_PATH=path.join(folder,'test.sqlite');
const api=require('../data/db');
test.after(()=>{api.db.close();fs.rmSync(folder,{recursive:true,force:true});});
function legacy() {
 const db=new Database(':memory:'); db.exec(LEGACY_SCHEMA);
 db.exec(`INSERT INTO user_timezones VALUES('user',2,8,20);
 INSERT INTO user_availabilities VALUES(15,'user',10,12);
 INSERT INTO map_objectives VALUES(9,'Castle',1,2,'old','old');
 INSERT INTO activity_log VALUES(2,'2026-01-01',12,4,3,2,'{"old":1}',1);
 INSERT INTO active_events VALUES('SAME','Event','2030-01-01',NULL,NULL,NULL,'chan','msg');
 INSERT INTO event_rsvps VALUES('SAME','user','yes');
 INSERT INTO event_history VALUES('PAST','Old','2026-01-01');
 INSERT INTO event_history_rsvps VALUES('PAST','user','maybe');
 UPDATE sqlite_sequence SET seq=90 WHERE name='map_objectives';`);
 return db;
}
test('migration preserves all legacy fields, IDs, sequences; rerun is a no-op',()=>{
 const db=legacy();
 try {
 const before=Object.fromEntries(TABLES.map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]));
 assert.equal(migrate(db),true);
 for(const t of TABLES){const rows=db.prepare(`SELECT * FROM ${t}`).all();assert(rows.every(r=>r.guild_id===A));assert.deepEqual(rows.map(({guild_id,...r})=>r),before[t]);}
 assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='map_objectives'").get().seq,90);
 assert.equal(migrate(db),false);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
 }finally{db.close();}
});
test('failure rolls back schema, rows and version',()=>{
 const db=legacy();try{const before=db.serialize();assert.throws(()=>migrate(db,{beforeCommit(){throw new Error('injected');}}),/injected/);assert.equal(db.pragma('user_version',{simple:true}),0);assert.deepEqual(db.serialize(),before);}finally{db.close();}
});
test('unsupported and partial schemas are rejected without changes',()=>{
 const db=legacy();try{db.exec('ALTER TABLE user_timezones ADD COLUMN guild_id TEXT');assert.throws(()=>migrate(db),/Unexpected/);assert(!db.pragma('table_info(activity_log)').some(c=>c.name==='guild_id'));db.pragma('user_version = 5');assert.throws(()=>migrate(db),/Unsupported/);}finally{db.close();}
});
test('same user has separate timezones, slots, joins and deletions',()=>{
 api.setUserTimezone(A,'user',2);api.setUserTimezone(B,'user',-5);
 api.addUserAvailability(A,'user',10,12);api.addUserAvailability(B,'user',18,20);
 assert.equal(api.getUserTimezone(A,'user').utc_offset,2);assert.equal(api.getUserTimezone(B,'user').utc_offset,-5);
 assert.equal(api.getAllAvailabilities(B)[0].utc_offset,-5);assert.equal(api.getAllAvailabilities(A).length,1);
 const slot=api.getUserAvailabilities(A,'user')[0];assert.equal(api.deleteUserAvailabilityById(B,slot.id,'user'),false);
 api.clearUserAvailabilities(A,'user');assert.equal(api.getUserAvailabilities(B,'user').length,1);
 api.setUserAvailability(A,'user',6,8);assert.equal(api.getUserAvailabilities(A,'user')[0].available_start,6);
 assert.throws(()=>api.getAllTimezones(),/guildId/);
});
test('same objective name is allowed across servers; changes and clear are scoped',()=>{
 api.addObjective(A,'Castle',1,2);api.addObjective(B,'Castle',3,4);assert.throws(()=>api.addObjective(A,'Castle',5,6),/UNIQUE/);
 api.upsertObjective(A,'Castle',7,8);assert.equal(api.listObjectives(B)[0].x,3);api.updateObjective(B,'Castle',9,10);
 api.clearObjectives(A);assert.equal(api.listObjectives(A).length,0);assert.equal(api.listObjectives(B)[0].x,9);
});
test('event IDs, RSVP, update, archive, stats and delete are isolated',()=>{
 const ev={id:'SAME',name:'Event',target_date:'2030-01-01T12:00:00Z',channel_id:'chan',message_id:'msg'};
 api.addEvent(A,ev);api.addEvent(B,ev);api.setEventRsvp(A,'SAME','user','yes');api.setEventRsvp(B,'SAME','user','no');
 assert.equal(api.getEventRsvps(A,'SAME')[0].status,'yes');assert.equal(api.getEventRsvps(B,'SAME')[0].status,'no');
 api.updateEventDetails(A,'SAME','2031-01-01',1,2);assert.equal(api.getEvent(B,'SAME').target_date,ev.target_date);
 api.archiveEvent(A,'SAME');api.archiveEvent(A,'SAME');assert.equal(api.getEvent(A,'SAME'),undefined);assert.equal(api.getAllEvents(B).length,1);
 assert.equal(api.getEventStats(A).topUsers[0].count,1);assert.equal(api.getEventStats(B).topUsers.length,0);assert.equal(api.getEventStats(A).bestHours[0].total_yes,1);
 api.deleteEvent(A,'SAME');assert.equal(api.getEventRsvps(B,'SAME').length,1);assert.throws(()=>api.setEventRsvp(A,'OTHER','user','yes'),/not found/);
 assert.equal(api.eventIdExists(A,'SAME'),true);
});
test('archive is atomic on history collision',()=>{
 api.addEvent(A,{id:'SAME',name:'Again',target_date:'2032-01-01',channel_id:'chan',message_id:'msg'});api.setEventRsvp(A,'SAME','user','yes');
 assert.throws(()=>api.archiveEvent(A,'SAME'),/UNIQUE/);assert(api.getEvent(A,'SAME'));assert.equal(api.getEventRsvps(A,'SAME').length,1);
});
test('activity retention and averages are isolated',()=>{
 api.db.prepare("INSERT INTO activity_log(guild_id,timestamp,utc_hour,day_count,night_count) VALUES(?,'2000-01-01',12,9,0)").run(B);
 api.logSnapshot(A,{utcHour:12,byStatus:{day:2,available:3}});
 assert.equal(api.getHistoricalAverageByHour(A)[0].avg_active,5);assert.equal(api.getHistoricalAverageByHour(B)[0].avg_active,9);
});
test('settings and exports contain only the requested server',async()=>{
 api.setGuildSettings(B,{status_channel_id:'statusB',backup_channel_id:'backupB'});assert.notEqual(api.getGuildSettings(A).status_channel_id,'statusB');
 const file=path.join(folder,'export.sqlite');await api.createGuildBackup(B,file);const db=new Database(file,{readonly:true});
 try{for(const t of [...TABLES,'guild_settings']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE guild_id<>?`).get(B).n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM user_timezones').get().n,1);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal(migrate(db),false);}finally{db.close();}
});
test('channels from another server cannot be used',async()=>{
 const {fetchGuildChannel}=require('../utils/guildChannels');const client={channels:{fetch:async()=>({guildId:B})}};
 assert.equal(await fetchGuildChannel(client,A,'chan'),null);assert.equal((await fetchGuildChannel(client,B,'chan')).guildId,B);
});
test('all commands load and serialize without contacting Discord',()=>{
 for(const name of fs.readdirSync(path.join(__dirname,'../commands')).filter(n=>n.endsWith('.js'))){const c=require('../commands/'+name);assert(c.data.toJSON().name);assert.equal(typeof c.execute,'function');}
});
test('timers with equal event IDs coexist; rescheduling and removal affect one guild',async()=>{
 const event=require('../commands/event');
 const originalSet=global.setTimeout, originalClear=global.clearTimeout;
 const scheduled=[], cleared=[];
 global.setTimeout=(fn,delay)=>{const handle={fn,delay};scheduled.push(handle);return handle;};
 global.clearTimeout=handle=>cleared.push(handle);
 try {
  const ev={id:'TIME',name:'Timer',target_date:new Date(Date.now()+7200000).toISOString(),channel_id:'chan',message_id:'msg'};
  const client={channels:{fetch:async()=>null}};
  api.addEvent(A,ev);api.addEvent(B,ev);
  event.scheduleEventTimers(client,{...ev,guild_id:A});event.scheduleEventTimers(client,{...ev,guild_id:B});
  assert.equal(scheduled.length,6);assert.equal(cleared.length,0);
  event.scheduleEventTimers(client,{...ev,guild_id:A});assert.deepEqual(cleared,scheduled.slice(0,3));
  await event.execute({guildId:A,options:{getSubcommand:()=> 'remove',getString:()=> 'TIME'},client,reply:async()=>{}});
  assert.deepEqual(cleared.slice(3),scheduled.slice(6,9));assert(api.getEvent(B,'TIME'));
  // Missing channel must not prevent archiving, and the other guild remains separate.
  await scheduled[5].fn();assert.equal(api.getEvent(B,'TIME'),undefined);assert(api.eventIdExists(B,'TIME'));
 }finally{global.setTimeout=originalSet;global.clearTimeout=originalClear;}
});
test('autocomplete and event list expose only the current guild',async()=>{
 const event=require('../commands/event');
 api.addEvent(B,{id:'ONLY',name:'Only B',target_date:'2030-01-01',channel_id:null,message_id:null});
 let choices;await event.autocomplete({guildId:A,options:{getFocused:()=>''},respond:async c=>{choices=c;}});assert(!choices.some(c=>c.value==='ONLY'));
 await event.autocomplete({guildId:B,options:{getFocused:()=>''},respond:async c=>{choices=c;}});assert(choices.some(c=>c.value==='ONLY'));
});
test('role sync reads different timezone and availability for the same Discord member',async()=>{
 const {getGuildMembersTimezones,syncGuildActivityRoles}=require('../utils/roleManager');
 const {STATUS_ROLES}=require('../config/time');
 const guild=g=>({id:g,members:{cache:new Map([['user',{id:'user',user:{bot:false},roles:{cache:new Map(),add:async()=>{},remove:async()=>{}}}]])},roles:{cache:new (require('discord.js').Collection)(Object.values(STATUS_ROLES).map((r,i)=>[String(i),{id:String(i),name:r.roleName}]))}});
 const a=await getGuildMembersTimezones(guild(A));const b=await getGuildMembersTimezones(guild(B));assert.equal(a[0].utc_offset,2);assert.equal(b[0].utc_offset,-5);assert.notDeepEqual(a[0].slots,b[0].slots);
 assert.equal((await syncGuildActivityRoles(guild(A))).unassigned,0);
 const other=guild('3513221403833536552');assert.equal((await syncGuildActivityRoles(other)).unassigned,1);
});
test('older minimal activity schema migrates and accepts snapshots',()=>{
 const db=legacy();try{db.exec("ALTER TABLE activity_log DROP COLUMN peak_count; ALTER TABLE activity_log DROP COLUMN region_json;");migrate(db);assert(db.pragma('table_info(activity_log)').some(c=>c.name==='peak_count'));assert.equal(db.prepare('SELECT day_count FROM activity_log').get().day_count,4);}finally{db.close();}
});
test('global RSVP and availability handlers use the interaction guild; DMs are refused',async()=>{
 const vm=require('vm');const {createRequire}=require('module');const {EventEmitter}=require('events');
 const realRequire=createRequire(path.resolve(__dirname,'../index.js'));
 let client;
 class FakeClient extends EventEmitter {constructor(){super();client=this;this.guilds={cache:new Map()};}login(){return Promise.resolve();}}
 const source=fs.readFileSync(path.join(__dirname,'../index.js'),'utf8');
 vm.runInNewContext(source,{require:name=>name==='discord.js'?{...realRequire(name),Client:FakeClient}:name==='node-cron'?{schedule(){}}:realRequire(name),__dirname:path.resolve(__dirname,'..'),process,console,setTimeout,clearTimeout,fetch:()=>{throw new Error('Unexpected network');}});
 const handler=client.listeners('interactionCreate')[0];let response;
 await handler({guildId:null,guild:null,isAutocomplete:()=>false,isRepliable:()=>true,reply:async r=>{response=r;}});assert.match(response.content,/servers only/);
 const ev={id:'RSVP',name:'RSVP',target_date:'2030-01-01',channel_id:'chan',message_id:'msg'};
 api.addEvent(A,ev);api.addEvent(B,ev);
 const {EmbedBuilder,Collection}=require('discord.js');
 const guild={id:B,members:{cache:new Collection()},roles:{cache:new Collection(Object.values(require('../config/time').STATUS_ROLES).map((r,i)=>[String(i),{id:String(i),name:r.roleName}]))}};
 await handler({guildId:B,guild,channelId:'chan',user:{id:'user'},isButton:()=>true,customId:'rsvp_yes_RSVP',deferUpdate:async()=>{},message:{id:'msg',embeds:[new EmbedBuilder().addFields({name:'✅ Available (0)',value:'None'},{name:'🤔 Maybe (0)',value:'None'},{name:'❌ Unavailable (0)',value:'None'})]},editReply:async()=>{}});
 assert.equal(api.getEventRsvps(B,'RSVP')[0].status,'yes');assert.equal(api.getEventRsvps(A,'RSVP').length,0);
 await handler({guildId:B,guild,user:{id:'user'},isButton:()=>true,customId:'avail_clear',deferReply:async()=>{},editReply:async()=>{}});
 assert.equal(api.getUserAvailabilities(B,'user').length,0);assert.equal(api.getUserAvailabilities(A,'user').length,1);
});
test('migration preserves autoincrement sequence even when a table is empty',()=>{
 const db=legacy();try{db.exec('DELETE FROM map_objectives');migrate(db);const r=db.prepare("INSERT INTO map_objectives(guild_id,name,x,y,created_at,updated_at) VALUES(?,'Next',1,2,'now','now')").run(A);assert.equal(r.lastInsertRowid,91);}finally{db.close();}
});
