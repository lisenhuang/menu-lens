import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const menu={isMenu:true,transcript:'Soup $9',notes:'',warnings:[],dishes:[
  {name:'Soup',price:'$9',section:'Lunch',description:''},
]};
const photo='data:image/jpeg;base64,/9j/2Q==';
const webpFixture=Buffer.from('RIFF0000WEBPfixture').toString('base64');

test('private uploads and approved illustrations finish with no client connected and survive restarts',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'menu-lens-'));
  let imageFails=true;
  let holdImages=true;
  let holdRead=true;
  let imageCalls=0;
  let readCalls=0;
  const provider=createServer(async (req,res)=>{
    req.resume();
    let response;
    if (req.url==='/turnstile/v0/siteverify') {
      response={success:true,hostname:'localhost',action:'menu_submit'};
    } else if (req.url==='/v1/responses') {
      readCalls++;
      while (holdRead && !res.destroyed) await delay(10);
      response={status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(menu)}]}]};
    } else if (req.url==='/v1/images/generations') {
      imageCalls++;
      while (holdImages && !res.destroyed) await delay(10);
      if (imageFails) res.statusCode=503;
      response=imageFails ? {error:{}} : {data:[{b64_json:webpFixture}]};
    } else throw new Error('Unhandled test provider path');
    res.end(JSON.stringify(response));
  });
  provider.listen(0,'127.0.0.1');
  await once(provider,'listening');
  const providerPort=provider.address().port;
  const reserve=createServer().listen(0,'127.0.0.1');
  await once(reserve,'listening');
  const port=reserve.address().port;
  await new Promise(resolve=>reserve.close(resolve));
  const origin='http://127.0.0.1:'+port;
  let child;
  async function stop() {
    if (!child || child.exitCode!==null || child.signalCode) return;
    const stopped=once(child,'exit');
    child.kill('SIGKILL');
    await stopped;
  }
  t.after(async()=>{
    holdRead=false;holdImages=false;
    await stop();
    provider.closeAllConnections();
    await new Promise(resolve=>provider.close(resolve));
    await rm(dir,{recursive:true,force:true});
  });
  async function until(fn) {
    for (let i=0;i<200;i++) {
      const result=await fn();
      if (result) return result;
      await delay(25);
    }
    assert.fail('Timed out waiting for the job');
  }
  async function start() {
    // Only the test child redirects outbound provider requests. The application is unmodified.
    const preload=`const original=globalThis.fetch; globalThis.fetch=(url, options)=>original(
      new URL(new URL(url).pathname,'http://127.0.0.1:${providerPort}'),options);`;
    child=fork(new URL('../server.mjs',import.meta.url),[],{
      silent:true,execArgv:['--import','data:text/javascript,'+encodeURIComponent(preload)],
      env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:dir,PUBLIC_ORIGIN:origin,
        OPENAI_API_KEY:'test',TURNSTILE_SECRET:'test',TURNSTILE_SITE_KEY:'test',TURNSTILE_HOSTNAME:'localhost'},
    });
    await until(()=>fetch(origin+'/healthz').then(r=>r.ok).catch(()=>false));
  }
  function request(path,cookie='',body) {
    const headers={cookie,origin,'content-type':'application/json'};
    return fetch(origin+path,{headers,method:body?'POST':'GET',body:body&&JSON.stringify(body)});
  }
  async function verify(name) {
    const r=await request('/api/verify','',{name,address:'Example Street',date:'2025-01-01',
      locationConfirmed:true,consent:true,token:'test'});
    assert.equal(r.status,200);
    const {id}=await r.json();
    const cookie=r.headers.getSetCookie().find(value=>value.startsWith('ml_job=')).split(';')[0];
    return {id,cookie};
  }
  await start();
  const first=await verify('Test kitchen');
  const api='/api/jobs/'+first.id;
  assert.equal((await request(api+'/upload',first.cookie,{pages:[photo]})).status,202);
  await until(()=>readCalls===1);
  assert.equal((await request(api)).status,404);
  assert.equal((await request('/menu/'+first.id)).headers.get('x-robots-tag'),'noindex');
  await stop();
  holdRead=false;
  await start();
  await until(async()=> (await (await request(api,first.cookie)).json()).state==='review');
  const second=await verify('Second kitchen');
  assert.equal((await request(api,second.cookie)).status,404);
  assert.equal((await request(api+'/photos/0')).status,404);
  assert.equal((await request(api+'/photos/0',first.cookie)).headers.get('content-type'),'image/jpeg');
  assert.deepEqual((await (await request(api+'/review',first.cookie)).json()).dishes,menu.dishes);
  assert.equal((await request(api+'/publish',first.cookie,{...menu,reviewed:false})).status,403);
  assert.equal((await request(api+'/publish',second.cookie,{...menu,reviewed:true})).status,403);
  const publications=await Promise.all([1,2].map(()=>request(api+'/publish',first.cookie,{...menu,reviewed:true})));
  for (const publication of publications) {
    assert.equal(publication.status,202);
    assert.equal((await publication.json()).id,first.id);
  }
  assert.equal((await request(api+'/photos/0',first.cookie)).status,404);
  assert.deepEqual(await (await request('/api/menus')).json(),[]);
  await until(()=>imageCalls===1);
  await stop();
  holdImages=false;
  await start();
  await until(async()=> (await (await request(api)).json()).state==='error');
  assert.equal((await (await request(api)).json()).canRetry,false);
  assert.equal((await request(api+'/retry',second.cookie,{})).status,403);
  assert.equal((await (await request(api,first.cookie)).json()).canRetry,true);
  imageFails=false;
  assert.equal((await request(api+'/retry',first.cookie,{})).status,202);
  await until(async()=> (await (await request(api)).json()).state==='complete');
  const result=await (await request('/api/menus/'+first.id)).json();
  assert.equal(result.dishes[0].price,'$9');
  assert.equal((await request(result.dishes[0].image)).headers.get('content-type'),'image/webp');
  assert.equal((await (await request('/api/menus')).json()).length,1);
});
