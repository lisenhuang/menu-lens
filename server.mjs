import {renderMenu} from './public/menu-view.js';
import {setTimeout as delay} from 'node:timers/promises';
import {getObject,putObject,deleteObject,dishKey,objectSchema,objectExists} from './storage.mjs';
import {createServer} from 'node:http';
import {createHash, randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {dirname, extname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateDish, googlePlaces, readMenu, RequestError, verifyPerson} from './providers.mjs';

import {generationHistory} from './usage.mjs';
import {defaultReader, imageModels, matchesPin, outputUsdPerMillion, readingModels, validateSettings} from './admin.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, 'public');
const sitePrefix=process.env.R2_SITE_PREFIX;
if (process.env.NODE_ENV==='production' && !sitePrefix) throw new Error('R2 site prefix is required');
const siteFile=name=>sitePrefix ? getObject(sitePrefix+'/'+name) : readFileSync(join(publicDir,name));
const document=(await siteFile('index.html')).toString('utf8');
const environment = process.env;
const dataDir = environment.DATA_DIR || join(root,'.local');
const liveOrigin = (environment.PUBLIC_ORIGIN || '').replace(/\/$/,'');
const ready = Boolean(environment.R2_GATEWAY_URL && environment.R2_GATEWAY_SECRET && environment.OPENAI_API_KEY && environment.TURNSTILE_SITE_KEY && environment.TURNSTILE_SECRET && environment.TURNSTILE_HOSTNAME);
const maxDishes = 100;
const pepper = randomBytes(24).toString('hex');
mkdirSync(dataDir,{recursive:true});
const db = new DatabaseSync(join(dataDir,'menu.sqlite'));
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS admin_sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS billing_snapshot (
    id INTEGER PRIMARY KEY CHECK(id=1), cents INTEGER NOT NULL, organization TEXT NOT NULL, checked TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS generation_settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL, details TEXT NOT NULL, reads INTEGER NOT NULL DEFAULT 0, read_success INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS counters (id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS menus (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL UNIQUE, restaurant_key TEXT NOT NULL,
    date TEXT NOT NULL, created TEXT NOT NULL, payload TEXT NOT NULL,
    state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS published_menus ON menus(state, date DESC, created DESC);
  ${objectSchema};
  CREATE TABLE IF NOT EXISTS object_cleanup (key TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
    state TEXT NOT NULL, pages TEXT NOT NULL, result TEXT, error TEXT
  );
  CREATE TRIGGER IF NOT EXISTS discard_draft_photos AFTER DELETE ON drafts BEGIN
    INSERT OR IGNORE INTO object_cleanup SELECT value FROM json_each(OLD.pages)
      WHERE value LIKE 'originals/%' AND value NOT IN (
        SELECT value FROM menus, json_each(menus.payload,'$.originals') WHERE menus.id=OLD.id);
  END;
  DELETE FROM drafts WHERE state='uploading';
  UPDATE menus SET state='queued' WHERE state='running';
  UPDATE drafts SET state='waiting' WHERE state='reading';
`);

if (!db.prepare('PRAGMA table_info(sessions)').all().some(column=>column.name==='read_success')) {
  db.exec('ALTER TABLE sessions ADD COLUMN read_success INTEGER NOT NULL DEFAULT 0');
}

if (!db.prepare('PRAGMA table_info(drafts)').all().some(column=>column.name==='read_ip')) {
  db.exec('ALTER TABLE drafts ADD COLUMN read_ip TEXT');
}

const mime = {'html':'text/html; charset=utf-8','css':'text/css; charset=utf-8','js':'application/javascript; charset=utf-8','webp':'image/webp','svg':'image/svg+xml','woff2':'font/woff2','txt':'text/plain; charset=utf-8'};
const statusText = 'Menu submissions are temporarily unavailable. Please try again later.';
const publicId = /^[a-f0-9]{20}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const normalize = value => value.normalize('NFKC').toLocaleLowerCase('en-NZ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function settings() {
  const row = db.prepare('SELECT value FROM generation_settings WHERE id=1').get();
  const current={model:environment.OPENAI_IMAGE_MODEL || 'gpt-image-2.6-sunburst',quality:'high',readingModel:defaultReader,reasoning:'high',
    ...(row && JSON.parse(row.value))};
  if (!Object.hasOwn(readingModels,current.readingModel)) current.readingModel=defaultReader;
  if (!readingModels[current.readingModel].efforts.includes(current.reasoning)) current.reasoning='high';
  return current;
}

const history = generationHistory(db);
function readForRun(id,pages,requestIp) {
  const {readingModel:model,reasoning}=settings();
  return history.measure(id,'read','Menu transcription',model,reasoning,received=>{
    notifyProgress(id);
    return readMenu(pages,model,reasoning,received);
  },requestIp);
}
const placesPath = environment.NZ_RESTAURANT_INDEX || '';
const placesData = environment.R2_MAP_KEY ? await getObject(environment.R2_MAP_KEY) : placesPath && existsSync(placesPath) ? readFileSync(placesPath) : null;
const directories=JSON.parse((await siteFile('restaurant-branches.json')).toString());
const officialBranches=directories.flatMap(({name,aliases=[],source,branches})=>branches.map(branch=>({
  ...branch,name,aliases,fullAddress:true,attributions:[{provider:name+' locations',providerUri:source}],
})));
const directoryIds=new Set(officialBranches.map(place=>place.id));
const osmPlaces=placesData ? JSON.parse(placesData).places.filter(place=>!directoryIds.has(place.id)) : [];
const searchText=value=>normalize(value.normalize('NFKD').replace(/\p{M}/gu,'')).replace(/\bmt\b/g,'mount');
const nzPlaces=[...officialBranches,...osmPlaces].map(({aliases=[],...place})=>({
  ...place,search:searchText([place.name,...aliases,place.branch,place.address].filter(Boolean).join(' ')),nameKey:searchText(place.name),
}));
function localPlaces(query) {
  const search = searchText(query);
  if (!search) return [];
  const terms = search.split(' ');
  const score = place=>place.nameKey===search ? 0 : place.nameKey.startsWith(search) ? 1 : place.nameKey.includes(search) ? 2 : 3;
  return nzPlaces.filter(place=>terms.every(term=>place.search.includes(term)))
    .sort((a,b)=>score(a)-score(b) || Number(b.fullAddress)-Number(a.fullAddress) || a.name.localeCompare(b.name))
    .slice(0,20).map(({search,nameKey,...place})=>place);
}
// A provider may return only one outlet for a brand. Supplement it with branches
// from the business's directory, matching the physical location before merging.
function supplementBranches(places,branches) {
  const results=[...places];
  for (const branch of branches) {
    const match=places.find(place=>Math.abs(place.lat-branch.lat)<0.0005 &&
      Math.abs(place.lng-branch.lng)<0.0005 && (' '+searchText(place.name)+' ').includes(' '+searchText(branch.name)+' '));
    if (match) match.branch=branch.branch;
    else results.push(branch);
  }
  return results;
}
const escape = value => String(value).replace(/[&<>"']/g, character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[character]);
function clean(value, limit, label) {
  if (typeof value !== 'string' || value.length > limit) throw new RequestError(400,`${label} is missing or exceeds the supported length.`);
  return value.replace(/\r\n?/g,'\n').trim();
}

function write(res,status,data,type='application/json; charset=utf-8', headers={}) {
  res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store',...headers});
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}

async function json(req,max=512_000) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new RequestError(415,'Send a JSON request.');
  if (Number(req.headers['content-length']) > max) throw new RequestError(413,'The upload is too large.');
  const chunks = [];
  let length = 0;
  const stream = req.iterator({destroyOnReturn:false});
  for await (const chunk of stream) {
    length += chunk.length;
    if (length > max) {
      req.resume();
      throw new RequestError(413,'The upload is too large.');
    }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString());
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {}
  throw new RequestError(400, 'This request could not be read.');
}

function clientIp(req) {
  return environment.TRUST_CLOUDFLARE === '1' ? req.headers['cf-connecting-ip'] || '' : req.socket.remoteAddress;
}

function recordRequestCity(id,req) {
  const raw=req.headers['cf-ipcity'];
  if (environment.TRUST_CLOUDFLARE!=='1' || typeof raw!=='string' || raw.length>512) return;
  // Node exposes header bytes as Latin-1. Cloudflare sends city names in UTF-8.
  const city=Buffer.from(raw,'latin1').toString('utf8').trim();
  if (city && !/[\p{Cc}\p{Cf}\uFFFD]/u.test(city)) history.recordCity(id,clientIp(req),city);
}

function rate(id, limit, ttl, quantity=1) {
  const now = Date.now();
  if (!Number.isSafeInteger(limit) || limit < 1 || quantity > limit) return false;
  return Boolean(db.prepare(`
    INSERT INTO counters (id,count,expires) VALUES (?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      count=CASE WHEN counters.expires<=? THEN excluded.count ELSE counters.count+excluded.count END,
      expires=CASE WHEN counters.expires<=? THEN excluded.expires ELSE counters.expires END
    WHERE counters.expires<=? OR counters.count+excluded.count<=?
    RETURNING count
  `).get(id,quantity,now+ttl,now,now,now,limit));
}

function limit(req, route, count, seconds) {
  if (!rate(route+':'+sha(pepper+clientIp(req)),count,seconds*1000)) {
    throw new RequestError(429,'Too many requests. Please try again in a little while.');
  }
}

function session(req, required=true) {
  const token = req.headers.cookie?.match(/(?:^|;\s*)ml_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const row = token && db.prepare('SELECT * FROM sessions WHERE id=? AND expires>?').get(sha(token),Date.now());
  if (!row && required) throw new RequestError(403,'Your verification has expired. Go back and verify again.');
  return row;
}

// Each upload keeps its own HttpOnly cookie, so a second submission cannot displace it.
const submissionId = owner => sha('menu-lens/submission/'+owner).slice(0,20);
function jobOwner(req) {
  const token = req.headers.cookie?.match(/(?:^|;\s*)ml_job=([a-f0-9]{64})(?:;|$)/)?.[1];
  return token ? sha(token) : session(req,false)?.id;
}
function privateDraft(id, owner) {
  const draft = owner && db.prepare(`SELECT drafts.state, sessions.details, sessions.reads, sessions.expires, drafts.error, json_array_length(drafts.pages) AS pageCount
    FROM drafts JOIN sessions ON sessions.id=drafts.owner
    WHERE drafts.id=? AND drafts.owner=? AND sessions.expires>?`).get(id,owner,Date.now());
  if (!draft) throw new RequestError(404,'This submission is unavailable. Open it in the browser you used to upload.');
  return draft;
}
const activeDishes=new Map();
function savedPositions(id) {
  return db.prepare('SELECT position FROM dish_objects WHERE menu_id=? ORDER BY position').all(id).map(row=>row.position);
}
function jobStatus(row,owner) {
  const {restaurant,dishes}=JSON.parse(row.payload);
  const readyPositions=savedPositions(row.id);
  const activePositions=[...(activeDishes.get(row.id) || [])];
  return {id:row.id,name:restaurant.name,state:row.state,completed:readyPositions.length,total:dishes.length,
    readyPositions,activePositions,illustrating:activePositions.map(i=>dishes[i].name),
    canRetry:row.state==='error' && row.owner===owner && row.attempts<3};
}

const activeStates=new Set(['uploading','waiting','reading','queued','running']);
const watchers=new Map();
let openStreams=0;

function submissionStatus(id,owner) {
  const row=db.prepare('SELECT * FROM menus WHERE id=?').get(id);
  if (row) return jobStatus(row,owner);
  const draft=privateDraft(id,owner);
  const {restaurant,date}=JSON.parse(draft.details);
  const transcribing=draft.state==='reading' && Boolean(db.prepare("SELECT 1 FROM generation_calls WHERE run_id=? AND kind='read' AND state='running'").get(id));
  return {id,name:restaurant.name,restaurant,date,state:draft.state,error:draft.error,pageCount:draft.pageCount,transcribing,
    readAttempt:draft.reads,expires:draft.expires,canRetryRead:draft.state==='read_error' && draft.pageCount>0 && draft.reads<maxReadAttempts};
}
function notifyProgress(id) {
  for (const send of watchers.get(id) || []) send();
}
function streamProgress(res,id,owner) {
  const initial=submissionStatus(id,owner);
  const group=watchers.get(id) || new Set();
  if (openStreams>=512 || group.size>=40) throw new RequestError(429,'Live updates are busy. Checking again shortly.');
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'private, no-store, no-transform',
    'X-Accel-Buffering':'no','Vary':'Cookie'});
  let last;
  function send(snapshot) {
    if (res.destroyed || res.writableEnded) return;
    try {
      const status=snapshot || submissionStatus(id,owner);
      const data=JSON.stringify(status);
      if (data!==last) {
        last=data;
        if (!res.write('data: '+data+'\n\n')) {res.end();return;}
      }
      if (!activeStates.has(status.state) && !(status.state==='error' && status.completed>0)) res.end();
    } catch {res.end();}
  }
  // The heartbeat keeps proxies open and rechecks draft expiry during long reads.
  const heartbeat=setInterval(()=>{
    if (!res.write(': heartbeat\n\n')) {res.end();return;}
    send();
  },15000);
  watchers.set(id,group);
  group.add(send);
  openStreams++;
  res.once('close',()=>{
    clearInterval(heartbeat);
    group.delete(send);
    if (!group.size) watchers.delete(id);
    openStreams--;
  });
  send(initial);
}

// The private draft cookie is scoped to its API path. HTML can show approved menu
// progress directly, while draft details arrive through the authenticated stream.
function progressDocument(menu) {
  const status=menu && jobStatus(menu);
  const title=status ? escape(status.name) : 'Opening your submission';
  const message=status ? `${status.completed} of ${status.total} dish images ready` : 'Checking your menu’s progress…';
  const content=`<main id="main" class="shell"><div class="page" id="job-opening">
    <a class="breadcrumb" href="/explore">Explore menus</a><div class="page-heading">
    <p class="eyebrow page-kicker">MENU SUBMISSION</p><h1 class="page-title">${title}</h1>
    <p class="page-intro">${message}</p></div></div></main>`;
  return document.replace(/<main id="main"[\s\S]*?<\/main>/,()=>content);
}

function details(body) {
  const name = clean(body.name,180,'Restaurant name');
  const address = clean(body.address,400,'Restaurant address');
  const date = clean(body.date,10,'Menu date');
  const calendar = new Date(date+'T00:00:00.000Z');
  const tomorrow = new Date(Date.now()+86_400_000).toISOString().slice(0,10);
  if (!name || !address) throw new RequestError(400,'Enter the restaurant name and select its location or enter an address.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(calendar.getTime()) || calendar.toISOString().slice(0,10) !== date || date > tomorrow || date < '1900-01-01') {
    throw new RequestError(400,'Enter the date the menu was photographed.');
  }
  const placeId = typeof body.placeId === 'string' && /^[A-Za-z0-9_-]{5,180}$/.test(body.placeId) ? body.placeId : '';
  const addressKey = sha(normalize(name)+'\u0000'+normalize(address)).slice(0,24);
  const restaurant = {name,address,placeId,key:placeId ? sha(placeId).slice(0,24) : addressKey,addressKey};
  if (body.pin!=null) {
    const {lat,lng}=body.pin;
    if (!Number.isFinite(lat) || Math.abs(lat)>90 || !Number.isFinite(lng) || Math.abs(lng)>180) {
      throw new RequestError(400,'Check the latitude and longitude of the restaurant pin.');
    }
    restaurant.pin={lat,lng};
  }
  return {restaurant,date,autoPublish:body.autoPublish===true,shareOriginals:body.shareOriginals===true,consentAt:new Date().toISOString()};
}

function menuText(body) {
  if (!Array.isArray(body.dishes) || body.dishes.length < 1 || body.dishes.length > maxDishes) {
    throw new RequestError(400,`A submission needs between 1 and ${maxDishes} dishes. For a larger menu, use a set of pages at a time.`);
  }
  const dishes = body.dishes.map((dish,index)=>{
    if (!dish || typeof dish !== 'object') throw new RequestError(400,'Review the dish list.');
    const name = clean(dish.name,300,'A dish name');
    if (!name) throw new RequestError(400,`Dish ${index+1} needs a name.`);
    return {id:`dish-${index+1}`,name,section:clean(dish.section,160,'A section'),description:clean(dish.description,1800,'A dish description'),price:clean(dish.price,240,'A dish price')};
  });
  return {dishes,notes:clean(body.notes,9000,'Menu notes'),transcript:clean(body.transcript,65000,'Original information')};
}

function card(row,first=row.firstPhoto ?? 0) {
  const {restaurant,dishes}=JSON.parse(row.payload);
  return {id:row.id,restaurant,date:row.date,published:row.created,cover:`/media/${row.id}/${first}.webp`,
    state:row.state,count:dishes.length,completed:row.completed ?? dishes.length};
}
function publicMenu(row) {
  if (!row) return null;
  const status=jobStatus(row);
  if (row.state!=='complete' && !status.completed) return null;
  const {dishes,restaurant,notes,originals=[]}=JSON.parse(row.payload);
  const versions=db.prepare(`
    SELECT id,date,created FROM menus WHERE state='complete' AND id<>?
      AND (restaurant_key=? OR json_extract(payload,'$.restaurant.addressKey')=?)
    ORDER BY date DESC,created DESC LIMIT 30
  `).all(row.id,restaurant.key,restaurant.addressKey);
  const saved=new Set(status.readyPositions);
  return {
    ...card(row,status.readyPositions[0]),completed:status.completed,activePositions:status.activePositions,
    notes,versions,originalCount:originals.length,
    originals:row.state==='complete' ? originals.map((_,i)=>`/originals/${row.id}/${i}.jpg`) : [],
    dishes:dishes.map((dish,i)=>({...dish,position:i,active:status.activePositions.includes(i),
      image:saved.has(i) ? `/media/${row.id}/${i}.webp` : null})),
  };
}

const pendingLimit = 3;
const maxReadAttempts=3;
let readingDrafts = false;
async function readDrafts() {
  if (readingDrafts || !ready) return;
  readingDrafts = true;
  try {
    let draft;
    while ((draft=db.prepare(`SELECT drafts.*, sessions.details FROM drafts JOIN sessions ON sessions.id=drafts.owner
      WHERE drafts.state='waiting' AND sessions.expires>? ORDER BY drafts.rowid LIMIT 1`).get(Date.now()))) {
      db.prepare("UPDATE drafts SET state='reading' WHERE id=?").run(draft.id);
      notifyProgress(draft.id);
      try {
        const pages=await Promise.all(JSON.parse(draft.pages).map(async key=>
          'data:image/jpeg;base64,'+(await getObject(key)).toString('base64')));
        const output=await readForRun(draft.id,pages,draft.read_ip);
        if (!output.isMenu) throw new RequestError(422,'These photos could not be recognised as a restaurant menu. Try a clearer photo.');
        if (output.dishes.length && output.dishes.every(dish=>dish.hasDishPhoto===true)) {
          discardIllustratedDraft(draft,'Every dish on this menu already has a photo. No dish illustrations were generated.');
          continue;
        }
        if (JSON.parse(draft.details).autoPublish) {
          enqueueMenu(draft,output,draft.read_ip);
        } else {
          db.prepare("UPDATE drafts SET state='review', result=? WHERE id=?").run(JSON.stringify(output),draft.id);
          notifyProgress(draft.id);
        }
      } catch (error) {
        const message = error instanceof RequestError ? error.message : 'The menu could not be read. Try again with a clear photo.';
        db.prepare("UPDATE drafts SET state='read_error',error=? WHERE id=?").run(message,draft.id);
        notifyProgress(draft.id);
      }
    }
  } finally {
    readingDrafts = false;
  }
}
function discardIllustratedDraft(draft,message) {
  db.exec('BEGIN');
  try {
    db.prepare('INSERT OR IGNORE INTO object_cleanup SELECT value FROM json_each(?)').run(draft.pages);
    db.prepare("UPDATE drafts SET state='already_illustrated',error=?,pages='[]' WHERE id=?").run(message,draft.id);
    db.exec('COMMIT');
  } catch(error) {db.exec('ROLLBACK');throw error;}
  notifyProgress(draft.id);
  void cleanObjects();
}
async function cleanObjects() {
  try {
    for (const {key} of db.prepare('SELECT key FROM object_cleanup').all()) {
      await deleteObject(key);
      db.prepare('DELETE FROM object_cleanup WHERE key=?').run(key);
    }
  } catch(error) {console.error('Object cleanup deferred',error.name);}
}
void cleanObjects();
function queueReading() {
  void readDrafts().catch(error=>console.error('Menu reading queue failed',error.name));
}
queueReading();
let working = false;
async function runQueue() {
  if (working) return;
  working = true;
  try {
    let row;
    while ((row=db.prepare("SELECT * FROM menus WHERE state='queued' ORDER BY created LIMIT 1").get())) {
      db.prepare("UPDATE menus SET state='running' WHERE id=?").run(row.id);
      notifyProgress(row.id);
      const {dishes,imageSettings} = JSON.parse(row.payload);
      const imageConfig = imageSettings || {model:environment.OPENAI_IMAGE_MODEL || 'gpt-image-2.6-flare',quality:'medium'};
      const done = new Set(db.prepare('SELECT position FROM dish_objects WHERE menu_id=?').all(row.id).map(item=>item.position));
      const remaining = dishes.map((dish,i)=>({dish,i})).filter(item=>!done.has(item.i));
      const active=new Set();
      activeDishes.set(row.id,active);
      try {
        for (let i=0;i<remaining.length;i+=2) {
          const results = await Promise.allSettled(remaining.slice(i,i+2).map(async item=>{
            try {
              const key=dishKey(row.id,item.i);
              // A restart can land between a successful R2 write and its SQLite checkpoint.
              if (!await objectExists(key)) {
                const bytes=await history.measure(row.id,'image',item.dish.name,imageConfig.model,imageConfig.quality,received=>{
                  active.add(item.i);
                  notifyProgress(row.id);
                  return generateDish(item.dish,imageConfig,received);
                });
                await putObject(key,bytes,'image/webp');
              }
              db.prepare('INSERT INTO dish_objects VALUES (?,?,?)').run(row.id,item.i,key);
            } finally {
              active.delete(item.i);
              notifyProgress(row.id);
            }
          }));
          if (results.some(result=>result.status==='rejected')) throw new Error('Image batch unfinished');
        }
        db.prepare("UPDATE menus SET state='complete',created=? WHERE id=?").run(new Date().toISOString(),row.id);
      } catch {
        db.prepare("UPDATE menus SET state='error' WHERE id=?").run(row.id);
      }
      activeDishes.delete(row.id);
      notifyProgress(row.id);
    }
  } finally {
    working = false;
  }
}
function queue() {
  if (ready) void runQueue().catch(error=>console.error('Queue failed',error.name));
}
queue();
setInterval(()=>{
  const now = Date.now();
  db.prepare('DELETE FROM admin_sessions WHERE expires<=?').run(now);
  db.prepare('DELETE FROM counters WHERE expires<=?').run(now);
  db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
  const cutoff = new Date(now-604_800_000).toISOString();
  const abandoned="state='error' AND created<? AND NOT EXISTS (SELECT 1 FROM dish_objects WHERE menu_id=menus.id)";
  db.prepare(`INSERT OR IGNORE INTO object_cleanup SELECT value FROM menus,json_each(payload,'$.originals') WHERE ${abandoned}`).run(cutoff);
  db.prepare(`DELETE FROM menus WHERE ${abandoned}`).run(cutoff);
  void cleanObjects();
},3_600_000).unref();

function validatePages(body) {
  if (!Array.isArray(body.pages) || !body.pages.length || body.pages.length>6 || body.pages.some(page=>(
    typeof page !== 'string' || page.length>3_000_000 || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(page)
  ))) throw new RequestError(400,'Upload between one and six readable menu photos.');
}
// Reserve queue capacity and an attempt together with the draft state change.
function reserveRead(owner,autoPublish) {
  const outstanding=db.prepare("SELECT count(*) AS count FROM drafts WHERE state IN ('uploading','waiting','reading')").get().count;
  if (outstanding>=pendingLimit) throw new RequestError(429,'The reading queue is full. Please try again in a few minutes.');
  if (autoPublish) checkImageQueue();
  const reserved=db.prepare('UPDATE sessions SET reads=reads+1 WHERE id=? AND reads<? AND expires>?').run(owner,maxReadAttempts,Date.now());
  if (!reserved.changes) throw new RequestError(429,'This draft has reached its reading limit or expired.');
  if (!rate('reading:daily',45,86_400_000)) throw new RequestError(429,'Today’s reading capacity has been reached. Please try again later.');
}
function checkImageQueue() {
  // Automatic submissions reserve an image slot before paying for transcription.
  const outstanding=db.prepare(`SELECT
    (SELECT count(*) FROM menus WHERE state IN ('queued','running')) +
    (SELECT count(*) FROM drafts JOIN sessions ON sessions.id=drafts.owner
      WHERE drafts.state IN ('uploading','waiting','reading') AND json_extract(details,'$.autoPublish')=1) AS count`).get().count;
  if (outstanding>=pendingLimit) throw new RequestError(429,'The image queue is full. Please try again in a few minutes.');
}
async function publish(req,res,id,owner) {
  const existing = db.prepare('SELECT id FROM menus WHERE owner=?').get(owner.id);
  if (existing) return write(res,202,existing);
  limit(req,'publish',5,86_400);
  const body = await json(req);
  const duplicate = db.prepare('SELECT id FROM menus WHERE owner=?').get(owner.id);
  if (duplicate) return write(res,202,duplicate);
  const draft=db.prepare('SELECT * FROM drafts WHERE id=? AND owner=?').get(id,owner.id);
  if (draft?.state!=='review') throw new RequestError(403,'Read the uploaded menu before publishing.');
  if (body.useTranscription!==true && body.reviewed!==true) throw new RequestError(403,'Choose Generate & publish to share this draft.');
  checkImageQueue();
  enqueueMenu({...draft,details:owner.details},body.useTranscription===true ? JSON.parse(draft.result) : body,clientIp(req));
  recordRequestCity(id,req);
  return write(res,202,{id});
}
function enqueueMenu(draft,output,requestIp) {
  const {id,owner}=draft;
  const {date,restaurant,consentAt,shareOriginals}=JSON.parse(draft.details);
  const {model,quality}=settings();
  const payload={...menuText(output),restaurant,consentAt,imageSettings:{model,quality},
    originals:shareOriginals ? JSON.parse(draft.pages) : []};
  db.exec('BEGIN');
  try {
    db.prepare("INSERT INTO menus (id,owner,restaurant_key,date,created,payload,state) VALUES (?,?,?,?,?,?,'queued')")
      .run(id,owner,restaurant.key,date,new Date().toISOString(),JSON.stringify(payload));
    history.imageRequester(id,requestIp);
    db.prepare('DELETE FROM drafts WHERE id=?').run(id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  notifyProgress(id);
  queue();
}
function retryImages(req,res,id,owner) {
  limit(req,'retry',6,600);
  checkImageQueue();
  const retried = db.prepare("UPDATE menus SET state='queued', attempts=attempts+1 WHERE id=? AND owner=? AND state='error' AND attempts<3").run(id,owner);
  if (!retried.changes) throw new RequestError(409,'This menu cannot be retried right now.');
  history.imageRequester(id,clientIp(req));
  recordRequestCity(id,req);
  notifyProgress(id);
  queue();
  return write(res,202,{ok:true});
}

async function submitPages(req,id,owner,body) {
  const existing=db.prepare('SELECT state FROM drafts WHERE id=? UNION ALL SELECT state FROM menus WHERE id=?').get(id,id);
  if (existing?.state==='uploading') throw new RequestError(409,'Your upload is still in progress.');
  if (existing) return;
  const {autoPublish,shareOriginals,restaurant}=JSON.parse(owner.details);
  if (!shareOriginals) throw new RequestError(403,'Start a new submission to confirm sharing the original photos.');
  validatePages(body);
  const prefix='originals/'+randomBytes(16).toString('hex')+'/';
  const keys=body.pages.map((_,i)=>prefix+i+'.jpg');
  db.exec('BEGIN IMMEDIATE');
  try {
    reserveRead(owner.id,autoPublish);
    if (autoPublish) limit(req,'publish',5,86_400);
    db.prepare("INSERT INTO drafts (id,owner,state,pages,read_ip) VALUES (?,?,'uploading',?,?)").run(id,owner.id,JSON.stringify(keys),clientIp(req));
    db.exec('COMMIT');
  } catch(error) {db.exec('ROLLBACK');throw error;}
  try {
    for (const [i,page] of body.pages.entries()) {
      await putObject(keys[i],Buffer.from(page.split(',')[1],'base64'),'image/jpeg');
    }
    history.register(id,restaurant.name,clientIp(req));
    recordRequestCity(id,req);
    db.prepare("UPDATE drafts SET state='waiting' WHERE id=?").run(id);
    notifyProgress(id);
  } catch(error) {
    db.prepare('DELETE FROM drafts WHERE id=?').run(id);
    void cleanObjects();
    throw error;
  }
  queueReading();
}

async function retryReading(req,res,id,owner) {
  const {attempt}=await json(req,1024);
  db.exec('BEGIN IMMEDIATE');
  try {
    const draft=privateDraft(id,owner);
    if (!Number.isInteger(attempt) || attempt<1 || attempt>draft.reads) throw new RequestError(400,'Reopen the draft to retry reading.');
    // A repeated request for an older attempt must never start another paid read.
    if (attempt===draft.reads) {
      if (draft.state!=='read_error' || !draft.pageCount) throw new RequestError(409,'This draft has no failed read with saved photos to retry.');
      reserveRead(owner,JSON.parse(draft.details).autoPublish);
      recordRequestCity(id,req);
      db.prepare("UPDATE drafts SET state='waiting',error=NULL,read_ip=? WHERE id=?").run(clientIp(req),id);
    }
    db.exec('COMMIT');
  } catch(error) {db.exec('ROLLBACK');throw error;}
  notifyProgress(id);
  queueReading();
  return write(res,202,{id});
}

async function jobApi(req,res,id,action) {
  const owner = jobOwner(req);
  if (req.method==='GET') {
    if (action==='events') return streamProgress(res,id,owner);
    if (!action) return write(res,200,submissionStatus(id,owner));
    const draft=privateDraft(id,owner);
    if (action==='review' && draft.state==='review') {
      const result = db.prepare('SELECT result,json_array_length(pages) AS photoCount FROM drafts WHERE id=?').get(id);
      return write(res,200,{...JSON.parse(result.result),photoCount:result.photoCount});
    }
    if (/^photos\/[0-5]$/.test(action) && draft.state==='review') {
      const photo = db.prepare('SELECT json_extract(pages,?) AS page FROM drafts WHERE id=?').get('$['+action.slice(7)+']',id).page;
      if (photo) return write(res,200,await getObject(photo),'image/jpeg');
    }
  } else if (req.method==='POST') {
    const row=db.prepare('SELECT * FROM menus WHERE id=?').get(id);
    if (!ready) throw new RequestError(503,statusText);
    if (!owner || (row ? row.owner!==owner : submissionId(owner)!==id)) throw new RequestError(403,'Open this submission in the browser you used to upload.');
    if (row && action==='retry') return retryImages(req,res,id,owner);
    if (row && ['publish','upload'].includes(action)) return write(res,202,{id});
    const active = db.prepare('SELECT * FROM sessions WHERE id=? AND expires>?').get(owner,Date.now());
    if (!active) throw new RequestError(403,'Your upload has expired. Start a new submission.');
    if (action==='retry-read') return retryReading(req,res,id,owner);
    if (action==='publish') return publish(req,res,id,active);
    if (action==='upload') {
      limit(req,'read',9,86_400);
      const body = await json(req,16_000_000);
      await submitPages(req,id,active,body);
      return write(res,202,{id});
    }
  }
  throw new RequestError(404,'This page could not be found.');
}

async function adminApi(req,res,path) {
  const verifier = environment.ADMIN_PIN_VERIFIER;
  if (!verifier) throw new RequestError(503,'Admin sign-in is unavailable.');
  const cookieSuffix = '; Path=/api/admin; HttpOnly; SameSite=Strict'+(liveOrigin.startsWith('https:') ? '; Secure' : '');
  if (path==='/api/admin/login' && req.method==='POST') {
    limit(req,'admin-login',10,900);
    const {pin,token} = await json(req,4096);
    await verifyPerson(token,clientIp(req),'admin_login');
    if (!rate('admin-pin-attempts',30,900_000)) throw new RequestError(429,'Too many sign-in attempts. Try again in 15 minutes.');
    if (!await matchesPin(pin,verifier)) throw new RequestError(401,'Sign-in failed. Check your PIN and try again.');
    const sessionToken = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO admin_sessions (id,expires) VALUES (?,?)').run(sha(verifier+sessionToken),Date.now()+4*3_600_000);
    return write(res,200,{ok:true},undefined,{'Set-Cookie':`ml_admin=${sessionToken}${cookieSuffix}; Max-Age=14400`});
  }
  const token=req.headers.cookie?.match(/(?:^|;\s*)ml_admin=([a-f0-9]{64})(?:;|$)/)?.[1];
  const id=token && sha(verifier+token);
  if (!id || !db.prepare('SELECT 1 FROM admin_sessions WHERE id=? AND expires>?').get(id,Date.now())) {
    throw new RequestError(401,'Sign in to manage generation settings.');
  }
  if (path==='/api/admin/history' && req.method==='GET') {
    const raw=new URL(req.url,'http://localhost').searchParams.get('before');
    const before=raw===null ? Number.MAX_SAFE_INTEGER : Number(raw);
    if (!Number.isSafeInteger(before) || before<1) throw new RequestError(400,'Invalid history page.');
    return write(res,200,history.list(before));
  }
  const runId=path.match(/^\/api\/admin\/history\/([a-f0-9]{20})$/)?.[1];
  if (runId && req.method==='GET') return write(res,200,{calls:history.calls(runId)});
  if (path==='/api/admin/logout' && req.method==='POST') {
    db.prepare('DELETE FROM admin_sessions WHERE id=?').run(id);
    return write(res,200,{ok:true},undefined,{'Set-Cookie':`ml_admin=${cookieSuffix}; Max-Age=0`});
  }
  if (path==='/api/admin/balance' && req.method==='POST') {
    const body=await json(req,1024);
    const organization=clean(body.organization,160,'Organization');
    if (!organization || typeof body.usd!=='string' || !/^-?\d{1,9}(?:\.\d{1,2})?$/.test(body.usd)) {
      throw new RequestError(400,'Enter the organization and its USD balance from OpenAI Billing.');
    }
    const balance={cents:Math.round(Number(body.usd)*100),organization,checked:new Date().toISOString()};
    db.prepare('INSERT OR REPLACE INTO billing_snapshot (id,cents,organization,checked) VALUES (1,?,?,?)')
      .run(balance.cents,balance.organization,balance.checked);
    return write(res,200,{balance});
  }
  if (path==='/api/admin/settings' && req.method==='GET') {
    const current=settings();
    const balance=db.prepare('SELECT cents,organization,checked FROM billing_snapshot WHERE id=1').get() ?? null;
    return write(res,200,{settings:current,imageModels,outputUsdPerMillion,readingModels,balance,
      readingModel:current.readingModel,readingEfforts:readingModels[current.readingModel].efforts});
  }
  if (path==='/api/admin/settings' && req.method==='POST') {
    const body=await json(req,2048);
    const next=validateSettings({readingModel:settings().readingModel,...body});
    db.prepare('INSERT INTO generation_settings VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(next));
    return write(res,200,{settings:next});
  }
  throw new RequestError(404,'This page could not be found.');
}

async function api(req,res,path) {
  const get = req.method === 'GET';
  if (path.startsWith('/api/admin/')) return adminApi(req,res,path);
  if (path === '/api/config' && get) return write(res,200,{
    siteKey:environment.TURNSTILE_SITE_KEY || '',
    generation:ready, places:Boolean(environment.GOOGLE_PLACES_API_KEY || nzPlaces.length),maxDishes,
  });
  if (path === '/api/menus' && get) {
    const rows=db.prepare(`SELECT menus.*,min(position) AS firstPhoto,count(position) AS completed
      FROM menus JOIN dish_objects ON menu_id=menus.id GROUP BY menus.id
      ORDER BY date DESC,created DESC LIMIT 200`).all();
    return write(res,200,rows.map(row=>card(row)));
  }
  const menuId = path.match(/^\/api\/menus\/([a-f0-9]{20})$/)?.[1];
  if (menuId && get) {
    const menu=publicMenu(db.prepare('SELECT * FROM menus WHERE id=?').get(menuId));
    if (!menu) throw new RequestError(404,'This menu could not be found.');
    return write(res,200,menu);
  }
  const job = path.match(/^\/api\/jobs\/([a-f0-9]{20})(?:\/(events|review|upload|publish|retry-read|retry|photos\/[0-5]))?$/);
  if (job) return jobApi(req,res,job[1],job[2]);
  if (req.method !== 'POST') throw new RequestError(404,'This page could not be found.');
  if (path === '/api/places') {
    limit(req,'places',24,600);
    const body = await json(req,2500);
    const query = clean(body.query,220,'Restaurant search');
    if (query.length < 2) throw new RequestError(400,'Type a restaurant name to search.');
    const local=localPlaces(query);
    if (environment.GOOGLE_PLACES_API_KEY) {
      try {
        const {places}=await googlePlaces(query);
        if (places.length) return write(res,200,{places:supplementBranches(places,local.filter(place=>directoryIds.has(place.id))),source:'google'});
      } catch (error) {
        if (!nzPlaces.length) throw error;
      }
    }
    return write(res,200,{places:local,source:local.some(place=>!directoryIds.has(place.id))?'osm':'directory'});
  }
  if (!['/api/verify','/api/read','/api/publish','/api/retry'].includes(path)) throw new RequestError(404,'This page could not be found.');
  if (!ready) throw new RequestError(503,statusText);
  if (path === '/api/verify') {
    limit(req,'verify',12,3600);
    const body = await json(req,6000);
    if (body.shareOriginals !== true) throw new RequestError(403,'Refresh the page and agree to share the original menu photos.');
    if (body.consent !== true) throw new RequestError(403,'Agree to publish the menu before continuing.');
    const info = details(body);
    await verifyPerson(body.token,clientIp(req));
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions(id,expires,details) VALUES (?,?,?)').run(sha(token),Date.now()+86_400_000,JSON.stringify(info));
    const secure = liveOrigin.startsWith('https:') ? '; Secure' : '';
    const id = submissionId(sha(token));
    return write(res,200,{ok:true,id},undefined,{'Set-Cookie':[
      `ml_session=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=86400${secure}`,
      `ml_job=${token}; Path=/api/jobs/${id}; HttpOnly; SameSite=Strict; Max-Age=2592000${secure}`,
    ]});
  }
  const owner = session(req);
  if (path === '/api/read') {
    limit(req,'read',9,86_400);
    const body = await json(req,16_000_000);
    const id=submissionId(owner.id);
    await submitPages(req,id,owner,body);
    if (JSON.parse(owner.details).autoPublish) return write(res,202,{id});
    for (let attempt=0;attempt<300;attempt++) {
      const draft=db.prepare('SELECT state,result,error FROM drafts WHERE id=?').get(id);
      if (draft?.state==='review') return write(res,200,JSON.parse(draft.result));
      if (draft?.error) throw new RequestError(422,draft.error);
      if (!draft) throw new RequestError(409,'This submission is no longer in review.');
      await delay(500);
    }
    return write(res,202,{id});
  }
  if (path === '/api/publish') return publish(req,res,submissionId(owner.id),owner);
  const previous = db.prepare('SELECT id FROM menus WHERE owner=?').get(owner.id);
  if (!previous) throw new RequestError(404,'This menu could not be found.');
  return retryImages(req,res,previous.id,owner.id);
}

const server = createServer(async (req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy','geolocation=(self), camera=(), microphone=()');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; img-src 'self' blob: data:; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/\/$/, '') || '/';
    if (path.startsWith('/api/')) {
      if (req.method==='POST') {
        const expected = liveOrigin || `http://${req.headers.host}`;
        if (req.headers.origin!==expected || req.headers['sec-fetch-site']==='cross-site') throw new RequestError(403,'Open the Menu Lens website to submit a menu.');
      }
      return await api(req,res,path);
    }
    if (req.method!=='GET' && req.method!=='HEAD') throw new RequestError(405,'This request method is unavailable.');
    if (path==='/admin') return write(res,200,document,mime.html,{'X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'});
    if (path==='/healthz') return write(res,200,{status:'ok'});
    if (path==='/data/nz-restaurants.json' && placesData) {
      return write(res,200,placesData,'application/octet-stream',{
        'Content-Disposition':'attachment; filename="nz-restaurants.json"','Cache-Control':'public, max-age=86400',
      });
    }
    const original=path.match(/^\/originals\/([a-f0-9]{20})\/([0-5])\.jpg$/);
    if (original) {
      const row=db.prepare("SELECT json_extract(payload,?) AS key FROM menus WHERE id=? AND state='complete'").get('$.originals['+original[2]+']',original[1]);
      if (!row?.key) throw new RequestError(404,'Menu photo not found.');
      return write(res,200,await getObject(row.key),'image/jpeg',{'Cache-Control':'public, max-age=86400'});
    }
    const media = path.match(/^\/media\/([a-f0-9]{20})\/(\d{1,3})\.webp$/);
    if (media) {
      const row = db.prepare("SELECT object_key FROM dish_objects WHERE menu_id=? AND position=?").get(media[1],Number(media[2]));
      if (!row) throw new RequestError(404,'Image not found.');
      return write(res,200,await getObject(row.object_key),mime.webp,{'Cache-Control':'public, max-age=31536000, immutable'});
    }
    if (path==='/submissions' || path==='/menu/osteria-verde') return write(res,301,'',mime.html,{Location:'/explore'});
    const parts = path.split('/');
    const id = parts.length===3 && parts[1]==='menu' ? parts[2] : '';
    if (['/','/create','/explore','/privacy'].includes(path) || publicId.test(id)) {
      let html = document;
      if (id) {
        const row=db.prepare('SELECT * FROM menus WHERE id=?').get(id);
        const publicView=publicMenu(row);
        if (!publicView) {
          const pending=row || db.prepare('SELECT id FROM drafts WHERE id=?').get(id);
          return write(res,pending ? 200 : 404,progressDocument(row),mime.html,{'X-Robots-Tag':'noindex'});
        }
        const title=escape(publicView.restaurant.name)+' · Menu Lens';
        html=document.replace(/<main id="main"[\s\S]*?<\/main>/,()=>`<main id="main" class="shell">${renderMenu(publicView)}</main>`)
          .replace(/<title>.*?<\/title>/,()=>`<title>${title}</title>`)
          .replace('<meta property="og:title" content="Menu Lens">',()=>`<meta property="og:title" content="${title}">`)
          .replace('https://menu.9l.nz/images/hero.webp',`https://menu.9l.nz${publicView.cover}`);
      }
      return write(res,200,html,mime.html);
    }
    if (/^\/(?:[a-z][a-z0-9.-]+|(?:images|fonts)\/[A-Za-z0-9.-]+)$/.test(path)) {
      const type = mime[extname(path).slice(1)];
      if (type) {
        try {
          return write(res,200,await siteFile(path.slice(1)),type,{'Cache-Control':path.includes('/images/') || path.includes('/fonts/') ? 'public, max-age=86400' : 'no-cache'});
        } catch (error) {
          if (error.code!=='ENOENT' && error.statusCode!==404) throw error;
        }
      }
    }
    throw new RequestError(404,'Page not found.');
  } catch (error) {
    if (!(error instanceof RequestError)) console.error('Request failed',error.name);
    if (!res.headersSent) write(res,error.status||500,{error:error.status ? error.message : 'Something went wrong. Please try again.'});
    else res.end();
  }
});
server.requestTimeout=45_000;
server.listen(Number(environment.PORT || 8238),environment.HOST || '127.0.0.1',()=>console.log('Menu Lens ready'));
