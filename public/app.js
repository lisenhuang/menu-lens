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
function pinText(pin) {
  return Number.isFinite(pin?.lat) && Number.isFinite(pin?.lng) ? pin.lat+', '+pin.lng : '';
}
function mapsUrl(name,address='',id='',pin) {
  const params = new URLSearchParams({api:'1',query:pinText(pin) || [name,address].filter(Boolean).join(', ')});
  if (id && !id.startsWith('osm-')) params.set('query_place_id',id);
  return 'https://www.google.com/maps/search/?'+params;
}
function mapsLink(name,address,id,pin) {
  return `<a class="text-link" href="${escape(mapsUrl(name,address,id,pin))}" target="_blank" rel="noopener noreferrer">Google Maps ${icon('external')}</a>`;
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
    ${mapsLink(menu.restaurant.name,menu.restaurant.address,menu.restaurant.placeId,menu.restaurant.pin)}
    </div></div><img src="${escape(menu.cover)}" alt="AI illustration of ${escape(menu.dishes[0].name)}" width="780" height="500"></section>
    ${notice('Dish images are AI illustrations. Confirm current prices, availability and allergens with the restaurant.','sparkles')}
    ${sections.length>1 ? `<nav aria-label="Menu sections" class="menu-jumps">${sections.map((section,i)=>`<a href="#section-${i}">${escape(section || 'Menu')}</a>`).join('')}</nav>` : ''}
    ${sections.map((section,i)=>`<section class="menu-section" id="section-${i}"><h2>${escape(section || 'Menu')}</h2><div class="dish-grid">${menu.dishes.filter(dish=>dish.section===section).map(dishCard).join('')}</div></section>`).join('')}
    ${menu.notes ? `<div class="panel menu-details"><h3>Notes from the menu</h3><p>${escape(menu.notes)}</p></div>` : ''}
    ${menu.originals?.length ? `<details class="panel menu-details" id="original-menu"><summary>Original menu <small>· ${menu.originals.length} ${menu.originals.length===1?'page':'pages'}</small></summary><div class="original-pages"></div></details>` : ''}
    ${dates ? `<div class="panel menu-details"><h3>Other menus for this restaurant</h3><ul>${dates}</ul></div>` : ''}
    <a href="/create" class="btn quiet">${icon('plus')} Add a newer menu</a>
    </div>`;
  const originals=$('#original-menu');
  originals?.addEventListener('toggle',()=>{
    if (!originals.open || originals.querySelector('img')) return;
    $('.original-pages',originals).innerHTML=menu.originals.map((url,i)=>
      `<a href="${escape(url)}" target="_blank" rel="noopener"><img src="${escape(url)}" loading="lazy" alt="Original menu page ${i+1} from ${escape(menu.restaurant.name)}"><span>Open page ${i+1} ${icon('external')}</span></a>`).join('');
  });
  $('#share').addEventListener('click',()=>share());
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

function privacy() {
  document.title = 'Privacy · Menu Lens';
  page('Privacy','MENU LENS','What happens to your menu photo and location.',
    `<div class="panel privacy">
      <h3>Public menus</h3><p>Generating a visual menu requires permission to publish it. The finished page includes the restaurant name and address, menu date, reviewed dishes and prices, AI dish images, and the original menu photos. It can be browsed or shared by link.</p>
      <p>Upload restaurant menus you are allowed to share. Leave out photos of people, receipts, and any personal information. Review and remove private details before submitting.</p>
      <p>OpenAI reads your menu photos. Draft photos stay private for up to 24 hours, including when reading fails. You can retry from the same browser during that time. When you publish, anyone can open the Original menu section to see the submitted photos. Unpublished drafts expire, and photos from menus that already picture every dish are discarded.</p>
      <p>Save the menu link to return to your draft. A cookie lets you open it in the browser you used to upload.</p>
      <p>Menu Lens stores the requesting IP address alongside generation times and AI usage costs. Only signed-in administrators can view these records.</p>
      <p>GPS is optional and stays in your browser. Your browser uses it to compare your position with the restaurant coordinates when available.</p>
      <p>Cloudflare Turnstile verifies submissions. Searching in Google Maps sends your query to Google.</p>
      <p>New Zealand restaurant search uses <a class="text-link" href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>. The <a class="text-link" href="/data/nz-restaurants.json">New Zealand restaurant index</a> is available under the Open Database Licence.</p>
    </div>`);
}

const state = {
  step:1, files:[], preparing:null, name:'',address:'',date:localDate(),place:null, position:null,
  confirmed:false, manualPin:'', transcript:'', notes:'',dishes:[],warnings:[],read:false,
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
      <li>${icon('globe')} <span>Finished menus include your original menu photos. Your GPS location stays private.</span></li>
      </ul></aside></div>`);
  flow = $('#flow');
  renderStep();
  api('/config').then(config=>{
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
  list.innerHTML=state.files.map((file,i)=>`<div class="file-row"><img src="${file.url}" alt=""><span class="truncate">${escape(file.name)}</span>
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
    state.read=false;
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
      state.read=false;
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
      <p class="error" id="step-error" role="alert" hidden></p>
      <div class="form-actions"><button type="button" class="btn text back" id="back">${icon('back')} Photos</button>
        <button type="submit" class="btn primary">${icon('shield')} Review &amp; submit</button></div>
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
}
function restaurantPin() {
  const source=state.place;
  if (Number.isFinite(source?.lat) && Number.isFinite(source?.lng)) return {lat:source.lat,lng:source.lng};
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
  $('#map-link').innerHTML=name ? mapsLink(name,state.address,state.place?.id,restaurantPin()) : '';
  $('#place-search').hidden=state.config?.places===false;
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
function renderPlaces(list,{places,source}) {
  if (!places.length) {
    list.textContent='No matching restaurants found. Try the name with a suburb or city, or enter the address below.';
    return;
  }
  list.innerHTML=places.map((place,i)=>`<button type="button" class="place-result" data-place="${i}">${icon('pin')}<span><strong>${escape(place.name)}</strong><small>${escape(place.address || 'Map pin · '+pinText(place))}</small></span></button>`).join('')
    + (source==='osm' ? '<a class="maps-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>' :
      '<span class="maps-attribution" translate="no">Google Maps</span>');
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
    state.confirmed=false;
    state.verified=false;
    list.textContent=place.fullAddress===false ? 'Restaurant pin selected. You can add a street address if you know it.' : 'Branch location filled in.';
    errorAt($('#step-error'),'');
    updateLocation();
    ($('#confirm-location') || $('#menu-date')).focus({preventScroll:true});
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
    <p>To generate this menu, you must agree to publish it. The finished page will show <strong>${escape(state.name)}</strong>, the restaurant location, the menu date, reviewed text and AI dish images. Anyone can open and share the link.</p>
    <p>OpenAI checks the photos first. If every dish already has a photo, generation stops. Otherwise, the photos you submit will be kept and shared in the Original menu section when you publish. Your GPS stays private. Menu Lens records the requesting IP address in its private generation history.</p>
    <label class="checkbox"><input type="checkbox" id="consent">I agree to publish the restaurant details and my original menu photos.</label>
    ${ready ? '<div id="challenge" aria-label="Human verification"></div>' : notice('New menu generation is temporarily unavailable.')}
    ${progressFeedback('transfer-progress')}<p class="error" id="verify-error" role="alert" hidden></p>
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
    read.textContent='Submitting…';
    showPhotoProgress('transfer-progress','Verifying submission…');
    try {
      const verified=await api('/verify',{name:state.name,address:state.address,date:state.date,placeId:state.place?.id,pin:restaurantPin(),
        locationConfirmed:state.confirmed || !locationCheck().confirm,consent:true,shareOriginals:true,token});
      showPhotoProgress('transfer-progress','Preparing upload…');
      const pages=await Promise.all(state.files.map(async file=>{
        const blob=file.blob || await fetch(file.url).then(response=>{
          if (!response.ok) throw new Error('Your source photo has expired. Upload the menu again.');
          return response.blob();
        });
        return dataUrl(blob);
      }));
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
        link.target='_blank';
        link.rel='noopener';
        link.textContent='Check this upload';
        error.append(' ',link);
      }
      if (widget!==undefined) window.turnstile.reset(widget);
    } finally {
      token='';
      reading=false;
      read.innerHTML=icon('shield')+'Verify &amp; read menu';
      if (dialog.open) $('.modal-close',dialog).disabled=false;
      sync();
    }
  };
}

function reviewStep() {
  const limit=state.config?.maxDishes || 100;
  flow.insertAdjacentHTML('beforeend',`
    <h2>Review the original details</h2><p class="muted">Check each name, description and price against the source. Leave a price blank if one wasn’t printed.</p>
    <button type="button" class="btn quiet small" id="copy-draft-link">${icon('link')} Copy return link</button>
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
  $('#copy-draft-link').onclick=()=>share('Return link');
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

const labels={waiting:'Waiting to read',reading:'Reading the menu',review:'Ready to review',
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
    const active=liveStates.has(job.state);
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
    source.onmessage=event=>{
      if (rev!==revision) return;
      try {void accept(JSON.parse(event.data),rev).catch(error=>failure(error,rev));}
      catch(error) {failure(error,rev);}
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
  document.title='Menu progress · Menu Lens';
  if (!$('#job-opening')) page('Opening your menu','MENU LENS','','',back);
  watchJob(id,async job=>{
    if (job.state==='complete') return showMenu(id);
    if (job.state==='review') {
      const output=await api(path+'/review');
      const {restaurant,date}=job;
      Object.assign(state,{step:3,submissionId:id,name:restaurant.name,address:restaurant.address,date,
        place:restaurant.placeId ? {id:restaurant.placeId,...restaurant.pin} : null, manualPin:pinText(restaurant.pin),
        confirmed:true,read:true,verified:true,dishes:output.dishes,transcript:output.transcript,
        notes:output.notes,warnings:output.warnings,files:Array.from({length:output.photoCount},(_,i)=>({
          name:'Menu page '+(i+1),url:'/api'+path+'/photos/'+i,
        }))});
      page(escape(job.name),'MENU REVIEW','Your menu is ready to check. Review it within 24 hours of uploading.',
        '<section class="panel review-panel" id="flow"></section>',back);
      document.title='Review '+job.name+' · Menu Lens';
      flow=$('#flow');
      renderStep();
      api('/config').then(config=>{state.config=config;if(state.step===2) updateLocation();}).catch(()=>{});
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
      queued:'Your reviewed menu is in the illustration queue.',
      running:job.illustrating?.length ? 'Working on '+job.illustrating.join(' and ')+'.' : 'Preparing the next illustrations for your menu.',
      error:'Generation stopped before all the images were ready. Completed illustrations have been saved.',
    };
    const message=publishing?'All dish images are ready.':job.error || messages[job.state] || '';
    if (!$('#job-panel')) {
      page(escape(job.name),'MENU SUBMISSION','',`<section class="panel progress-panel" id="job-panel">
        <ol class="job-stages" aria-label="Menu progress">${['Read menu','Review','Illustrate','Publish'].map(label=>`<li><span></span>${label}</li>`).join('')}</ol>
        <div aria-live="polite" aria-atomic="true"><h2 id="job-title"></h2><p id="job-message" class="muted"></p><strong id="image-count"></strong></div>
        <progress id="job-meter" class="progress" aria-label="Menu progress"></progress>
        <p class="field-hint" id="job-return"></p><p class="error" id="job-error" role="status" hidden></p>
        <div class="inline-actions"><button class="btn quiet" id="save-link">${icon('link')} Copy return link</button>
        ${primary('Retry remaining images','sparkles','id="retry" hidden')}<a class="btn primary" href="/create" id="new-upload" hidden>Upload another menu</a></div></section>`,back);
      $('#save-link').onclick=()=>share('Return link');
    }
    const step=publishing?3:images?2:0;
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
    $('#job-return').textContent=active && job.state!=='uploading' ? (images?'Copy this link before closing the page. Your finished menu will appear here.':'Copy this link before closing the page. Open it in the same browser to review your menu.') : '';
    if (job.state==='read_error' && job.pageCount) {
      const until=new Date(job.expires).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
      $('#job-return').textContent=`Your photos are private until ${until}. `+(job.canRetryRead?'You can retry with these photos.':'This draft has used all three reading attempts.');
    }
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
else if (route==='/admin') void import('./admin.js?v=2').then(({openAdmin})=>openAdmin({api,page,loadTurnstile,escape}));
else if (route==='/create') buildFlow();
else if (route==='/explore') void explore();
else if (route==='/privacy') privacy();
else if (route.startsWith('/menu/')) {
  void openSubmission(route.split('/')[2]);
  window.addEventListener('pageshow',event=>{if (event.persisted) location.reload();});
}
