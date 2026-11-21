import {icons} from './icons.js?v=3';

const main = document.querySelector('#main');
const dialog = document.querySelector('#modal');
const theme = document.querySelector('.theme');
const $ = (selector,root=document)=>root.querySelector(selector);
const icon = name=>`<span data-icon="${name}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg></span>`;
const escape = value=>String(value ?? '').replace(/[&<>"']/g, character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[character]);
function enhance(root) {
  for (const element of root.querySelectorAll('[data-icon]:empty')) {
    const name = element.dataset.icon;
    if (icons[name]) element.outerHTML = icon(name);
  }
}
enhance(document);

function syncTheme() {
  const value = document.documentElement.dataset.theme || 'system';
  const option = theme.querySelector(`[value="${value}"]`);
  option.checked = true;
  const trigger = theme.querySelector('summary');
  trigger.innerHTML = icon({system:'sunMoon',light:'sun',dark:'moon'}[value]);
  trigger.title = 'Change theme (currently '+option.getAttribute('aria-label')+')';
  trigger.setAttribute('aria-label',trigger.title);
}
theme.addEventListener('change',event=>{
  const value = event.target.value;
  if (value === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
  try { localStorage.setItem('menu-lens-theme',value); } catch {}
  syncTheme();
});
theme.addEventListener('click',event=>{
  if (event.target.matches('input') && event.detail>0) {
    theme.open = false;
    theme.querySelector('summary').focus();
  }
});
theme.addEventListener('focusout',event=>{
  if (event.relatedTarget && !theme.contains(event.relatedTarget)) theme.open=false;
});
document.addEventListener('click',event=>{if (!theme.contains(event.target)) theme.open=false;});
theme.addEventListener('keydown',event=>{
  if (event.key === 'Escape') {
    theme.open = false;
    theme.querySelector('summary').focus();
  }
});
syncTheme();

function dateLabel(date) {
  return new Intl.DateTimeFormat('en-NZ',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
}
function localDate() {
  const now = new Date();
  const local = new Date(now.getTime()-now.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,10);
}
function mapsUrl(name,address='',id='') {
  const params = new URLSearchParams({api:'1',query:[name,address].filter(Boolean).join(', ')});
  if (id && !id.startsWith('osm-')) params.set('query_place_id',id);
  return 'https://www.google.com/maps/search/?'+params;
}
function mapsLink(name,address,id) {
  return `<a class="text-link" href="${escape(mapsUrl(name,address,id))}" target="_blank" rel="noopener noreferrer">Google Maps ${icon('external')}</a>`;
}
const notice = (text,name='info')=>`<p class="notice">${icon(name)}<span>${escape(text)}</span></p>`;
const pagesBack = (href,label)=>`<a class="breadcrumb" href="${href}">${icon('back')} ${label}</a>`;
const primary = (label,glyph,options='')=>`<button type="button" class="btn primary" ${options}>${glyph ? icon(glyph) : ''}${label}</button>`;

async function api(path,body) {
  const options = body === undefined ? {signal:AbortSignal.timeout(20000)} : {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(115000),
  };
  const response = await fetch('/api'+path,options);
  const json = await response.json().catch(()=>null);
  if (!response.ok) {
    const error = new Error(json?.error || 'Something went wrong. Please try again.');
    error.status = response.status;
    throw error;
  }
  return json;
}

let toastTimer;
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{element.hidden=true;},3000);
}
async function share(label='Menu link') {
  const url = location.href.split('#')[0];
  try {
    await navigator.clipboard.writeText(url);
    toast(label+' copied');
  } catch {
    showModal(label,'link',`<label class="field">${label}<input class="control" value="${escape(url)}" readonly></label>`);
    dialog.querySelector('input').select();
  }
}
function showModal(title,glyph,body) {
  dialog.setAttribute('aria-labelledby','modal-title');
  dialog.innerHTML = `<button class="icon-button modal-close" type="button" aria-label="Close">${icon('close')}</button>
    <div class="modal-icon">${icon(glyph)}</div><h2 id="modal-title">${title}</h2>${body}`;
  $('.modal-close',dialog).addEventListener('click',()=>dialog.close());
  if (!dialog.open) dialog.showModal();
}
function page(title,kicker,intro,body,back='') {
  main.innerHTML = `<div class="page">${back}<div class="page-heading"><p class="eyebrow page-kicker">${kicker}</p>
    <h1 class="page-title">${title}</h1><p class="page-intro">${intro}</p></div>${body}</div>`;
}

function dishCard(dish) {
  return `<article class="dish-card" id="${escape(dish.id)}"><div class="dish-image">
    <img src="${escape(dish.image)}" alt="AI illustration of ${escape(dish.name)}" width="780" height="500" loading="lazy"></div>
    <div class="dish-body"><h3>${escape(dish.name)}</h3>${dish.price ? `<span class="price">${escape(dish.price)}</span>` : ''}
    ${dish.description ? `<p class="description">${escape(dish.description)}</p>` : ''}</div></article>`;
}
function listing(menu) {
  return `<a class="dish-card menu-card" href="/menu/${escape(menu.id)}"><div class="dish-image"><img src="${escape(menu.cover)}" alt="" width="780" height="500" loading="lazy"></div>
  <div class="dish-body"><div><h3>${escape(menu.restaurant.name)}</h3><p>${escape(menu.restaurant.address)}</p>
    <p>Photographed ${dateLabel(menu.date)} · ${menu.count} ${menu.count === 1 ? 'dish' : 'dishes'}</p></div></div></a>`;
}
async function home() {
  try {
    const menus = (await api('/menus')).sort((a,b)=>b.published.localeCompare(a.published));
    if (menus.length) {
      $('#recent-grid').innerHTML = menus.slice(0,3).map(listing).join('');
      $('#recent-menus').hidden = false;
    }
  } catch {
    // The homepage remains usable if the collection is temporarily unavailable.
  }
}
async function explore() {
  document.title = 'Explore menus · Menu Lens';
  page('Explore menus','THE PUBLIC COLLECTION','Browse visual menus shared by diners. Look for the date each menu was photographed.',
    `<label class="field explore-search" id="explore-field" hidden>Restaurant or area<input id="explore-search" type="search" class="control" placeholder="Search menus"></label>
      <div id="menu-grid" class="dish-grid" aria-live="polite"><p class="muted">Loading menus…</p></div>`);
  const grid = $('#menu-grid');
  try {
    const items = await api('/menus');
    if (!items.length) {
      grid.innerHTML = `<div class="panel collection-empty"><h2>No menus published yet</h2>
        <p class="muted">Add a menu from a restaurant you’ve visited.</p>
        <a class="btn primary" href="/create">${icon('camera')} Upload a menu</a></div>`;
      return;
    }
    const search = $('#explore-search');
    $('#explore-field').hidden = false;
    const render = ()=>{
      const q = search.value.toLocaleLowerCase().trim();
      const result = items.filter(menu=>[menu.restaurant.name,menu.restaurant.address].join(' ').toLocaleLowerCase().includes(q));
      grid.innerHTML = result.length ? result.map(listing).join('') : '<p class="muted">No menus match that search.</p>';
    };
    search.addEventListener('input',render);
    render();
  } catch {
    grid.innerHTML = notice('The public collection could not be loaded. Try again in a moment.');
  }
}

async function showMenu(id) {
  let menu;
  page('Loading menu','VISUAL MENU','',notice('Fetching the published menu.'),pagesBack('/explore','Explore menus'));
  try { menu = await api('/menus/'+encodeURIComponent(id)); }
  catch(error) {
    return page(error.status===404 ? 'Menu not found' : 'Menu unavailable','VISUAL MENU',
      'Check the link or choose another menu in the collection.','',pagesBack('/explore','Explore menus'));
  }
  document.title = menu.restaurant.name+' · Menu Lens';
  const sections = [...new Set(menu.dishes.map(dish=>dish.section))];
  const dates = (menu.versions || []).map(version=>`<li><a class="text-link" href="/menu/${escape(version.id)}">${dateLabel(version.date)}</a>${version.created ? ` <span class="muted">· Published ${dateLabel(version.created.slice(0,10))}</span>` : ''}</li>`).join('');
  main.innerHTML = `<div class="page">
    ${pagesBack('/explore','Explore menus')}
    <section class="menu-cover"><div class="menu-cover-copy"><p class="eyebrow page-kicker">COMMUNITY VISUAL MENU</p>
    <h1 class="page-title">${escape(menu.restaurant.name)}</h1>
    <p class="page-intro">${escape(menu.restaurant.address)}</p>
    ${menu.restaurant.placeId?.startsWith('osm-') ? '<a class="field-hint" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>' : ''}
    <p class="hero-note">${icon('calendar')} Photographed ${dateLabel(menu.date)}</p>
    <div class="inline-actions"><button type="button" class="btn primary" id="share">${icon('link')} Copy link</button>
    ${mapsLink(menu.restaurant.name,menu.restaurant.address,menu.restaurant.placeId)}
    </div></div><img src="${escape(menu.cover)}" alt="AI illustration of ${escape(menu.dishes[0].name)}" width="780" height="500"></section>
    ${notice('Dish images are AI illustrations. Confirm current prices, availability and allergens with the restaurant.','sparkles')}
    ${sections.length>1 ? `<nav aria-label="Menu sections" class="menu-jumps">${sections.map((section,i)=>`<a href="#section-${i}">${escape(section || 'Menu')}</a>`).join('')}</nav>` : ''}
    ${sections.map((section,i)=>`<section class="menu-section" id="section-${i}"><h2>${escape(section || 'Menu')}</h2><div class="dish-grid">${menu.dishes.filter(dish=>dish.section===section).map(dishCard).join('')}</div></section>`).join('')}
    ${menu.notes ? `<div class="panel menu-details"><h3>Notes from the menu</h3><p>${escape(menu.notes)}</p></div>` : ''}
    ${menu.transcript ? `<details class="panel menu-details"><summary>Original menu text</summary><p>${escape(menu.transcript)}</p></details>` : ''}
    ${dates ? `<div class="panel menu-details"><h3>Other menus for this restaurant</h3><ul>${dates}</ul></div>` : ''}
    <a href="/create" class="btn quiet">${icon('plus')} Add a newer menu</a>
    </div>`;
  $('#share').addEventListener('click',()=>share());
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

function privacy() {
  document.title = 'Privacy & submissions · Menu Lens';
  page('Privacy & submissions','MENU LENS','What happens to your menu photo and location.',
    `<div class="panel privacy">
      <h3>Public menus</h3><p>Generating a visual menu requires permission to publish it. The finished page includes the restaurant name and address, menu date, reviewed original text, and AI dish images. It can be browsed or shared by link.</p>
      <p>Upload restaurant menus you are allowed to share. Leave out photos of people, receipts, and any personal information. Review and remove private details before submitting.</p>
      <p>The original uploaded photo is used to read the menu with OpenAI and is kept out of the public page. Menu Lens keeps the photos privately for your review. They are removed when you submit the reviewed menu or when the draft expires after 24 hours.</p>
      <p>Your browser remembers links to recent submissions on this device. Before you approve a menu, only the browser that uploaded it can reopen the draft.</p>
      <p>Menu Lens stores the requesting IP address alongside generation times and AI usage costs. Only signed-in administrators can view these records.</p>
      <p>GPS is optional and stays in your browser. Your browser uses it to compare your position with the restaurant coordinates when available.</p>
      <p>Cloudflare Turnstile verifies submissions. Searching in Google Maps sends your query to Google.</p>
      <p>New Zealand restaurant search uses <a class="text-link" href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>. The <a class="text-link" href="/data/nz-restaurants.json">New Zealand restaurant index</a> is available under the Open Database Licence.</p>
    </div>`);
}

const state = {
  step:1, files:[], name:'',address:'',date:localDate(),place:null, position:null,
  confirmed:false, lookup:[], transcript:'', notes:'',dishes:[],warnings:[],read:false,
  config:null,verified:false,submissionId:null,
};
let flow;
function buildFlow() {
  document.title = 'Create a visual menu · Menu Lens';
  page('Create a visual menu','FROM PAPER TO PICTURE','Upload a clear menu photo, review the original details, and share a dated visual menu.',
    `<div class="flow"><section class="panel" id="flow"></section>
      <aside class="panel side-panel"><h3>Before you upload</h3><ul>
      <li>${icon('camera')} <span>Capture the page straight on and check that prices are readable.</span></li>
      <li>${icon('pin')} <span>Use the address of the exact restaurant branch.</span></li>
      <li>${icon('globe')} <span>Finished menus are public. The uploaded photos and your GPS position stay off the public page.</span></li>
      </ul></aside></div>`);
  flow = $('#flow');
  renderStep();
  api('/config').then(config=>{
    state.config=config;
    if (state.step===1) updateUpload();
    if (state.step===2) updateLocation();
  }).catch(()=>{state.config={generation:false,places:false};if(state.step===1) updateUpload();});

}
function renderStep() {
  const labels = ['Photos','Restaurant','Review'];
  flow.innerHTML = `<div class="steps" aria-label="Submission progress">${labels.map((item,i)=>`<span ${state.step===i+1 ? 'aria-current="step"' : ''}><b>${i+1}</b>${item}</span>`).join('')}</div>`;
  [uploadStep,locationStep,reviewStep][state.step-1]();
}
function go(step) {
  state.step=step;
  renderStep();
  const heading = $('h2',flow);
  heading.tabIndex=-1;
  heading.focus({preventScroll:true});
  if (flow.getBoundingClientRect().top<0) flow.scrollIntoView({block:'start'});
}
function errorAt(element,message) {
  element.textContent = message || '';
  element.hidden = !message;
}

function uploadStep() {
  flow.insertAdjacentHTML('beforeend',`
    <h2>Upload menu photos</h2><p class="muted">Add all the pages you’d like to include.</p>
    <div class="dropzone" id="drop-zone">${icon('upload')}<strong>Drop your menu photos here</strong><small>Up to 6 JPG, PNG, WebP or HEIC images</small>
    <div class="inline-actions"><button type="button" class="btn primary" id="choose">${icon('plus')} Choose photos</button>
    <button type="button" class="btn quiet" id="camera">${icon('camera')} Take photo</button></div>
    <input id="files" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden>
    <input id="capture" type="file" accept="image/*" capture="environment" hidden></div>
    <p class="error" id="upload-error" role="alert" hidden></p><div class="files" id="selected-files"></div>
    <div id="availability"></div><div class="form-actions"><a href="/explore" class="btn text back">Explore menus</a>
    ${primary('Continue',null,'id="next" disabled')}</div>`);
  const drop=$('#drop-zone');
  for (const item of ['files','capture']) {
    $('#'+item).addEventListener('change',event=>{void addFiles(event.target.files);event.target.value='';});
  }
  $('#choose').onclick=()=>$('#files').click();
  $('#camera').onclick=()=>$('#capture').click();
  drop.addEventListener('dragover',event=>{event.preventDefault();drop.classList.add('active');});
  drop.addEventListener('dragleave',()=>drop.classList.remove('active'));
  drop.addEventListener('drop',event=>{event.preventDefault();drop.classList.remove('active');void addFiles(event.dataTransfer.files);});
  $('#next').onclick=()=>go(2);
  updateUpload();
}
function updateUpload() {
  const list=$('#selected-files');
  if (!list) return;
  list.innerHTML=state.files.map((file,i)=>`<div class="file-row"><img src="${file.url}" alt=""><span class="truncate">${escape(file.name)}</span>
    <button type="button" class="icon-button" data-remove="${i}" aria-label="Remove ${escape(file.name)}">${icon('close')}</button></div>`).join('');
  list.querySelectorAll('button').forEach(button=>button.onclick=()=>{
    URL.revokeObjectURL(state.files[Number(button.dataset.remove)].url);
    state.files.splice(Number(button.dataset.remove),1);
    state.read=false;
    updateUpload();
  });
  $('#next').disabled=!state.files.length || Boolean(state.loadingFiles);
  $('#availability').innerHTML=state.config?.generation===false ?
    notice('Menu submissions are temporarily unavailable. Please try again later.') : '';
}
async function addFiles(files) {
  if (state.loadingFiles) return;
  state.loadingFiles=true;
  updateUpload();
  const input=Array.from(files);
  const messages=[];
  for (const file of input) {
    if (state.files.length>=6) {
      messages.push('A submission can include up to six pages.');
      break;
    }
    try {
      if (file.size>22_000_000) throw new Error('too large');
      const blob=await preparePhoto(file);
      state.files.push({name:file.name || 'Menu photo',blob,url:URL.createObjectURL(blob)});
      state.read=false;
    } catch {
      messages.push(`${file.name || 'The photo'} could not be opened. Try a JPG, PNG or WebP file under 22 MB.`);
    }
  }
  state.loadingFiles=false;
  updateUpload();
  errorAt($('#upload-error'),messages.join(' '));
}
async function preparePhoto(file) {
  const url=URL.createObjectURL(file);
  try {
    const picture=new Image();
    picture.src=url;
    await picture.decode();
    if (!picture.naturalWidth || !picture.naturalHeight) throw new Error('Image is empty');
    const canvas=document.createElement('canvas');
    const scale=Math.min(1,2000/Math.max(picture.naturalWidth,picture.naturalHeight));
    canvas.width=Math.round(picture.naturalWidth*scale);
    canvas.height=Math.round(picture.naturalHeight*scale);
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#ffffff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(picture,0,0,canvas.width,canvas.height);
    for (const quality of [.88,.76,.62]) {
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
      if (blob && blob.size<=1_650_000) return blob;
    }
    throw new Error('Image is too large');
  } finally {URL.revokeObjectURL(url);}
}
const dataUrl = blob=>new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(reader.result);
  reader.onerror=reject;
  reader.readAsDataURL(blob);
});

function locationStep() {
  flow.insertAdjacentHTML('beforeend',`
    <h2>Find the restaurant</h2><p class="muted">Use the restaurant’s exact name and branch address.</p>
    <form id="location-form" class="fields">
      <label class="field">Restaurant name<input class="control" id="restaurant-name" required maxlength="180" value="${escape(state.name)}" placeholder="e.g. Ortega Fish Shack"></label>
      <div class="inline-actions">
        <button type="button" class="btn quiet small" id="place-search">${icon('search')} Search restaurants</button>
        <button type="button" class="btn quiet small" id="gps">${icon('locate')} Use my location</button>
        <span id="map-link"></span>
      </div>
      <div id="place-results" class="search-results" aria-live="polite"></div>
      <p id="location-status" class="field-hint" aria-live="polite"></p>
      <label class="field">Restaurant address<input class="control" id="restaurant-address" required maxlength="400" value="${escape(state.address)}" placeholder="Street address, city"></label>
      <details id="pin-details"><summary class="field-hint">Add a map pin for distance checking</summary>
        <label class="field">Map coordinates <span class="field-hint">Copy latitude and longitude from the restaurant pin.</span>
          <input class="control" id="pin-coordinates" value="${escape(state.manualPin || '')}" placeholder="-41.294, 174.784" autocomplete="off">
        </label>
      </details>
      <label class="field">Date photographed<input class="control" type="date" id="menu-date" min="1900-01-01" max="${localDate()}" required value="${escape(state.date)}"></label>
      <div id="distance"></div>
      <p class="error" id="step-error" role="alert" hidden></p>
      <div class="form-actions"><button type="button" class="btn text back" id="back">${icon('back')} Photos</button>
        <button type="submit" class="btn primary">${icon('shield')} Review &amp; submit</button></div>
    </form>`);
  function captureEdit(key,field) {
    $(field).addEventListener('input',event=>{
      state[key]=event.target.value;
      state.place=null;
      state.confirmed=false;
      state.verified=false;
      updateLocation();
    });
  }
  captureEdit('name','#restaurant-name');
  captureEdit('address','#restaurant-address');
  captureEdit('manualPin','#pin-coordinates');
  $('#menu-date').addEventListener('input',event=>{state.date=event.target.value;state.verified=false;});
  $('#back').onclick=()=>go(1);
  $('#place-search').onclick=findPlaces;
  $('#gps').onclick=requestLocation;
  $('#location-form').addEventListener('submit',event=>{
    event.preventDefault();
    const pin = state.manualPin?.trim();
    if (pin && !restaurantPin()) {
      errorAt($('#step-error'),'Use a latitude and longitude separated by a comma, such as -41.294, 174.784.');
      return;
    }
    if (locationCheck().confirm && !state.confirmed) {
      errorAt($('#step-error'),'Confirm that the restaurant address is correct before continuing.');
      $('#confirm-location')?.focus();
      return;
    }
    errorAt($('#step-error'),'');
    if (state.verified && state.read) return go(3);
    consentModal();
  });
  updateLocation();
  renderPlaces();
}
function restaurantPin() {
  const source=state.place;
  if (Number.isFinite(source?.lat) && Number.isFinite(source?.lng)) return source;
  const match=state.manualPin?.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match || Math.abs(+match[1])>90 || Math.abs(+match[2])>180) return null;
  return {lat:+match[1],lng:+match[2]};
}
function locationCheck() {
  const pin=restaurantPin();
  const gps=state.position;
  if (!gps || !pin) return {confirm:true,message:'Confirm this is the right restaurant branch. A distance check needs your GPS location and a restaurant pin.'};
  const radians=degrees=>degrees*Math.PI/180;
  const deltaLat=radians(pin.lat-gps.lat);
  const deltaLng=radians(pin.lng-gps.lng);
  const a=Math.sin(deltaLat/2)**2+Math.cos(radians(gps.lat))*Math.cos(radians(pin.lat))*Math.sin(deltaLng/2)**2;
  const distance=12742*Math.asin(Math.min(1,Math.sqrt(a)));
  const far=distance>=5;
  const uncertain=gps.accuracy>1500;
  const km = distance<.1 ? 'less than 100 m' : new Intl.NumberFormat('en-NZ',{maximumFractionDigits:distance<20?1:0}).format(distance)+' km';
  const message=far ? `This restaurant is about ${km} from you. Double-check the branch before continuing.` :
    uncertain ? 'Your GPS location is approximate. Double-check the branch before continuing.' :
    `This restaurant is ${km} from your location.`;
  return {confirm:far||uncertain,message};
}
function updateLocation() {
  if (!$('#map-link')) return;
  const name=state.name.trim();
  $('#map-link').innerHTML=name ? mapsLink(name,state.address,state.place?.id) : '';
  $('#place-search').hidden=state.config?.places!==true;
  $('#location-status').textContent=state.gpsMessage || (state.config?.places===false ?
    'Use the Google Maps link to look up the address, then enter it here.' :
    'Location helps check the distance to the branch. Your GPS stays on this device.');
  const check=locationCheck();
  $('#distance').innerHTML=check.confirm ?
    `${notice(check.message,'pin')}<label class="checkbox confirm-place"><input type="checkbox" id="confirm-location" ${state.confirmed?'checked':''}>I confirm this is the correct restaurant and address.</label>` :
    notice(check.message,'check');
  if (check.confirm) $('#confirm-location').onchange=event=>{state.confirmed=event.target.checked;};
}
function requestLocation() {
  if (!navigator.geolocation) {
    state.gpsMessage='Location is unavailable. You can still confirm the address.';
    return updateLocation();
  }
  $('#gps').disabled=true;
  $('#location-status').textContent='Checking your location…';
  const finish=()=>{
    if (state.step===2) {
      $('#gps').disabled=false;
      updateLocation();
    }
  };
  navigator.geolocation.getCurrentPosition(({coords})=>{
    state.position={lat:coords.latitude,lng:coords.longitude,accuracy:coords.accuracy};
    state.gpsMessage='Location is available for this submission.';
    state.confirmed=false;
    finish();
  },()=>{
    state.gpsMessage='Location was unavailable. You can still confirm the address.';
    finish();
  },{enableHighAccuracy:false,timeout:10000,maximumAge:120000});
}
async function findPlaces() {
  const name=state.name.trim();
  if (name.length<2) {
    errorAt($('#step-error'),'Enter a restaurant name to search.');
    return;
  }
  const button=$('#place-search');
  button.disabled=true;
  errorAt($('#step-error'),'');
  $('#place-results').textContent='Searching restaurants…';
  try {
    const result=await api('/places',{query:[name,state.address.trim()].filter(Boolean).join(', ').slice(0,220)});
    if (state.step===2) {
      state.lookup=result.places;
      state.lookupSource=result.source;
      renderPlaces(true);
    }
  } catch(error) {
    if (state.step===2) {
      $('#place-results').textContent='';
      errorAt($('#step-error'),error.message);
    }
  } finally {
    button.disabled=false;
  }
}
function renderPlaces(searched=false) {
  const list=$('#place-results');
  if (!state.lookup.length) {
    list.innerHTML=searched ? '<p class="field-hint">No matching restaurants found. Try adding the city, or enter the address yourself.</p>' : '';
    return;
  }
  list.innerHTML=state.lookup.map((place,i)=>`<button type="button" class="place-result" data-place="${i}">${icon('pin')}<span><strong>${escape(place.name)}</strong><small>${escape(place.address)}</small></span></button>`).join('')
    + (state.lookupSource==='osm' ? '<a class="maps-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>' :
      '<span class="maps-attribution" translate="no">Google Maps</span>');
  const attributions=new Map(state.lookup.flatMap(place=>place.attributions||[]).map(item=>[item.provider,item.providerUri]));
  for (const [name,url] of attributions) {
    if (name && /^https?:\/\//.test(url)) list.insertAdjacentHTML('beforeend',`<a class="maps-attribution" href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(name)}</a>`);
  }
  list.querySelectorAll('button').forEach(button=>button.onclick=()=>{
    const place=state.lookup[Number(button.dataset.place)];
    state.name=place.name;
    state.address=place.fullAddress===false ? '' : place.address;
    state.place=place;
    state.confirmed=false;
    state.verified=false;
    state.lookup=[];
    $('#restaurant-name').value=place.name;
    $('#restaurant-address').value=state.address;
    renderPlaces();
    updateLocation();
    $('#restaurant-address').focus();
  });
}

let widget;
let turnstileScript;
let reading=false;
dialog.addEventListener('cancel',event=>{if(reading) event.preventDefault();});
dialog.addEventListener('close',()=>{
  if (widget!==undefined) {
    window.turnstile?.remove(widget);
    widget=undefined;
  }
});
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (!turnstileScript) turnstileScript=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async=true;
    script.onload=resolve;
    script.onerror=()=>{turnstileScript=null;script.remove();reject(new Error('The human check could not load.'));};
    document.head.append(script);
  });
  return turnstileScript;
}
function consentModal() {
  const ready=state.config?.generation;
  showModal('Share this menu publicly','globe',`
    <p>To generate this menu, you must agree to publish it. The finished page will show <strong>${escape(state.name)}</strong>, the branch address, the menu date, reviewed text and AI dish images. Anyone can open and share the link.</p>
    <p>OpenAI reads the uploaded photos. Your photos and GPS stay off the published page. Menu Lens records the requesting IP address in its private generation history.</p>
    <label class="checkbox"><input type="checkbox" id="consent">I agree to publish this menu and the restaurant details.</label>
    ${ready ? '<div id="challenge" aria-label="Human verification"></div>' : notice('New menu generation is temporarily unavailable.')}
    <p class="error" id="verify-error" role="alert" hidden></p>
    <div class="form-actions">${primary('Verify &amp; read menu','shield','id="read-menu" disabled')}</div>`);
  if (!ready) return;
  const consent=$('#consent',dialog);
  const error=$('#verify-error',dialog);
  const target=$('#challenge',dialog);
  const read=$('#read-menu',dialog);
  let token='';
  function sync(){read.disabled=reading || !consent.checked || !token;}
  loadTurnstile().then(()=>{
    if (!dialog.open || !target.isConnected) return;
    widget=window.turnstile.render(target,{
      sitekey:state.config.siteKey,action:'menu_submit',theme:getComputedStyle(document.documentElement).colorScheme==='dark'?'dark':'light',
      size:matchMedia('(max-width: 375px)').matches?'compact':'normal',
      callback:value=>{token=value;sync();},
      'expired-callback':()=>{token='';sync();},
      'error-callback':()=>{token='';sync();errorAt(error,'The human check failed to load. Close this window and try again.');},
    });
  }).catch(errorValue=>errorAt(error,errorValue.message));
  consent.onchange=sync;
  read.onclick=async()=>{
    if (!token || !consent.checked || reading) return;
    reading=true;
    sync();
    errorAt(error,'');
    $('.modal-close',dialog).disabled=true;
    read.textContent='Uploading photos…';
    dialog.setAttribute('aria-busy','true');
    try {
      const verified=await api('/verify',{name:state.name,address:state.address,date:state.date,placeId:state.place?.id,
        locationConfirmed:state.confirmed || !locationCheck().confirm,consent:true,token});
      const pages=await Promise.all(state.files.map(async file=>{
        const blob=file.blob || await fetch(file.url).then(response=>{
          if (!response.ok) throw new Error('Your source photo has expired. Upload the menu again.');
          return response.blob();
        });
        return dataUrl(blob);
      }));
      const {id}=await api('/jobs/'+verified.id+'/upload',{pages});
      remember(id,state.name);
      location.assign('/menu/'+id);
    } catch(err) {
      errorAt(error,err.message);
      if (widget!==undefined) window.turnstile.reset(widget);
    } finally {
      token='';
      reading=false;
      read.innerHTML=icon('shield')+'Verify &amp; read menu';
      if (dialog.open) $('.modal-close',dialog).disabled=false;
      dialog.removeAttribute('aria-busy');
      sync();
    }
  };
}

