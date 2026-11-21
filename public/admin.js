export async function openAdmin({api,page,loadTurnstile,escape}) {
  const guide='https://developers.openai.com/api/docs/guides/image-generation#calculating-costs';
  document.title='Generation settings · Menu Lens';
  function view(title,intro,content) {
    page(title,'MENU LENS ADMIN',intro,content);
  }
  async function login() {
    view('Admin sign-in','Sign in to manage how menus are generated.',`
      <form class="panel admin-panel fields" id="admin-login" method="post" action="/api/admin/login">
        <label class="field">PIN<input class="control" name="pin" type="password" inputmode="numeric" autocomplete="current-password" pattern="[0-9]{6}" maxlength="6" required></label>
        <div id="admin-check" aria-label="Human verification"></div>
        <p class="error" role="alert" id="login-message"></p>
        <button class="btn primary" type="submit" disabled>Sign in</button>
      </form>`);
    const form=document.querySelector('#admin-login');
    const pin=form.elements.pin;
    const button=form.querySelector('button');
    const message=form.querySelector('#login-message');
    let token='',busy=false,widget;
    const sync=()=>{button.disabled=busy || !token || !pin.validity.valid;};
    pin.addEventListener('input',sync);
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if (busy || !token || !pin.validity.valid) return;
      busy=true;
      sync();
      message.textContent='';
      try {
        await api('/admin/login',{pin:pin.value,token});
        pin.value='';
        window.turnstile.remove(widget);
        await loadSettings();
      } catch(error) {
        message.textContent=error.message;
        pin.value='';
        pin.focus();
        token='';
        window.turnstile.reset(widget);
      } finally {busy=false;sync();}
    });
    try {
      const {siteKey}=await api('/config');
      if (!siteKey) throw new Error('Human verification is unavailable.');
      await loadTurnstile();
      widget=window.turnstile.render('#admin-check',{sitekey:siteKey,action:'admin_login',theme:'auto',size:'flexible',
        callback:value=>{token=value;message.textContent='';sync();},
        'expired-callback':()=>{token='';sync();},
        'error-callback':()=>{token='';message.textContent='Human verification could not load. Refresh to try again.';sync();},
      });
    } catch(error) {message.textContent=error.message;}
  }
  function settingsForm(data) {
    const {imageModels,readingModel,readingEfforts}=data;
    let saved=data.settings;
    const options=values=>values.map(v=>`<option value="${escape(v)}">${escape(v)}</option>`).join('');
    view('Generation settings','Choose how new menu uploads are read and illustrated.',`
      <form class="panel admin-panel fields" id="admin-settings">
        <h2>Dish illustrations</h2>
        <label class="field">Image model<select class="control" name="model">${options(Object.keys(imageModels))}</select></label>
        <label class="field">Image quality<select class="control" name="quality"></select></label>
        <div class="admin-estimate"><span>Estimated image output</span>
          <strong><output id="estimate" aria-live="polite"></output> <small>USD / image</small></strong>
          <p>1024 × 1024. Prompt tokens and menu reading are billed separately. <a class="text-link" href="${guide}" target="_blank" rel="noopener noreferrer">OpenAI pricing calculator</a></p>
        </div>
        <h2>Menu reading</h2>
        <label class="field">Thinking level<select class="control" name="reasoning">${options(readingEfforts)}</select></label>
        <p class="field-hint">Reasoning effort for ${escape(readingModel)} when transcribing menu photos.</p>
        <p id="admin-message" role="status"></p>
        <div class="inline-actions"><button class="btn primary" type="submit" disabled>Save settings</button>
        <button class="btn quiet" type="button" id="sign-out">Sign out</button></div>
      </form>`);
    const form=document.querySelector('#admin-settings');
    const {model,quality,reasoning}=form.elements;
    const save=form.querySelector('[type="submit"]'),message=form.querySelector('#admin-message');
    model.value=saved.model;
    reasoning.value=saved.reasoning;
    function qualityOptions(preferred) {
      const levels=Object.keys(imageModels[model.value]);
      quality.innerHTML=options(levels);
      quality.value=levels.includes(preferred) ? preferred : 'high';
    }
    qualityOptions(saved.quality);
    function sync() {
      const cost=imageModels[model.value][quality.value]*data.outputUsdPerMillion/1e6;
      form.querySelector('#estimate').textContent='$'+cost.toFixed(5);
      save.disabled=model.value===saved.model && quality.value===saved.quality && reasoning.value===saved.reasoning;
    }
    form.addEventListener('change',event=>{
      if (event.target===model) qualityOptions(quality.value);
      message.textContent='';sync();
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      save.disabled=true;
      try {
        const result=await api('/admin/settings',{model:model.value,quality:quality.value,reasoning:reasoning.value});
        saved=result.settings;
        message.textContent='Settings saved.';
      } catch(error) {
        if (error.status===401) return login();
        message.textContent=error.message;
      } finally {sync();}
    });
    form.querySelector('#sign-out').onclick=async()=>{
      try {await api('/admin/logout',{});await login();}
      catch(error) {if(error.status===401) return login();message.textContent=error.message;}
    };
    sync();
  }
  async function loadSettings() {
    try {settingsForm(await api('/admin/settings'));}
    catch(error) {
      if (error.status===401) return login();
      view('Admin unavailable',escape(error.message),'<a class="btn quiet" href="/admin">Try again</a>');
    }
  }
  view('Generation settings','Loading…','');
  await loadSettings();
}
