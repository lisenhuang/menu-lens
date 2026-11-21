import {icons} from './icons.js?v=3';
import {dateLabel, dishMedia, escape, icon, mapsLink, notice, pagesBack, pinText, progressText, renderMenu} from './menu-view.js?v=1';

const main = document.querySelector('#main');
const dialog = document.querySelector('#modal');
const theme = document.querySelector('.theme');
const $ = (selector,root=document)=>root.querySelector(selector);
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

function localDate() {
  const now = new Date();
  const local = new Date(now.getTime()-now.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,10);
}
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

function uploadPhotos(id,pages,onProgress) {
  return new Promise((resolve,reject)=>{
    const request=new XMLHttpRequest();
    request.upload.onprogress=event=>{
      if (event.lengthComputable && event.total>0) onProgress(event.loaded/event.total);
    };
    request.upload.onload=()=>onProgress(1);
    function unconfirmed() {
      const error=new Error('We couldn’t confirm the upload. Check its status before trying again.');
      error.progressPath='/menu/'+id;
      reject(error);
    }
    request.onload=()=>{
      if (request.status===202 && request.response?.id===id) return resolve();
      if (!request.response?.error || request.status>=500) return unconfirmed();
      reject(new Error(request.response.error));
    };
    request.onerror=request.ontimeout=unconfirmed;
    request.open('POST','/api/jobs/'+id+'/upload');
    request.responseType='json';
    request.timeout=5*60_000;
    request.setRequestHeader('Content-Type','application/json');
    request.send(JSON.stringify({pages}));
  });
}

