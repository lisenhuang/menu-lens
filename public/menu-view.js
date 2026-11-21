import {icons} from './icons.js?v=3';
const icon = name=>`<span data-icon="${name}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg></span>`;
const escape = value=>String(value ?? '').replace(/[&<>"']/g, character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[character]);
function dateLabel(date) {
  return new Intl.DateTimeFormat('en-NZ',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
}
function pinText(pin) {
  return Number.isFinite(pin?.lat) && Number.isFinite(pin?.lng) ? pin.lat+', '+pin.lng : '';
}
function mapsUrl(name,address='',id='',pin) {
  const params = new URLSearchParams({api:'1',query:pinText(pin) || [name,address].filter(Boolean).join(', ')});
  if (id && !/^(osm|venue)-/.test(id)) params.set('query_place_id',id);
  return 'https://www.google.com/maps/search/?'+params;
}
function mapsLink(name,address,id,pin,label='Google Maps') {
  return `<a class="text-link" href="${escape(mapsUrl(name,address,id,pin))}" target="_blank" rel="noopener noreferrer">${label} ${icon('external')}</a>`;
}
const notice = (text,name='info')=>`<p class="notice">${icon(name)}<span>${escape(text)}</span></p>`;
const pagesBack = (href,label)=>`<a class="breadcrumb" href="${href}">${icon('back')} ${label}</a>`;
export {escape, icon, dateLabel, pinText, mapsLink, notice, pagesBack};
export function dishMedia(dish) {
  if (!dish.image) return `<div class="dish-image dish-pending" data-stage="${dish.active?'active':'waiting'}">
    ${icon('utensils')}<span>${dish.active?'Illustrating':'Awaiting photo'}</span></div>`;
  return `<a class="dish-image" href="${escape(dish.image)}" data-view-image aria-haspopup="dialog">
    <img src="${escape(dish.image)}" alt="AI illustration of ${escape(dish.name)}" width="780" height="500" loading="lazy"></a>`;
}
function dishCard(dish) {
  return `<article class="dish-card" id="${escape(dish.id)}" data-position="${dish.position}">${dishMedia(dish)}
    <div class="dish-body"><h3>${escape(dish.name)}</h3>${dish.price ? `<span class="price">${escape(dish.price)}</span>` : ''}
    ${dish.description ? `<p class="description">${escape(dish.description)}</p>` : ''}</div></article>`;
}

export function progressText(job) {
  if (job.state==='error') return 'Illustrations paused';
  if (job.state==='complete') return 'All dish photos ready';
  return 'Illustrating the menu';
}
function livePanel(menu) {
  const count=menu.completed, total=menu.count, active=menu.activePositions.length;
  return `<section class="live-photos" aria-label="Dish photo progress">
    <div class="live-summary" role="status" aria-atomic="true"><h2 id="live-title">${progressText(menu)}</h2>
      <p><strong id="live-count">${count} of ${total} photos ready</strong><span class="live-separator"> · </span><span id="live-active">${active} generating</span></p></div>
    <progress id="live-meter" max="${total}" value="${count}" aria-label="Dish photos ready"></progress>
    <label class="ready-filter"><input type="checkbox" id="ready-filter"> Show ready photos only</label>
    <button type="button" class="btn quiet small" id="live-retry" hidden>Retry remaining images</button>
    <p class="field-hint" id="live-message" role="status" hidden></p></section>`;
}
export function renderMenu(menu) {
  const sections = [...new Set(menu.dishes.map(dish=>dish.section))];
  const dates = (menu.versions || []).map(version=>`<li><a class="text-link" href="/menu/${escape(version.id)}">${dateLabel(version.date)}</a>${version.created ? ` <span class="muted">· Published ${dateLabel(version.created.slice(0,10))}</span>` : ''}</li>`).join('');
  return `<div class="page visual-menu" id="visual-menu" data-state="${escape(menu.state)}">
    ${pagesBack('/explore','Explore menus')}
    <section class="menu-cover"><div class="menu-cover-copy"><p class="eyebrow page-kicker">COMMUNITY VISUAL MENU</p>
    <h1 class="page-title">${escape(menu.restaurant.name)}</h1>
    <p class="page-intro">${escape(menu.restaurant.address)}</p>
    <p class="hero-note">${icon('calendar')} Photographed ${dateLabel(menu.date)}</p>
    <div class="inline-actions"><button type="button" class="btn primary" id="share">${icon('link')} Copy link</button>
    ${mapsLink(menu.restaurant.name,menu.restaurant.address,menu.restaurant.placeId,menu.restaurant.pin)}
    </div></div><a href="${escape(menu.cover)}" data-view-image aria-haspopup="dialog"><img src="${escape(menu.cover)}" alt="AI illustration of ${escape(menu.dishes.find(dish=>dish.image===menu.cover)?.name)}" width="780" height="500"></a></section>
    ${menu.state==='complete' ? '' : livePanel(menu)}
    ${notice('Dish images are AI illustrations. Confirm current prices, availability and allergens with the restaurant.','sparkles')}
    ${sections.length>1 ? `<nav aria-label="Menu sections" class="menu-jumps">${sections.map((section,i)=>`<a href="#section-${i}">${escape(section || 'Menu')}</a>`).join('')}</nav>` : ''}
    ${sections.map((section,i)=>`<section class="menu-section" id="section-${i}"><h2>${escape(section || 'Menu')}</h2><div class="dish-grid">${menu.dishes.filter(dish=>dish.section===section).map(dishCard).join('')}</div></section>`).join('')}
    ${menu.notes ? `<div class="panel menu-details"><h3>Notes from the menu</h3><p>${escape(menu.notes)}</p></div>` : ''}
    ${menu.originalCount ? `<details class="panel menu-details" id="original-menu" data-count="${menu.originalCount}" ${menu.state==='complete'?'':'hidden'}><summary>Original menu <small>· ${menu.originalCount} ${menu.originalCount===1?'page':'pages'}</small></summary><div class="original-pages"></div></details>` : ''}
    ${dates ? `<div class="panel menu-details"><h3>Other menus for this restaurant</h3><ul>${dates}</ul></div>` : ''}
    <a href="/create" class="btn quiet">${icon('plus')} Add a newer menu</a>
    </div>`;
}
