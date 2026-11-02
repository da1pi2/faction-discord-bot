require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { migrate } = require('../data/migrate');
async function main() {
  const file = path.resolve(process.argv[2] || process.env.DB_PATH || path.join(__dirname,'../data/activity.sqlite'));
  const db = new Database(file,{fileMustExist:true});
  try {
    if (db.pragma('integrity_check',{simple:true}) !== 'ok') throw new Error('Source integrity check failed');
    const folder=path.join(path.dirname(file),'backups');fs.mkdirSync(folder,{recursive:true});
    const backup=path.join(folder,`before-multiserver-${Date.now()}.sqlite`);
    await db.backup(backup);
    console.log('Safety backup:',backup);
    console.log(migrate(db) ? 'Migration complete; all legacy records assigned to Dragonfire.' : 'Already migrated; no changes.');
  } finally {db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
