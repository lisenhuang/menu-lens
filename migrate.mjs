import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {getObject,putObject,dishKey,objectSchema,objectExists} from './storage.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function copy(key,bytes,type,verifyOnly=false) {
  if (!verifyOnly) await putObject(key,bytes,type);
  if (!Buffer.from(bytes).equals(await getObject(key))) throw new Error('R2 verification failed for '+key);
}
const [mode,source]=process.argv.slice(2);
if (mode==='site') {
  const files=readdirSync(source,{recursive:true,withFileTypes:true}).filter(f=>f.isFile() && !f.name.startsWith('.'))
    .map(f=>join(f.parentPath,f.name).slice(source.length+1)).sort();
  const version=digest(files.map(name=>name+' '+digest(readFileSync(join(source,name)))).join('\n'));
  const prefix='site/'+version;
  const types={css:'text/css',html:'text/html',js:'application/javascript',json:'application/json',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2',txt:'text/plain'};
  for (const name of files) await copy(prefix+'/'+name,readFileSync(join(source,name)),types[name.split('.').at(-1)]);
  console.log(prefix);
} else if (mode==='map-key') {
  if (await objectExists('data/nz-restaurants.json')) console.log('data/nz-restaurants.json');
} else if (mode==='map') {
  await copy('data/nz-restaurants.json',readFileSync(source),'application/json');
  console.log('Verified restaurant index');
} else if (['copy','purge'].includes(mode)) {
  const path=join(process.env.DATA_DIR,'menu.sqlite');
  if (!existsSync(path)) process.exit(0);
  const db=new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout=10000; PRAGMA secure_delete=ON;'+objectSchema);
  if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name='dish_images'").get()) {
    const list=db.prepare('SELECT menu_id,position FROM dish_images ORDER BY menu_id,position').all();
    for (const {menu_id:id,position} of list) {
      const key=dishKey(id,position);
      if (mode==='copy' && db.prepare('SELECT 1 FROM dish_objects WHERE menu_id=? AND position=? AND object_key=?').get(id,position,key)) continue;
      const bytes=db.prepare('SELECT image FROM dish_images WHERE menu_id=? AND position=?').get(id,position).image;
      await copy(key,bytes,'image/webp',mode==='purge');
      db.prepare('INSERT OR REPLACE INTO dish_objects VALUES (?,?,?)').run(id,position,key);
    }
    if (mode==='purge') {
      db.exec('DROP TABLE dish_images; VACUUM; PRAGMA wal_checkpoint(TRUNCATE)');
    }
    console.log(list.length+' legacy dish images accounted for ('+mode+')');
  }
  // Legacy drafts keep their original consent and are never published as source photos.
  if (mode==='copy' && db.prepare("SELECT 1 FROM sqlite_schema WHERE name='drafts'").get()) {
    for (const draft of db.prepare("SELECT id,pages FROM drafts WHERE pages LIKE '%data:image/%'").all()) {
      const keys=[];
      for (const [i,url] of JSON.parse(draft.pages).entries()) {
        const key='originals/'+draft.id+'/'+i+'.jpg';
        await copy(key,Buffer.from(url.split(',')[1],'base64'),'image/jpeg');
        keys.push(key);
      }
      db.prepare('UPDATE drafts SET pages=? WHERE id=? AND pages=?').run(JSON.stringify(keys),draft.id,draft.pages);
    }
  }
  db.close();
} else throw new Error('Unknown migration operation');