function reviewStep() {
  const limit=state.config?.maxDishes || 100;
  flow.insertAdjacentHTML('beforeend',`
    <h2>Review the original details</h2><p class="muted">Check each name, description and price against the source. Leave a price blank if one wasn’t printed.</p>
    <div class="fields">
      ${state.warnings.length ? notice(state.warnings.join(' ')) : ''}
      <div class="review-grid"><ol id="dish-editors"></ol><aside class="source-pages" aria-label="Uploaded photos">
      ${state.files.map((file,i)=>`<a href="${file.url}" target="_blank" rel="noopener"><img src="${file.url}" alt="Open uploaded menu page ${i+1}"></a>`).join('')}</aside></div>
      <div><button type="button" class="btn quiet small" id="add-dish">${icon('plus')} Add dish</button></div>
      <label class="field">Menu notes <textarea class="control" id="notes" rows="2" maxlength="9000">${escape(state.notes)}</textarea></label>
      <details class="panel menu-details"><summary>Review full original menu text</summary>
        <label class="field">Original menu text <textarea class="control" id="transcript" rows="7" maxlength="65000">${escape(state.transcript)}</textarea></label>
      </details>
      <label class="checkbox"><input id="reviewed" type="checkbox">I’ve checked the dishes and prices and removed any personal information.</label>
      <p class="field-hint">After you submit, you can close this page. Your menu will publish here when every dish image is ready.</p>
      <p class="error" id="review-error" role="alert" hidden></p>
      <div class="form-actions"><button type="button" class="btn text back" id="review-back">${icon('back')} Restaurant</button>
      ${primary('Generate &amp; publish','sparkles','id="publish" disabled')}</div>
    </div>`);
  const reviewed=$('#reviewed');
  const publish=$('#publish');
  const sync=()=>{
    $('#add-dish').disabled=state.dishes.length>=limit;
    publish.disabled=!reviewed.checked || !state.dishes.length || state.dishes.length>limit;
  };
  const resetReview=()=>{reviewed.checked=false;sync();};
  function drawDishes() {
    const dishFields=[['name','Dish name',300],['section','Section',160],['price','Printed price or options',240]];
    $('#dish-editors').innerHTML=state.dishes.map((dish,i)=>`<li class="review-editor" data-edit-index="${i}">
      <div class="review-top"><strong>Dish ${i+1}</strong><button type="button" class="icon-button delete-dish" aria-label="Remove dish ${i+1}">${icon('close')}</button></div>
      ${dishFields.map(([key,label,max])=>`<label class="field">${label}<input class="control" data-key="${key}" maxlength="${max}" value="${escape(dish[key])}"></label>`).join('')}
      <label class="field">Description<textarea class="control" data-key="description" maxlength="1800" rows="2">${escape(dish.description)}</textarea></label></li>`).join('');
    sync();
  }
  drawDishes();
  if (state.dishes.length>limit) errorAt($('#review-error'),`This submission exceeds the ${limit}-dish limit. Start again with fewer pages.`);
  $('#dish-editors').addEventListener('input',event=>{
    const element=event.target;
    const editor=element.closest('[data-edit-index]');
    if (element.dataset.key && editor) {
      state.dishes[Number(editor.dataset.editIndex)][element.dataset.key]=element.value;
      resetReview();
    }
  });
  $('#dish-editors').addEventListener('click',event=>{
    const button=event.target.closest('.delete-dish');
    if (!button) return;
    const i=Number(button.closest('[data-edit-index]').dataset.editIndex);
    state.dishes.splice(i,1);
    drawDishes();
    resetReview();
    ($('.delete-dish',flow) || $('#add-dish')).focus();
  });
  $('#add-dish').onclick=()=>{
    state.dishes.push({name:'',section:'',description:'',price:''});
    drawDishes();
    resetReview();
    $('#dish-editors li:last-child input').focus();
  };
  $('#notes').oninput=event=>{state.notes=event.target.value;resetReview();};
  $('#transcript').oninput=event=>{state.transcript=event.target.value;resetReview();};
  reviewed.onchange=sync;
  $('#review-back').onclick=()=>go(2);
  publish.onclick=async()=>{
    const firstInvalid=state.dishes.findIndex(dish=>!dish.name.trim());
    if (firstInvalid>=0) {
      errorAt($('#review-error'),`Dish ${firstInvalid+1} needs a name.`);
      $(`[data-edit-index="${firstInvalid}"] input`,flow).focus();
      return;
    }
    publish.disabled=true;
    $('#review-back').disabled=true;
    errorAt($('#review-error'),'');
    try {
      const result=await api('/jobs/'+state.submissionId+'/publish',{reviewed:reviewed.checked,
        dishes:state.dishes,notes:state.notes,transcript:state.transcript});
      remember(result.id,state.name);
      location.replace('/menu/'+result.id);
    } catch(error) {
      if (error.status===403) {
        state.verified=false;
        go(2);
        errorAt($('#step-error'),error.message);
      } else {
        errorAt($('#review-error'),error.message);
      }
    } finally {
      publish.disabled=false;
      const back=$('#review-back');
      if (back) back.disabled=false;
    }
  };
}

