import {createServer} from 'node:http';
import {createHash, randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {dirname, extname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateDish, googlePlaces, readMenu, RequestError, verifyPerson} from './providers.mjs';

import {imageModels, matchesPin, outputUsdPerMillion, readingEfforts, validateSettings} from './admin.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, 'public');
const document = readFileSync(join(publicDir,'index.html'),'utf8');
const environment = process.env;
const dataDir = environment.DATA_DIR || join(root,'.local');
const liveOrigin = (environment.PUBLIC_ORIGIN || '').replace(/\/$/,'');
const ready = Boolean(environment.OPENAI_API_KEY && environment.TURNSTILE_SITE_KEY && environment.TURNSTILE_SECRET && environment.TURNSTILE_HOSTNAME);
const maxDishes = 100;
const dayLimit = Number(environment.DAILY_IMAGE_LIMIT || 120);
const pepper = randomBytes(24).toString('hex');
mkdirSync(dataDir,{recursive:true});
const db = new DatabaseSync(join(dataDir,'menu.sqlite'));
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS admin_sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS generation_settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL, details TEXT NOT NULL, reads INTEGER NOT NULL DEFAULT 0, read_success INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS counters (id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS menus (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL UNIQUE, restaurant_key TEXT NOT NULL,
    date TEXT NOT NULL, created TEXT NOT NULL, payload TEXT NOT NULL,
    state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS published_menus ON menus(state, date DESC, created DESC);
  CREATE TABLE IF NOT EXISTS dish_images (
    menu_id TEXT NOT NULL REFERENCES menus(id), position INTEGER NOT NULL, image BLOB NOT NULL,
    PRIMARY KEY (menu_id, position)
  );
  CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
    state TEXT NOT NULL, pages TEXT NOT NULL, result TEXT, error TEXT
  );
  UPDATE menus SET state='queued' WHERE state='running';
  UPDATE drafts SET state='waiting' WHERE state='reading';
`);

if (!db.prepare('PRAGMA table_info(sessions)').all().some(column=>column.name==='read_success')) {
  db.exec('ALTER TABLE sessions ADD COLUMN read_success INTEGER NOT NULL DEFAULT 0');
}

const mime = {'html':'text/html; charset=utf-8','css':'text/css; charset=utf-8','js':'application/javascript; charset=utf-8','webp':'image/webp','svg':'image/svg+xml','woff2':'font/woff2','txt':'text/plain; charset=utf-8'};
const statusText = 'Menu submissions are temporarily unavailable. Please try again later.';
const publicId = /^[a-f0-9]{20}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const normalize = value => value.normalize('NFKC').toLocaleLowerCase('en-NZ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function settings() {
  const row = db.prepare('SELECT value FROM generation_settings WHERE id=1').get();
  return row ? JSON.parse(row.value) : {model:environment.OPENAI_IMAGE_MODEL || 'gpt-image-2.6-flare',quality:'medium',reasoning:'minimal'};
}

const placesPath = environment.NZ_RESTAURANT_INDEX || '';
const placesData = placesPath && existsSync(placesPath) ? readFileSync(placesPath) : null;
const nzPlaces = placesData ? JSON.parse(placesData).places.map(place=>({
  ...place, search:normalize(place.name+' '+place.address), nameKey:normalize(place.name),
})) : [];
function localPlaces(query) {
  const search = normalize(query);
  if (!search) return [];
  const terms = search.split(' ');
  const score = place=>place.nameKey===search ? 0 : place.nameKey.startsWith(search) ? 1 : place.nameKey.includes(search) ? 2 : 3;
  return nzPlaces.filter(place=>terms.every(term=>place.search.includes(term)))
    .sort((a,b)=>score(a)-score(b) || Number(b.fullAddress)-Number(a.fullAddress) || a.name.localeCompare(b.name))
    .slice(0,10).map(({search,nameKey,...place})=>place);
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
  const draft = owner && db.prepare(`SELECT drafts.state, sessions.details, drafts.error
    FROM drafts JOIN sessions ON sessions.id=drafts.owner
    WHERE drafts.id=? AND drafts.owner=? AND sessions.expires>?`).get(id,owner,Date.now());
  if (!draft) throw new RequestError(404,'This submission is unavailable. Open it in the browser you used to upload.');
  return draft;
}
function jobStatus(row, owner) {
  const payload = JSON.parse(row.payload);
  const completed = db.prepare('SELECT count(*) AS count FROM dish_images WHERE menu_id=?').get(row.id).count;
  return {id:row.id,name:payload.restaurant.name,state:row.state,completed,total:payload.dishes.length,
    canRetry:row.state==='error' && row.owner===owner && row.attempts<3};
}

function details(body) {
  const name = clean(body.name,180,'Restaurant name');
  const address = clean(body.address,400,'Restaurant address');
  const date = clean(body.date,10,'Menu date');
  const calendar = new Date(date+'T00:00:00.000Z');
  const tomorrow = new Date(Date.now()+86_400_000).toISOString().slice(0,10);
  if (!name || !address) throw new RequestError(400,'Enter the restaurant name and full address.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(calendar.getTime()) || calendar.toISOString().slice(0,10) !== date || date > tomorrow || date < '1900-01-01') {
    throw new RequestError(400,'Enter the date the menu was photographed.');
  }
  const placeId = typeof body.placeId === 'string' && /^[A-Za-z0-9_-]{5,180}$/.test(body.placeId) ? body.placeId : '';
  const addressKey = sha(normalize(name)+'\u0000'+normalize(address)).slice(0,24);
  const restaurant = {name,address,placeId,key:placeId ? sha(placeId).slice(0,24) : addressKey,addressKey};
  return {restaurant,date,consentAt:new Date().toISOString()};
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

function card(row) {
  const {restaurant,dishes} = JSON.parse(row.payload);
  return {id:row.id,restaurant,date:row.date,published:row.created,cover:`/media/${row.id}/0.webp`,count:dishes.length};
}

function publicMenu(row) {
  const payload = JSON.parse(row.payload);
  const {dishes,restaurant,notes,transcript} = payload;
  const versions = db.prepare(`
    SELECT id,date,created FROM menus WHERE state='complete' AND id<>?
      AND (restaurant_key=? OR json_extract(payload,'$.restaurant.addressKey')=?)
    ORDER BY date DESC,created DESC LIMIT 30
  `).all(row.id,restaurant.key,restaurant.addressKey);
  return {
    ...card(row),notes,transcript,versions,
    dishes:dishes.map((dish,i)=>({...dish,image:`/media/${row.id}/${i}.webp`})),
  };
}

const pendingLimit = 3;
let readingDrafts = false;
async function readDrafts() {
  if (readingDrafts || !ready) return;
  readingDrafts = true;
  try {
    let draft;
    while ((draft=db.prepare(`SELECT drafts.id, drafts.pages FROM drafts JOIN sessions ON sessions.id=drafts.owner
      WHERE drafts.state='waiting' AND sessions.expires>? ORDER BY drafts.rowid LIMIT 1`).get(Date.now()))) {
      db.prepare("UPDATE drafts SET state='reading' WHERE id=?").run(draft.id);
      try {
        const output = await readMenu(JSON.parse(draft.pages),settings().reasoning);
        if (!output.isMenu) throw new RequestError(422,'These photos could not be recognised as a restaurant menu. Try a clearer photo.');
        db.prepare("UPDATE drafts SET state='review', result=? WHERE id=?").run(JSON.stringify(output),draft.id);
      } catch (error) {
        const message = error instanceof RequestError ? error.message : 'The menu could not be read. Try again with a clear photo.';
        db.prepare("UPDATE drafts SET state='read_error', error=?, pages='[]' WHERE id=?").run(message,draft.id);
      }
    }
  } finally {
    readingDrafts = false;
  }
}
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
      const {dishes,imageSettings} = JSON.parse(row.payload);
      const imageConfig = imageSettings || {model:environment.OPENAI_IMAGE_MODEL || 'gpt-image-2.6-flare',quality:'medium'};
      const done = new Set(db.prepare('SELECT position FROM dish_images WHERE menu_id=?').all(row.id).map(item=>item.position));
      const remaining = dishes.map((dish,i)=>({dish,i})).filter(item=>!done.has(item.i));
      try {
        for (let i=0;i<remaining.length;i+=2) {
          const results = await Promise.allSettled(remaining.slice(i,i+2).map(async item=>{
            if (!rate('images:daily',dayLimit,86_400_000)) throw new RequestError(429,'Daily image capacity reached.');
            const bytes = await generateDish(item.dish,imageConfig);
            db.prepare('INSERT INTO dish_images VALUES (?,?,?)').run(row.id,item.i,bytes);
          }));
          if (results.some(result=>result.status==='rejected')) throw new Error('Image batch unfinished');
        }
        db.prepare("UPDATE menus SET state='complete',created=? WHERE id=?").run(new Date().toISOString(),row.id);
      } catch {
        db.prepare("UPDATE menus SET state='error' WHERE id=?").run(row.id);
      }
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
  db.prepare("DELETE FROM dish_images WHERE menu_id IN (SELECT id FROM menus WHERE state='error' AND created<?)").run(cutoff);
  db.prepare("DELETE FROM menus WHERE state='error' AND created<?").run(cutoff);
},3_600_000).unref();

function validatePages(body) {
  if (!Array.isArray(body.pages) || !body.pages.length || body.pages.length>6 || body.pages.some(page=>(
    typeof page !== 'string' || page.length>3_000_000 || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(page)
  ))) throw new RequestError(400,'Upload between one and six readable menu photos.');
}
function reserveRead(owner) {
  if (!db.prepare('UPDATE sessions SET reads=reads+1 WHERE id=? AND reads<3').run(owner).changes || !rate('reading:daily',45,86_400_000)) {
    throw new RequestError(429,'The menu reading limit has been reached. Please try again later.');
  }
}
function checkImageQueue() {
  const outstanding = db.prepare("SELECT count(*) AS count FROM menus WHERE state IN ('queued','running')").get().count;
  if (outstanding>=pendingLimit) throw new RequestError(429,'The image queue is full. Please try again in a few minutes.');
}
async function publish(req,res,id,owner,fromDraft) {
  const existing = db.prepare('SELECT id FROM menus WHERE owner=?').get(owner.id);
  if (existing) return write(res,202,existing);
  limit(req,'publish',5,86_400);
  const body = await json(req);
  if (body.reviewed !== true) throw new RequestError(403,'Review the original menu information before publishing.');
  const {date,restaurant,consentAt} = JSON.parse(owner.details);
  const {model,quality} = settings();
  const payload = {...menuText(body),restaurant,consentAt,imageSettings:{model,quality}};
  const duplicate = db.prepare('SELECT id FROM menus WHERE owner=?').get(owner.id);
  if (duplicate) return write(res,202,duplicate);
  if (fromDraft ? privateDraft(id,owner.id).state!=='review' : !owner.read_success) {
    throw new RequestError(403,'Read the uploaded menu before publishing.');
  }
  checkImageQueue();
  db.exec('BEGIN');
  try {
    db.prepare("INSERT INTO menus (id,owner,restaurant_key,date,created,payload,state) VALUES (?,?,?,?,?,?,'queued')")
      .run(id,owner.id,restaurant.key,date,new Date().toISOString(),JSON.stringify(payload));
    db.prepare('DELETE FROM drafts WHERE owner=?').run(owner.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  queue();
  return write(res,202,{id});
}
function retryImages(req,res,id,owner) {
  limit(req,'retry',6,600);
  checkImageQueue();
  const retried = db.prepare("UPDATE menus SET state='queued', attempts=attempts+1 WHERE id=? AND owner=? AND state='error' AND attempts<3").run(id,owner);
  if (!retried.changes) throw new RequestError(409,'This menu cannot be retried right now.');
  queue();
  return write(res,202,{ok:true});
}

async function jobApi(req,res,id,action) {
  const owner = jobOwner(req);
  const row = db.prepare('SELECT * FROM menus WHERE id=?').get(id);
  if (req.method==='GET') {
    if (!action && row) return write(res,200,jobStatus(row,owner));
    const draft = privateDraft(id,owner);
    if (!action) {
      const {restaurant,date} = JSON.parse(draft.details);
      return write(res,200,{id,name:restaurant.name,restaurant,date,state:draft.state,error:draft.error});
    }
    if (action==='review' && draft.state==='review') {
      const result = db.prepare('SELECT result,json_array_length(pages) AS photoCount FROM drafts WHERE id=?').get(id);
      return write(res,200,{...JSON.parse(result.result),photoCount:result.photoCount});
    }
    if (/^photos\/[0-5]$/.test(action) && draft.state==='review') {
      const photo = db.prepare('SELECT json_extract(pages,?) AS page FROM drafts WHERE id=?').get('$['+action.slice(7)+']',id).page;
      if (photo) return write(res,200,Buffer.from(photo.split(',')[1],'base64'),'image/jpeg');
    }
  } else if (req.method==='POST') {
    if (!ready) throw new RequestError(503,statusText);
    if (!owner || (row ? row.owner!==owner : submissionId(owner)!==id)) throw new RequestError(403,'Open this submission in the browser you used to upload.');
    if (row && action==='retry') return retryImages(req,res,id,owner);
    if (row && ['publish','upload'].includes(action)) return write(res,202,{id});
    const active = db.prepare('SELECT * FROM sessions WHERE id=? AND expires>?').get(owner,Date.now());
    if (!active) throw new RequestError(403,'Your upload has expired. Start a new submission.');
    if (action==='publish') return publish(req,res,id,active,true);
    if (action==='upload') {
      limit(req,'read',9,86_400);
      const body = await json(req,16_000_000);
      if (db.prepare('SELECT id FROM drafts WHERE id=? UNION ALL SELECT id FROM menus WHERE id=?').get(id,id)) return write(res,202,{id});
      validatePages(body);
      const outstanding = db.prepare("SELECT count(*) AS count FROM drafts WHERE state IN ('waiting','reading')").get().count;
      if (outstanding>=pendingLimit) throw new RequestError(429,'The reading queue is full. Please try again in a few minutes.');
      reserveRead(owner);
      db.prepare("INSERT INTO drafts (id,owner,state,pages) VALUES (?,?,'waiting',?)").run(id,owner,JSON.stringify(body.pages));
      queueReading();
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
  if (path==='/api/admin/logout' && req.method==='POST') {
    db.prepare('DELETE FROM admin_sessions WHERE id=?').run(id);
    return write(res,200,{ok:true},undefined,{'Set-Cookie':`ml_admin=${cookieSuffix}; Max-Age=0`});
  }
  if (path==='/api/admin/settings' && req.method==='GET') {
    return write(res,200,{settings:settings(),imageModels,outputUsdPerMillion,readingEfforts,readingModel:environment.OPENAI_VISION_MODEL || 'gpt-5-mini'});
  }
  if (path==='/api/admin/settings' && req.method==='POST') {
    const next=validateSettings(await json(req,2048));
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
    const rows = db.prepare("SELECT * FROM menus WHERE state='complete' ORDER BY date DESC,created DESC LIMIT 200").all();
    return write(res,200,rows.map(card));
  }
  const menuId = path.match(/^\/api\/menus\/([a-f0-9]{20})$/)?.[1];
  if (menuId && get) {
    const row = db.prepare("SELECT * FROM menus WHERE id=? AND state='complete'").get(menuId);
    if (!row) throw new RequestError(404,'This menu could not be found.');
    return write(res,200,publicMenu(row));
  }
  const job = path.match(/^\/api\/jobs\/([a-f0-9]{20})(?:\/(review|upload|publish|retry|photos\/[0-5]))?$/);
  if (job) return jobApi(req,res,job[1],job[2]);
  if (path === '/api/job' && get) {
    const owner = session(req,false);
    const row = owner && db.prepare('SELECT * FROM menus WHERE owner=?').get(owner.id);
    if (row) return write(res,200,jobStatus(row,owner.id));
    const draft = owner && db.prepare('SELECT id FROM drafts WHERE owner=?').get(owner.id);
    return write(res,200,draft ? {...draft,name:JSON.parse(owner.details).restaurant.name} : null);
  }
  if (req.method !== 'POST') throw new RequestError(404,'This page could not be found.');
  if (path === '/api/places') {
    limit(req,'places',24,600);
    const body = await json(req,2500);
    const query = clean(body.query,220,'Restaurant search');
    if (query.length < 2) throw new RequestError(400,'Type a restaurant name to search.');
    if (environment.GOOGLE_PLACES_API_KEY) {
      try {
        const result = await googlePlaces(query,null);
        if (result.places.length || !nzPlaces.length) return write(res,200,{...result,source:'google'});
      } catch (error) {
        if (!nzPlaces.length) throw error;
      }
    }
    return write(res,200,{places:localPlaces(query),source:'osm'});
  }
  if (!['/api/verify','/api/read','/api/publish','/api/retry'].includes(path)) throw new RequestError(404,'This page could not be found.');
  if (!ready) throw new RequestError(503,statusText);
  if (path === '/api/verify') {
    limit(req,'verify',12,3600);
    const body = await json(req,6000);
    if (body.consent !== true || body.locationConfirmed !== true) throw new RequestError(403,'Confirm the location and agree to publish before continuing.');
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
    validatePages(body);
    reserveRead(owner.id);
    const output = await readMenu(body.pages,settings().reasoning);
    if (!output.isMenu) throw new RequestError(422,'This does not look like a restaurant menu. Upload clear photos of the menu.');
    db.prepare('UPDATE sessions SET read_success=1 WHERE id=?').run(owner.id);
    return write(res,200,output);
  }
  if (path === '/api/publish') return publish(req,res,submissionId(owner.id),owner,false);
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
    const media = path.match(/^\/media\/([a-f0-9]{20})\/(\d{1,3})\.webp$/);
    if (media) {
      const row = db.prepare("SELECT image FROM dish_images JOIN menus ON menus.id=menu_id WHERE menu_id=? AND position=? AND state='complete'").get(media[1],Number(media[2]));
      if (!row) throw new RequestError(404,'Image not found.');
      return write(res,200,row.image,mime.webp,{'Cache-Control':'public, max-age=31536000, immutable'});
    }
    if (path==='/menu/osteria-verde') return write(res,301,'',mime.html,{Location:'/explore'});
    const parts = path.split('/');
    const id = parts.length===3 && parts[1]==='menu' ? parts[2] : '';
    if (['/','/create','/explore','/privacy','/submissions'].includes(path) || publicId.test(id)) {
      let html = document;
      if (id) {
        const row = db.prepare("SELECT * FROM menus WHERE id=? AND state='complete'").get(id);
        if (!row) {
          const pending = db.prepare('SELECT id FROM menus WHERE id=? UNION ALL SELECT id FROM drafts WHERE id=?').get(id,id);
          return write(res,pending ? 200 : 404,document,mime.html,{'X-Robots-Tag':'noindex'});
        }
        const summary = card(row);
        html = document.replace('<meta property="og:title" content="Menu Lens">', () => `<meta property="og:title" content="${escape(summary.restaurant.name)} · Menu Lens">`)
          .replace('https://menu.9l.nz/images/hero.webp', `https://menu.9l.nz${summary.cover}`);
      }
      return write(res,200,html,mime.html);
    }
    if (/^\/(?:[a-z][a-z0-9.-]+|(?:images|fonts)\/[a-z0-9.-]+)$/.test(path)) {
      const type = mime[extname(path).slice(1)];
      if (type) {
        try {
          return write(res,200,readFileSync(join(publicDir,path)),type,{'Cache-Control':path.includes('/images/') || path.includes('/fonts/') ? 'public, max-age=86400' : 'no-cache'});
        } catch (error) {
          if (error.code!=='ENOENT') throw error;
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