function progressFeedback(id) {
  return `<div class="photo-progress" id="${id}" hidden><span role="status"></span>
    <progress class="progress" aria-label="Photo progress"></progress></div>`;
}
function showPhotoProgress(id,message,fraction=null) {
  const box=document.getElementById(id);
  box.hidden=!message;
  const label=box.querySelector('span'),meter=box.querySelector('progress');
  if (label.textContent!==message) label.textContent=message;
  if (fraction===null) meter.removeAttribute('value');else meter.value=fraction;
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

const viewer=$('#image-viewer');
const stage=$('.image-stage',viewer);
const fullImage=$('img',stage);
let imageOpener;
let nativeFullscreen=false;
main.addEventListener('click',event=>{
  const link=event.target.closest('a[data-view-image]');
  if (!link || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  imageOpener=link;
  fullImage.alt=$('img',link).alt;
  fullImage.src=link.href;
  viewer.showModal();
  // The dialog also fills the viewport on browsers without element fullscreen.
  if (document.fullscreenEnabled && !document.fullscreenElement) stage.requestFullscreen().catch(()=>{});
});
$('button',stage).addEventListener('click',()=>viewer.close());
stage.addEventListener('click',event=>{if (event.target===stage || event.target===fullImage) viewer.close();});
document.addEventListener('fullscreenchange',()=>{
  if (document.fullscreenElement===stage) nativeFullscreen=true;
  else if (nativeFullscreen) {
    nativeFullscreen=false;
    if (viewer.open) viewer.close();
  }
});
viewer.addEventListener('close',()=>{
  if (document.fullscreenElement===stage) document.exitFullscreen().catch(()=>{});
  fullImage.removeAttribute('src');
  imageOpener?.focus({preventScroll:true});
});

function listing(menu) {
  return `<article class="dish-card menu-card"><a class="dish-image" href="${escape(menu.cover)}" data-view-image aria-haspopup="dialog"><img src="${escape(menu.cover)}" alt="Cover photo for ${escape(menu.restaurant.name)}" width="780" height="500" loading="lazy"></a>
  <a class="dish-body" href="/menu/${escape(menu.id)}"><div><h3>${escape(menu.restaurant.name)}</h3><p>${escape(menu.restaurant.address)}</p>
    <p>Photographed ${dateLabel(menu.date)} · ${menu.count} ${menu.count === 1 ? 'dish' : 'dishes'}${menu.state!=='complete' && Number.isInteger(menu.completed) ? ` · ${menu.completed} photos ready` : ''}</p></div></a></article>`;
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

function filterDishes() {
  const onlyReady=$('#ready-filter')?.checked;
  for (const section of main.querySelectorAll('.menu-section')) {
    let visible=0;
    for (const card of section.querySelectorAll('[data-position]')) {
      card.hidden=Boolean(onlyReady && card.querySelector('.dish-pending'));
      if (!card.hidden) visible++;
    }
    section.hidden=visible===0;
    const link=main.querySelector(`.menu-jumps a[href="#${section.id}"]`);
    if (link) link.hidden=section.hidden;
  }
}
function bindMenu(id) {
  const title=$('.menu-cover h1').textContent;
  document.title=title+' · Menu Lens';
  $('#share').onclick=()=>share();
  const filter=$('#ready-filter');
  if (filter) filter.onchange=filterDishes;
  const originals=$('#original-menu');
  originals?.addEventListener('toggle',()=>{
    if (originals.hidden || !originals.open || originals.querySelector('img')) return;
    $('.original-pages',originals).innerHTML=Array.from({length:Number(originals.dataset.count)},(_,i)=>{
      const url=`/originals/${id}/${i}.jpg`;
      return `<a href="${url}" data-view-image aria-haspopup="dialog"><img src="${url}" loading="lazy" alt="Original menu page ${i+1} from ${escape(title)}"><span>View page ${i+1} full screen</span></a>`;
    }).join('');
  });
  const retry=$('#live-retry');
  if (retry) retry.onclick=async()=>{
    retry.disabled=true;
    try {await api('/jobs/'+id+'/retry',{});}
    catch(error) {errorAt($('#live-message'),error.message);}
    finally {retry.disabled=false;}
  };
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}
function updateMenuPhotos(job) {
  const menu=$('#visual-menu');
  if (!menu || !$('#live-meter')) return;
  menu.dataset.state=job.state;
  const ready=new Set(job.readyPositions),active=new Set(job.activePositions);
  for (const placeholder of menu.querySelectorAll('.dish-pending')) {
    const card=placeholder.closest('[data-position]'),i=Number(card.dataset.position);
    if (ready.has(i)) {
      placeholder.outerHTML=dishMedia({name:$('h3',card).textContent,image:`/media/${job.id}/${i}.webp`});
    } else {
      const stage=active.has(i)?'active':'waiting';
      if (stage!==placeholder.dataset.stage) {
        placeholder.dataset.stage=stage;
        placeholder.lastElementChild.textContent=active.has(i)?'Illustrating':'Awaiting photo';
      }
    }
  }
  for (const [selector,text] of [['#live-title',progressText(job)],['#live-count',`${job.completed} of ${job.total} photos ready`],['#live-active',`${active.size} generating`]]) {
    const el=$(selector);
    if (el.textContent!==text) el.textContent=text;
  }
  $('#live-meter').value=job.completed;
  $('#live-retry').hidden=!job.canRetry;
  $('#live-message').hidden=true;
  if (job.state==='complete') {
    if ($('#original-menu')) $('#original-menu').hidden=false;
    $('.ready-filter').hidden=true;
    $('.live-separator').hidden=true;
    $('#live-active').hidden=true;
  }
  filterDishes();
}

function privacy() {
  document.title = 'Privacy · Menu Lens';
  page('Privacy','MENU LENS','What happens to your menu photo and location.',
    `<div class="panel privacy">
      <h3>Public menus</h3><p>Generating a visual menu requires permission to publish it. The finished page includes the restaurant name and address, menu date, transcribed dishes and prices, AI dish images, and the original menu photos. It can be browsed or shared by link.</p>
      <p>Upload restaurant menus you are allowed to share. Leave out photos of people, receipts, and any personal information. Remove private details from the photos before uploading.</p>
      <p>OpenAI reads your menu photos. Photos stay private while the menu is being prepared. If reading fails, you can retry from the same browser within 24 hours of uploading. The menu and its illustrations become public with the first dish photo. The original pages become public in the Original menu section once all illustrations are ready. Unpublished drafts expire, and photos from menus that already picture every dish are discarded.</p>
      <p>Save the menu link to return to your draft. A cookie lets you open it in the browser you used to upload.</p>
      <p>Menu Lens stores the requesting IP address and its approximate city, when supplied by Cloudflare, alongside generation times and AI usage costs. Only signed-in administrators can view these records.</p>
      <p>GPS is optional and stays in your browser. Your browser uses it to compare your position with the restaurant coordinates when available.</p>
      <p>Cloudflare Turnstile verifies submissions. Searching in Google Maps sends your query to Google.</p>
      <p>New Zealand restaurant search uses <a class="text-link" href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>. The <a class="text-link" href="/data/nz-restaurants.json">New Zealand restaurant index</a> is available under the Open Database Licence.</p>
    </div>`);
}

const state = {
  step:1, files:[], preparing:null, name:'',address:'',date:localDate(),place:null, position:null,
  manualPin:'',config:null,
};
let flow,configRequest;
function buildFlow() {
  document.title = 'Create a visual menu · Menu Lens';
  page('Create a visual menu','FROM PAPER TO PICTURE','Upload your photos and choose the restaurant. Menu Lens reads the dishes and prices, illustrates the menu and publishes it for you.',
    `<div class="flow"><section class="panel" id="flow"></section>
      <aside class="panel side-panel"><h3>Before you upload</h3><ul>
      <li>${icon('camera')} <span>Capture the page straight on and check that prices are readable.</span></li>
      <li>${icon('pin')} <span>Use the address of the exact restaurant branch.</span></li>
      <li>${icon('globe')} <span>Finished menus include your original menu photos. Your GPS location stays private.</span></li>
      </ul></aside></div>`);
  flow = $('#flow');
  renderStep();
  configRequest=api('/config').then(config=>{
    state.config=config;
    if (state.step===1) updateUpload();
    if (state.step===2) updateLocation();
  }).catch(()=>{
    state.config={generation:false,places:false};
    if (state.step===1) updateUpload();
    if (state.step===2) updateLocation();
  });

}
function renderStep() {
  const labels = ['Photos','Restaurant'];
  flow.innerHTML = `<div class="steps" aria-label="Submission progress">${labels.map((item,i)=>`<span ${state.step===i+1 ? 'aria-current="step"' : ''}><b>${i+1}</b>${item}</span>`).join('')}</div>`;
  [uploadStep,locationStep][state.step-1]();
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
    <h2>Upload menu photos</h2><p class="muted">Choose a menu where at least one dish is missing a photo. Your original pages will be kept and shared when you publish.</p>
    <div class="dropzone" id="drop-zone">${icon('upload')}<strong>Drop your menu photos here</strong><small>Up to 6 JPG, PNG, WebP or HEIC images</small>
    <div class="inline-actions"><button type="button" class="btn primary" id="choose">${icon('plus')} Choose photos</button>
    <button type="button" class="btn quiet" id="camera">${icon('camera')} Take photo</button></div>
    <input id="files" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden>
    <input id="capture" type="file" accept="image/*" capture="environment" hidden></div>
    ${progressFeedback('prepare-progress')}<p class="error" id="upload-error" role="alert" hidden></p><div class="files" id="selected-files"></div>
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
  list.innerHTML=state.files.map((file,i)=>`<div class="file-row"><a href="${file.url}" data-view-image aria-haspopup="dialog"><img src="${file.url}" alt="Preview ${escape(file.name)}"></a><span class="truncate">${escape(file.name)}</span>
    <button type="button" class="icon-button" data-remove="${i}" aria-label="Remove ${escape(file.name)}">${icon('close')}</button></div>`).join('');
  const batch=state.preparing;
  if (batch) {
    const slots=6-state.files.length;
    const pending=batch.files.slice(batch.index,batch.index+slots);
    list.insertAdjacentHTML('beforeend',pending.map((file,i)=>`<div class="file-row pending-file">
      ${icon('camera')}<span class="truncate">${escape(file.name || 'Menu photo')}</span><small>${i===0?'Preparing…':'Waiting'}</small></div>`).join(''));
    const total=batch.index+pending.length;
    showPhotoProgress('prepare-progress',`Preparing photo ${batch.index+1} of ${total} on this device…`,batch.index ? batch.index/total : null);
  } else {
    showPhotoProgress('prepare-progress','');
  }
  $('#choose').disabled=$('#camera').disabled=Boolean(batch);
  list.querySelectorAll('button').forEach(button=>button.onclick=()=>{
    URL.revokeObjectURL(state.files[Number(button.dataset.remove)].url);
    state.files.splice(Number(button.dataset.remove),1);
    updateUpload();
  });
  $('#next').disabled=!state.files.length || Boolean(batch);
  $('#availability').innerHTML=state.config?.generation===false ?
    notice('Menu submissions are temporarily unavailable. Please try again later.') : '';
}
async function addFiles(files) {
  if (state.preparing) return;
  const input=Array.from(files);
  if (!input.length) return;
  const messages=[];
  errorAt($('#upload-error'),'');
  for (const [index,file] of input.entries()) {
    if (state.files.length>=6) {
      messages.push('A submission can include up to six pages.');
      break;
    }
    state.preparing={files:input,index};
    updateUpload();
    try {
      if (file.size>22_000_000) throw new Error('too large');
      const blob=await preparePhoto(file);
      state.files.push({name:file.name || 'Menu photo',blob,url:URL.createObjectURL(blob)});
    } catch {
      messages.push(`${file.name || 'The photo'} could not be opened. Try a JPG, PNG or WebP file under 22 MB.`);
    }
  }
  state.preparing=null;
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
    <h2>Find the restaurant</h2><p class="muted">Search by name, then choose a branch to fill in its location.</p>
    <form id="location-form" class="fields">
      <label class="field">Restaurant name<input class="control" id="restaurant-name" required maxlength="180" enterkeyhint="search" value="${escape(state.name)}" placeholder="e.g. Ortega Fish Shack"></label>
      <div class="inline-actions">
        <button type="button" class="btn quiet small" id="place-search">${icon('search')} Search restaurants</button>
        <button type="button" class="btn quiet small" id="gps">${icon('locate')} Use my location</button>
        <span id="map-link"></span>
      </div>
      <div id="place-results" class="search-results" aria-live="polite"></div>
      <p id="location-status" class="field-hint" aria-live="polite"></p>
      <label class="field">Restaurant address or map location<input class="control" id="restaurant-address" required maxlength="400" value="${escape(state.address)}" placeholder="Street address, city"></label>
      <details id="pin-details"><summary class="field-hint">Restaurant map pin</summary>
        <label class="field">Map coordinates <span class="field-hint">Copy latitude and longitude from the restaurant pin.</span>
          <input class="control" id="pin-coordinates" value="${escape(state.manualPin || '')}" placeholder="-41.294, 174.784" autocomplete="off">
        </label>
      </details>
      <label class="field">Date photographed<input class="control" type="date" id="menu-date" min="1900-01-01" max="${localDate()}" required value="${escape(state.date)}"></label>
      <div id="distance"></div>
      <p>By choosing <strong>Generate &amp; publish</strong>, you agree to make the restaurant details, dish prices and your original menu photos public. Your menu is public as soon as the first dish photo is ready. The original pages appear when all illustrations are ready. Only upload photos you have permission to share.</p>
      <div id="challenge" aria-label="Human verification"></div>
      ${progressFeedback('transfer-progress')}<p class="error" id="step-error" role="alert" hidden></p>
      <div class="form-actions"><button type="button" class="btn text back" id="back">${icon('back')} Photos</button>
        <button type="submit" id="generate" class="btn primary" disabled>${icon('sparkles')} Generate &amp; publish</button></div>
    </form>`);
  let searchVersion=0;
  const results=$('#place-results');
  function clearResults() {
    searchVersion++;
    results.replaceChildren();
    $('#place-search').disabled=false;
  }
  function captureEdit(key,field) {
    $(field).addEventListener('input',event=>{
      clearResults();
      if (key==='manualPin' && state.manualPin && state.address===state.manualPin) {
        state.address=$('#restaurant-address').value=event.target.value;
      }
      if (key==='name' && state.place) state.address=$('#restaurant-address').value='';
      const addingStreetAddress=key==='address' && state.place?.fullAddress===false;
      if (!addingStreetAddress) {
        if (state.place && key!=='manualPin') state.manualPin=$('#pin-coordinates').value='';
        state.place=null;
      }
      state[key]=event.target.value;
      updateLocation();
    });
  }
  captureEdit('name','#restaurant-name');
  captureEdit('address','#restaurant-address');
  captureEdit('manualPin','#pin-coordinates');
  $('#menu-date').addEventListener('input',event=>{state.date=event.target.value;});
  const searchButton=$('#place-search');
  async function findPlaces() {
    if (searchButton.disabled) return;
    const query=state.name.trim();
    if (query.length<2) {
      results.textContent='Enter at least two characters to search.';
      return;
    }
    const version=++searchVersion;
    searchButton.disabled=true;
    results.textContent='Searching restaurants…';
    try {
      const result=await api('/places',{query});
      if (results.isConnected && version===searchVersion) renderPlaces(results,result);
    } catch {
      if (results.isConnected && version===searchVersion) results.textContent='Restaurant search is unavailable. Try again or enter the address below.';
    } finally {
      if (version===searchVersion) searchButton.disabled=false;
    }
  }
  searchButton.onclick=findPlaces;
  $('#restaurant-name').onkeydown=event=>{
    if (event.key==='Enter' && !event.isComposing && !searchButton.hidden) {
      event.preventDefault();
      void findPlaces();
    }
  };
  $('#gps').onclick=requestLocation;
  setupGeneration($('#location-form'));
  updateLocation();
}
function restaurantPin() {
  const source=state.place;
  if (Number.isFinite(source?.lat) && Number.isFinite(source?.lng)) return {lat:source.lat,lng:source.lng};
  const match=state.manualPin?.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match || Math.abs(+match[1])>90 || Math.abs(+match[2])>180) return null;
  return {lat:+match[1],lng:+match[2]};
}
function distanceMessage() {
  const pin=restaurantPin();
  const gps=state.position;
  if (!gps || !pin) return '';
  const radians=degrees=>degrees*Math.PI/180;
  const deltaLat=radians(pin.lat-gps.lat);
  const deltaLng=radians(pin.lng-gps.lng);
  const a=Math.sin(deltaLat/2)**2+Math.cos(radians(gps.lat))*Math.cos(radians(pin.lat))*Math.sin(deltaLng/2)**2;
  const distance=12742*Math.asin(Math.min(1,Math.sqrt(a)));
  const km = distance<.1 ? 'less than 100 m' : new Intl.NumberFormat('en-NZ',{maximumFractionDigits:distance<20?1:0}).format(distance)+' km';
  return gps.accuracy>1500 ? `Based on your approximate location, this branch is about ${km} away.` :
    `This restaurant is ${km} from your location.`;
}
function updateLocation() {
  if (!$('#map-link')) return;
  const name=state.name.trim();
  $('#map-link').innerHTML=name ? mapsLink(name,state.address || 'New Zealand',state.place?.id,restaurantPin(),
    state.place ? 'View branch on Google Maps' : 'Search Google Maps') : '';
  $('#place-search').hidden=state.config?.places===false;
  $('#location-status').textContent=state.gpsMessage || (state.config?.places===false ?
    'Use the Google Maps link to look up the address, then enter it here.' :
    'Location helps check the distance to the branch. Your GPS stays on this device.');
  const message=distanceMessage();
  $('#distance').textContent=message;
}
function requestLocation() {
  if (!navigator.geolocation) {
    state.gpsMessage='Location is unavailable. You can enter the address directly.';
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
    finish();
  },()=>{
    state.gpsMessage='Location was unavailable. You can enter the address directly.';
    finish();
  },{enableHighAccuracy:false,timeout:10000,maximumAge:120000});
}
function renderPlaces(list,{places,source}) {
  if (!places.length) {
    list.textContent='No matches in this directory. Try a suburb or city, or use Search Google Maps above.';
    return;
  }
  list.innerHTML=`<strong>${places.length===1?'1 match':places.length+' matches'} · Choose your branch</strong>`
    + places.map((place,i)=>`<button type="button" class="place-result" data-place="${i}">${icon('pin')}<span><strong>${escape([place.name,place.branch].filter(Boolean).join(' · '))}</strong><small>${escape(place.address || 'Map pin · '+pinText(place))}</small></span></button>`).join('')
    + (source==='osm' ? '<a class="maps-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>' :
      source==='google' ? '<span class="maps-attribution" translate="no">Google Maps</span>' : '');
  const attributions=new Map(places.flatMap(place=>place.attributions||[]).map(item=>[item.provider,item.providerUri]));
  for (const [name,url] of attributions) {
    if (name && /^https?:\/\//.test(url)) list.insertAdjacentHTML('beforeend',`<a class="maps-attribution" href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(name)}</a>`);
  }
  list.querySelectorAll('button').forEach(button=>button.onclick=()=>{
    const place=places[Number(button.dataset.place)];
    state.place=place;
    state.manualPin=$('#pin-coordinates').value=pinText(place);
    state.name=$('#restaurant-name').value=place.name;
    state.address=$('#restaurant-address').value=place.address || state.manualPin;
    list.textContent=place.fullAddress===false ? 'Restaurant pin selected. You can add a street address if you know it.' : 'Branch location filled in.';
    errorAt($('#step-error'),'');
    updateLocation();
    $('#menu-date').focus({preventScroll:true});
  });
}

let turnstileScript;
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
async function setupGeneration(form) {
  const target=$('#challenge',form);
  const error=$('#step-error',form);
  const button=$('#generate',form);
  const back=$('#back',form);
  let token='',widget,busy=false;
  function sync(){ button.disabled=busy || !token; }
  back.onclick=()=>{
    if (busy) return;
    if (widget!==undefined) window.turnstile.remove(widget);
    go(1);
  };
  form.onsubmit=async event=>{
    event.preventDefault();
    if (busy || !token) return;
    if (state.manualPin.trim() && !restaurantPin()) {
      errorAt(error,'Use a latitude and longitude separated by a comma, such as -41.294, 174.784.');
      return;
    }
    errorAt(error,'');
    busy=true;
    sync();
    back.disabled=true;
    button.textContent='Submitting…';
    showPhotoProgress('transfer-progress','Verifying submission…');
    try {
      const verified=await api('/verify',{name:state.name,address:state.address,date:state.date,
        placeId:state.place?.id,pin:restaurantPin(),consent:true,shareOriginals:true,autoPublish:true,token});
      showPhotoProgress('transfer-progress','Preparing upload…');
      const pages=await Promise.all(state.files.map(file=>dataUrl(file.blob)));
      showPhotoProgress('transfer-progress','Uploading photos…');
      await uploadPhotos(verified.id,pages,fraction=>{
        if (fraction>=1) showPhotoProgress('transfer-progress','Saving uploaded photos…');
        else showPhotoProgress('transfer-progress',`Uploading photos · ${Math.floor(fraction*100)}%`,fraction);
      });
      location.assign('/menu/'+verified.id);
    } catch(err) {
      showPhotoProgress('transfer-progress','');
      errorAt(error,err.message);
      if (err.progressPath) {
        const link=document.createElement('a');
        link.className='text-link';
        link.href=err.progressPath;
        link.textContent='Open upload progress';
        error.append(' ',link);
      }
      token='';
      busy=false;
      back.disabled=false;
      button.innerHTML=icon('sparkles')+' Generate &amp; publish';
      sync();
      if (widget!==undefined) window.turnstile.reset(widget);
    }
  };
  await configRequest;
  if (!form.isConnected) return;
  if (!state.config?.generation) {
    errorAt(error,'New menu generation is temporarily unavailable.');
    return;
  }
  try {
    await loadTurnstile();
    if (!form.isConnected) return;
    widget=window.turnstile.render(target,{
      sitekey:state.config.siteKey,action:'menu_submit',theme:getComputedStyle(document.documentElement).colorScheme==='dark'?'dark':'light',
      size:matchMedia('(max-width: 375px)').matches?'compact':'normal',
      callback:value=>{token=value;sync();},
      'expired-callback':()=>{token='';sync();},
      'error-callback':()=>{token='';sync();errorAt(error,'The human check failed to load. Please try again.');},
    });
  } catch(err) {if (form.isConnected) errorAt(error,err.message);}
}

const labels={waiting:'Waiting to read',reading:'Reading the menu',review:'Ready to generate',
  uploading:'Uploading photos',already_illustrated:'Every dish already has a photo',read_error:'Menu reading stopped',queued:'Waiting for illustrations',running:'Illustrating dishes',
  error:'Images need attention',complete:'Published'};
const imageCount=job=>`${job.completed} of ${job.total} dish images ready`;
const liveStates=new Set(['uploading','waiting','reading','queued','running']);
function statusLabel(job) {
  if (job.state==='running') return job.completed===job.total?'Publishing menu':imageCount(job);
  if (job.state==='reading') {
    const count=job.pageCount;
    if (!job.transcribing) return 'Opening menu photos';
    return count ? `Reading ${count} menu ${count===1?'photo':'photos'}` : 'Reading menu photos';
  }
  return labels[job.state] || 'Checking progress';
}

// Reconnect from a full snapshot so missed events and server restarts need no replay.
function watchJob(id,onStatus,onError) {
  const path='/jobs/'+id;
  let source,timer,last,revision=0,finished=false;
  function disconnect() {
    revision++;
    clearTimeout(timer);
    source?.close();
    source=null;
  }
  function stop() {
    finished=true;
    disconnect();
    document.removeEventListener('visibilitychange',resume);
    window.removeEventListener('pagehide',disconnect);
    window.removeEventListener('pageshow',resume);
    window.removeEventListener('online',resume);
  }
  function failure(error,rev) {
    if (rev!==revision || finished) return;
    last=undefined;
    disconnect();
    onError(error);
    if (error.status===404 || error.status===403) return stop();
    if (!document.hidden) timer=setTimeout(refresh,4000);
  }
  async function accept(job,rev) {
    if (rev!==revision || finished) return;
    const active=liveStates.has(job.state) || (job.state==='error' && job.completed>0);
    if (!active) {source?.close();source=null;}
    const signature=JSON.stringify(job);
    if (last!==signature) {
      await onStatus(job);
      if (rev!==revision) return;
      last=signature;
    }
    if (!active) return stop();
    if (source) return;
    if (!window.EventSource) {timer=setTimeout(refresh,3500);return;}
    source=new EventSource('/api'+path+'/events');
    let delivery=Promise.resolve();
    source.onmessage=event=>{
      delivery=delivery.then(()=>accept(JSON.parse(event.data),rev)).catch(error=>failure(error,rev));
    };
    source.onerror=()=>failure(new Error('Live connection interrupted.'),rev);
  }
  async function refresh() {
    disconnect();
    const rev=revision;
    if (finished || document.hidden) return;
    try {await accept(await api(path),rev);}
    catch(error) {failure(error,rev);}
  }
  function resume() {if (!finished) void refresh();}
  document.addEventListener('visibilitychange',resume);
  window.addEventListener('pagehide',disconnect);
  window.addEventListener('pageshow',resume);
  window.addEventListener('online',resume);
  void refresh();
  return stop;
}
async function openSubmission(id) {
  const path='/jobs/'+id;
  const back=pagesBack('/explore','Explore menus');
  if ($('#visual-menu')) {
    bindMenu(id);
    if ($('#visual-menu').dataset.state==='complete') return;
  } else {
    document.title='Menu progress · Menu Lens';
    if (!$('#job-opening')) page('Opening your menu','MENU LENS','','',back);
  }
  watchJob(id,async job=>{
    if (job.completed>0 || job.state==='complete') {
      if (!$('#visual-menu')) {
        main.innerHTML=renderMenu(await api('/menus/'+id));
        bindMenu(id);
      }
      updateMenuPhotos(job);
      return;
    }
    const images=Number.isInteger(job.total);
    const active=liveStates.has(job.state);
    const publishing=job.state==='running' && job.completed===job.total;
    const title=publishing?'Publishing menu':job.state==='running'?'Illustrating dishes':statusLabel(job);
    const messages={
      uploading:'Keep the upload page open until your photos have been received.',
      waiting:'Your photos are saved. Reading will start when the previous menu finishes.',
      reading:job.transcribing?'Checking dish names, prices and which dishes already have photos.':'Retrieving your photos for menu reading.',
      review:'This saved draft is private. Generate and publish it to share the dishes, prices and original photos.',
      queued:'Your menu is in the illustration queue.',
      running:job.illustrating?.length ? 'Working on '+job.illustrating.join(' and ')+'.' : 'Preparing the next illustrations for your menu.',
      error:'Generation stopped before all the images were ready. Completed illustrations have been saved.',
    };
    const message=publishing?'All dish images are ready.':job.error || messages[job.state] || '';
    if (!$('#job-panel')) {
      page(escape(job.name),'MENU SUBMISSION','',`<section class="panel progress-panel" id="job-panel">
        <ol class="job-stages" aria-label="Menu progress">${['Read menu','Illustrate','Publish'].map(label=>`<li><span></span>${label}</li>`).join('')}</ol>
        <div aria-live="polite" aria-atomic="true"><h2 id="job-title"></h2><p id="job-message" class="muted"></p><strong id="image-count"></strong></div>
        <progress id="job-meter" class="progress" aria-label="Menu progress"></progress>
        <p class="field-hint" id="job-return"></p><p class="error" id="job-error" role="status" hidden></p>
        <div class="inline-actions"><button class="btn quiet" id="save-link">${icon('link')} Copy return link</button>
        ${primary('Generate &amp; publish','sparkles','id="generate-draft" hidden')}
        ${primary('Retry remaining images','sparkles','id="retry" hidden')}<a class="btn primary" href="/create" id="new-upload" hidden>Upload another menu</a></div></section>`,back);
      $('#save-link').onclick=()=>share('Return link');
    }
    const step=publishing?2:images?1:0;
    document.querySelectorAll('.job-stages li').forEach((el,i)=>{
      el.classList.toggle('past',i<step);
      el.classList.toggle('stopped',i===step && !active);
      if (i===step) el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');
    });
    $('#job-title').textContent=title;
    $('#job-message').textContent=message;
    $('#image-count').textContent=images?imageCount(job):'';
    const meter=$('#job-meter');
    meter.hidden=!active && !images;
    if (images) {meter.max=job.total;meter.value=job.completed;} else meter.removeAttribute('value');
    $('#job-return').textContent=active && job.state!=='uploading' ? 'You can close this page. Save the link to return to your menu.' : '';
    if (job.state==='read_error' && job.pageCount) {
      const until=new Date(job.expires).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
      $('#job-return').textContent=`Your photos are private until ${until}. `+(job.canRetryRead?'You can retry with these photos.':'This draft has used all three reading attempts.');
    }
    const generate=$('#generate-draft');
    generate.hidden=job.state!=='review';
    generate.onclick=async()=>{
      generate.disabled=true;
      try {
        await api(path+'/publish',{useTranscription:true});
        void openSubmission(id);
      } catch(error) {errorAt($('#job-error'),error.message);generate.disabled=false;}
    };
    const retry=$('#retry');
    retry.hidden=!job.canRetry && !job.canRetryRead;
    retry.textContent=job.canRetryRead?'Retry reading menu':'Retry remaining images';
    retry.onclick=async()=>{
      retry.disabled=true;
      try {
        if (job.canRetryRead) await api(path+'/retry-read',{attempt:job.readAttempt});
        else await api(path+'/retry',{});
        void openSubmission(id);
      } catch(error) {errorAt($('#job-error'),error.message);retry.disabled=false;}
    };
    $('#new-upload').textContent=job.pageCount && job.state==='read_error'?'Choose different photos':job.state==='read_error'?'Upload photos again':'Upload another menu';
    $('#new-upload').className=job.canRetryRead?'btn quiet':'btn primary';
    $('#new-upload').hidden=!['already_illustrated','read_error'].includes(job.state);
    errorAt($('#job-error'),'');
    document.title=title+' · '+job.name+' · Menu Lens';
  },error=>{
    if (error.status===404 || error.status===403) {
      page('Menu unavailable','MENU LENS','Open private drafts in the browser you used to upload. Drafts expire after 24 hours.',
        '<a href="/explore" class="btn quiet">Explore published menus</a>',back);
    } else if ($('#live-message')) {
      errorAt($('#live-message'),'Reconnecting to photo updates…');
    } else if ($('#job-error')) {
      errorAt($('#job-error'),'Connection interrupted. Reconnecting…');
    } else {
      page('Checking your menu','MENU LENS','Reconnecting to your submission…','',back);
    }
  });
}

// Remove the list saved by older versions when this browser next visits.
try {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('menu-lens-submission-')) localStorage.removeItem(key);
  }
} catch {}

const route = location.pathname.replace(/\/$/,'') || '/';
if (route==='/') void home();
else if (route==='/admin') void import('./admin.js?v=5').then(({openAdmin})=>openAdmin({api,page,loadTurnstile,escape}));
else if (route==='/create') buildFlow();
else if (route==='/explore') void explore();
else if (route==='/privacy') privacy();
else if (route.startsWith('/menu/')) {
  void openSubmission(route.split('/')[2]);

}