const savedPrefix='menu-lens-submission-';
function savedSubmissions() {
  try {
    return Object.keys(localStorage).filter(key=>key.startsWith(savedPrefix)).flatMap(key=>{
      try {
        const item=JSON.parse(localStorage.getItem(key));
        return /^[a-f0-9]{20}$/.test(item?.id) && typeof item.name==='string' ? [item] : [];
      } catch {return [];}
    }).sort((a,b)=>b.saved-a.saved);
  } catch {return [];}
}
function remember(id,name) {
  try {
    const key=savedPrefix+id;
    if (!localStorage.getItem(key)) localStorage.setItem(key,JSON.stringify({id,name,saved:Date.now()}));
    for (const item of savedSubmissions().slice(20)) localStorage.removeItem(savedPrefix+item.id);
  } catch {}
}
function revealReturnLink() {
  if (!savedSubmissions().length) return;
  $('#return-bar').hidden=false;
}
async function recoverSubmissions() {
  // Also recover an upload whose acknowledgement was lost, or a job from an older client.
  try {
    const job=await api('/job');
    if (job) remember(job.id,job.name || 'Your menu');
  } catch {}
  revealReturnLink();
}
const labels={waiting:'Waiting to read',reading:'Reading the menu',review:'Ready to review',
  read_error:'Photos need attention',queued:'Waiting for illustrations',running:'Illustrating dishes',
  error:'Images need attention',complete:'Published'};
