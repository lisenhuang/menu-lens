import {isIP} from 'node:net';
import {imageModels,outputUsdPerMillion,readingModels} from './admin.mjs';

const tokenCount=n=>Number.isSafeInteger(n) && n>=0;
const dollars=value=>value/1_000_000;
function price(kind,model,level,usage,receivedOutput) {
  if (kind==='read') {
    const rates=readingModels[model.replace(/-\d{4}-\d{2}-\d{2}$/,'')];
    const details=usage?.input_tokens_details;
    const cached=details?.cached_tokens ?? 0;
    const writes=details?.cache_write_tokens ?? 0;
    const extended=details?.cache_write_tokens_details?.ttl_12h_tokens ?? 0;
    if (Number.isFinite(rates?.input) && tokenCount(usage?.input_tokens) && tokenCount(usage.output_tokens) &&
        tokenCount(cached) && tokenCount(writes) && tokenCount(extended) && extended<=writes && cached+writes<=usage.input_tokens) {
      const ordinary=usage.input_tokens-cached-writes;
      const input=(ordinary+(writes-extended)*1.25+extended*2.5)*rates.input+cached*rates.cached;
      const output=usage.output_tokens*rates.output;
      const long=rates.longContext && usage.input_tokens>272000;
      return {usd:dollars(long ? input*2+output*1.5 : input+output),basis:'usage'};
    }
  } else if (Object.hasOwn(imageModels,model)) {
    // The Images API receives a text-only prompt for each dish.
    const imageInput=usage?.input_tokens_details?.image_tokens ?? 0;
    if (tokenCount(usage?.input_tokens) && tokenCount(usage.output_tokens) && tokenCount(imageInput) && imageInput<=usage.input_tokens) {
      return {usd:dollars((usage.input_tokens-imageInput)*5+imageInput*8+usage.output_tokens*outputUsdPerMillion),basis:'usage'};
    }
    const tokens=imageModels[model][level];
    if (receivedOutput && tokenCount(tokens)) return {usd:dollars(tokens*outputUsdPerMillion),basis:'output estimate'};
  }
  return {usd:null,basis:'unknown'};
}

const validIp=ip=>typeof ip==='string' && isIP(ip) ? ip : null;
export function generationHistory(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS generation_runs (
      seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, restaurant TEXT NOT NULL,
      recorded TEXT NOT NULL, upload_ip TEXT, image_ip TEXT, legacy INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS generation_cities (
      run_id TEXT NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
      ip TEXT NOT NULL, city TEXT NOT NULL, PRIMARY KEY(run_id,ip)
    );
    CREATE TABLE IF NOT EXISTS generation_calls (
      seq INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES generation_runs(id), started TEXT NOT NULL,
      kind TEXT NOT NULL, label TEXT NOT NULL, model TEXT NOT NULL, level TEXT NOT NULL, ip TEXT,
      state TEXT NOT NULL, usd REAL, basis TEXT NOT NULL DEFAULT 'unknown', usage TEXT
    );
    CREATE INDEX IF NOT EXISTS generation_calls_run ON generation_calls(run_id,seq);
    UPDATE generation_calls SET state='interrupted' WHERE state='running';
    INSERT OR IGNORE INTO generation_runs (id,restaurant,recorded,legacy)
      SELECT id,json_extract(payload,'$.restaurant.name'),created,1 FROM menus;
    INSERT OR IGNORE INTO generation_runs (id,restaurant,recorded,legacy)
      SELECT drafts.id,json_extract(sessions.details,'$.restaurant.name'),
        json_extract(sessions.details,'$.consentAt'),1 FROM drafts JOIN sessions ON sessions.id=drafts.owner;
  `);
  const newRun=db.prepare('INSERT OR IGNORE INTO generation_runs (id,restaurant,recorded,upload_ip) VALUES (?,?,?,?)');
  const saveCity=db.prepare('INSERT OR IGNORE INTO generation_cities (run_id,ip,city) VALUES (?,?,?)');
  function recordCity(id,ip,city) {
    if (city && validIp(ip)) saveCity.run(id,ip,city);
  }
  const startCall=db.prepare(`INSERT INTO generation_calls
    (run_id,started,kind,label,model,level,ip,state) SELECT id,?,?,?,?,?,CASE WHEN ?='read' THEN COALESCE(?,upload_ip) ELSE image_ip END,'running'
    FROM generation_runs WHERE id=? RETURNING seq`);
  const setPrice=db.prepare('UPDATE generation_calls SET usd=?,basis=?,usage=? WHERE seq=?');
  function register(id,name,ip) {
    newRun.run(id,name,new Date().toISOString(),validIp(ip));
  }
  function imageRequester(id,ip) {
    db.prepare('UPDATE generation_runs SET image_ip=? WHERE id=?').run(validIp(ip),id);
  }
  async function measure(id,kind,label,model,level,operation,requestIp=null) {
    const {seq}=startCall.get(new Date().toISOString(),kind,label,model,level,kind,validIp(requestIp),id);
    let status='failed';
    function received(usage,hasOutput=false) {
      const {usd,basis}=price(kind,model,level,usage,hasOutput);
      setPrice.run(usd,basis,usage ? JSON.stringify(usage) : null,seq);
    }
    try {
      const result=await operation(received);
      status='complete';
      return result;
    } finally {
      db.prepare('UPDATE generation_calls SET state=? WHERE seq=?').run(status,seq);
    }
  }
  function list(before) {
    const rows=db.prepare(`WITH page AS (
      SELECT * FROM generation_runs WHERE seq<? ORDER BY seq DESC LIMIT 21
    )
    SELECT p.seq,p.id,p.restaurant,p.recorded,p.upload_ip AS uploadIp,p.image_ip AS imageIp,geo.city AS ipCity,p.legacy,
      COALESCE(m.state,d.state,'unpublished') AS state,
      CASE WHEN p.legacy THEN (SELECT count(*) FROM dish_objects WHERE menu_id=p.id) END AS savedImages,
      CASE WHEN p.legacy THEN json_extract(m.payload,'$.imageSettings') END AS oldSettings,
      count(c.seq) AS attempts,SUM(c.usd) AS usd,count(c.usd) AS priced,
      count(CASE WHEN c.basis='output estimate' THEN 1 END) AS estimates
    FROM page p LEFT JOIN menus m ON m.id=p.id LEFT JOIN drafts d ON d.id=p.id
    LEFT JOIN generation_cities geo ON geo.run_id=p.id AND geo.ip=COALESCE(p.upload_ip,p.image_ip)
    LEFT JOIN generation_calls c ON c.run_id=p.id
    GROUP BY p.seq ORDER BY p.seq DESC`).all(before);
    const more=rows.length>20;
    if (more) rows.pop();
    for (const row of rows) {
      if (row.legacy && row.savedImages) {
        const config=JSON.parse(row.oldSettings) || {model:'gpt-image-2.6-flare',quality:'medium'};
        const perImage=price('image',config.model,config.quality,null,true).usd;
        if (perImage!==null) row.benchmark={...config,count:row.savedImages,usd:row.savedImages*perImage};
      }
      delete row.oldSettings;
    }
    return {runs:rows,next:more ? rows.at(-1).seq : null};
  }
  function calls(id) {
    return db.prepare(`SELECT started,kind,label,model,level,ip,state,usd,basis FROM generation_calls
      WHERE run_id=? ORDER BY seq`).all(id);
  }
  return {register,recordCity,imageRequester,measure,list,calls};
}