async function submissions() {
  document.title='Your submissions · Menu Lens';
  page('Your submissions','MENU LENS','Reopen a menu you started in this browser.',
    '<div class="saved-list" id="saved-list"><p class="muted">Loading your submissions…</p></div>');
  await recoverSubmissions();
  const items=savedSubmissions();
  const list=$('#saved-list');
  if (!items.length) {
    list.innerHTML=`<div class="panel"><h2>No submissions yet</h2><a class="text-link" href="/create">Upload a menu</a></div>`;
    return;
  }
  list.innerHTML=items.map(item=>`<a class="panel saved-menu" href="/menu/${item.id}">
    <span><strong>${escape(item.name)}</strong><small data-status="${item.id}">Check progress</small></span>${icon('book')}</a>`).join('');
  await Promise.all(items.map(async item=>{
    const status=$(`[data-status="${item.id}"]`,list);
    try {
      const job=await api('/jobs/'+item.id);
      status.textContent=labels[job.state];
    } catch(error) {
      if (error.status===404) status.textContent='Submission unavailable';
    }
  }));
}
async function openSubmission(id) {
  const path='/jobs/'+id;
  let previous='';
  let timer;
  let checking=false;
  let done=false;
  const back=pagesBack('/submissions','Your submissions');
  document.title='Menu progress · Menu Lens';
  async function refresh() {
    if (done || checking) return;
    checking=true;
    clearTimeout(timer);
    try {
      const job=await api(path);
      if (job.state==='complete') {
        done=true;
        return await showMenu(id);
      }
      if (job.state==='review') {
        const output=await api(path+'/review');
        const {restaurant,date}=job;
        Object.assign(state,{step:3,submissionId:id,name:restaurant.name,address:restaurant.address,date,
          place:restaurant.placeId ? {id:restaurant.placeId,name:restaurant.name,address:restaurant.address} : null,
          confirmed:true,read:true,verified:true,dishes:output.dishes,transcript:output.transcript,
          notes:output.notes,warnings:output.warnings,files:Array.from({length:output.photoCount},(_,i)=>({
            name:'Menu page '+(i+1),url:'/api'+path+'/photos/'+i,
          }))});
        remember(id,job.name);
        page(escape(job.name),'MENU REVIEW','Your menu is ready to check. Review it within 24 hours of uploading.',
          '<section class="panel review-panel" id="flow"></section>',back);
        document.title='Review '+job.name+' · Menu Lens';
        flow=$('#flow');
        renderStep();
        api('/config').then(config=>{state.config=config;if(state.step===2) updateLocation();}).catch(()=>{});
        done=true;
        return;
      }
      const signature=JSON.stringify(job);
      if (signature!==previous) {
        const reading=['waiting','reading'].includes(job.state);
        const active=reading || ['queued','running'].includes(job.state);
        const title=reading ? 'Reading your menu' : labels[job.state];
        const message=reading ? 'You can close this page. Come back in this browser to review the dishes and prices before publishing.' :
          active ? 'You can close this page. Your menu will publish at this link as soon as every dish has an illustration.' :
          job.state==='read_error' ? job.error : 'Generation stopped before all the images were ready. Completed illustrations have been saved.';
        const progress=Number.isInteger(job.total) ? `<progress class="progress" aria-label="Dish images generated" value="${job.completed}" max="${job.total}"></progress>
          <p class="field-hint">${job.completed} of ${job.total} dish images ready</p>` : '';
        page(escape(job.name),'MENU SUBMISSION','',`<section class="panel progress-panel">
          <div class="modal-icon">${icon(reading?'book':'sparkles')}</div><h2>${title}</h2><p class="muted">${escape(message)}</p>
          ${progress}<p class="error" id="job-error" role="status" hidden></p>
          <div class="inline-actions"><button class="btn quiet" id="save-link">${icon('link')} Copy return link</button>
          ${job.canRetry ? primary('Retry remaining images','sparkles','id="retry"') : ''}
          ${job.state==='read_error' ? '<a class="btn primary" href="/create">Upload new photos</a>' : ''}</div></section>`,back);
        document.title=title+' · '+job.name+' · Menu Lens';
        $('#save-link').onclick=()=>share('Return link');
        if (job.canRetry) $('#retry').onclick=async event=>{
          const button=event.currentTarget;
          button.disabled=true;
          try {await api(path+'/retry',{});done=false;previous='';void refresh();}
          catch(error) {errorAt($('#job-error'),error.message);button.disabled=false;}
        };
        previous=signature;
        done=!active;
      }
      errorAt($('#job-error'),'');
    } catch(error) {
      if (error.status===404) {
        done=true;
        page('Menu unavailable','MENU LENS','Open private drafts in the browser you used to upload. Drafts expire after 24 hours.',
          '<a href="/explore" class="btn quiet">Explore published menus</a>',back);
      } else if ($('#job-error')) {
        errorAt($('#job-error'),'Connection interrupted. Checking again shortly…');
      } else {
        page('Checking your menu','MENU LENS','Reconnecting to your submission…','',back);
      }
    } finally {
      checking=false;
      if (!done && !document.hidden) timer=setTimeout(refresh,3500);
    }
  }
  document.addEventListener('visibilitychange',()=>{
    clearTimeout(timer);
    if (!document.hidden) void refresh();
  });
  window.addEventListener('pageshow',event=>{if (event.persisted) location.reload();});
  page('Opening your menu','MENU LENS','','',back);
  await refresh();
}

const route = location.pathname.replace(/\/$/,'') || '/';
if (route==='/') void home();
else if (route==='/admin') void import('./admin.js?v=2').then(({openAdmin})=>openAdmin({api,page,loadTurnstile,escape}));
else if (route==='/create') buildFlow();
else if (route==='/explore') void explore();
else if (route==='/privacy') privacy();
else if (route==='/submissions') void submissions();
else if (route.startsWith('/menu/')) void openSubmission(route.split('/')[2]);
if (['/','/create','/explore'].includes(route)) {
  revealReturnLink();
  void recoverSubmissions();
}
