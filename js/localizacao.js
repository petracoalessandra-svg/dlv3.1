(function (root) {
  'use strict';

  const KEY = 'delivery_location';
  const regions = root.DELIVERY_REGIONS || {};
  let selected = null;
  let dialog = null;
  let required = false;

  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

  function validate(value) {
    if (!value || typeof value.state !== 'string' || typeof value.city !== 'string') return null;
    const state = value.state.toUpperCase().trim();
    const region = regions[state];
    if (!region) return null;
    const city = region.cities.find(name => normalize(name) === normalize(value.city));
    return city ? { state, city } : null;
  }

  function cookie(name) {
    try {
      const part = document.cookie.split(/;\s*/).find(value => value.startsWith(name + '='));
      if (!part) return '';
      const value = part.slice(name.length + 1);
      try { return decodeURIComponent(value); } catch (_) { return value; }
    } catch (_) { return ''; }
  }

  function writeCookies(value) {
    try {
      const suffix = '; max-age=31536000; path=/; SameSite=Lax' + (root.location.protocol === 'https:' ? '; Secure' : '');
      document.cookie = 'localCidade=' + encodeURIComponent(value.city) + suffix;
      document.cookie = 'localEstado=' + encodeURIComponent(value.state) + suffix;
      return cookie('localCidade') === value.city && cookie('localEstado') === value.state;
    } catch (_) { return false; }
  }

  function writeStored(value) {
    try {
      root.localStorage.setItem(KEY, JSON.stringify({ version: 1, ...value }));
      return true;
    } catch (_) { return false; }
  }

  function get() {
    try {
      const value = validate(JSON.parse(root.localStorage.getItem(KEY) || 'null'));
      if (value) { selected = value; return { ...value }; }
    } catch (_) { /* Cookies remain available if localStorage is blocked or corrupt. */ }
    const previous = validate({ state: cookie('localEstado'), city: cookie('localCidade') });
    if (previous) {
      selected = previous;
      writeStored(previous);
      return { ...previous };
    }
    return selected ? { ...selected } : null;
  }

  function refresh() {
    const value = get();
    document.querySelectorAll('[data-location-city], [id="localCidade"], #delivery-city').forEach(element => {
      const format = element.getAttribute('data-location-city') || (element.id === 'delivery-city' ? 'region' : 'name');
      let text = 'Sua cidade';
      if (value) text = value.city;
      if (format === 'region') text = value ? value.city + ' - ' + value.state + ' e região' : 'Sua cidade e região';
      if (format === 'full') text = value ? value.city + ' - ' + value.state : 'Sua cidade - UF';
      element.textContent = text;
    });
    document.querySelectorAll('[data-location-state], [id="localEstado"]').forEach(element => {
      element.textContent = value ? value.state : 'UF';
    });
    document.querySelectorAll('[data-location-full], #modalBuscaCidade, #modalResultadoLocal').forEach(element => {
      element.textContent = value ? value.city + ' - ' + value.state : 'Sua cidade - UF';
    });
    return value;
  }

  function set(value) {
    const valid = validate(value);
    if (!valid) return false;
    // Commit both fields together; never keep a newly chosen state with the old city.
    const stored = writeStored(valid);
    const persistedCookie = writeCookies(valid);
    if (!stored && !persistedCookie) return false;
    selected = valid;
    refresh();
    root.dispatchEvent(new CustomEvent('delivery-location-change', { detail: { ...valid } }));
    return true;
  }

  function option(value, label) {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = label;
    return element;
  }

  function updateCities(state, city) {
    const select = dialog.querySelector('#location-city');
    select.replaceChildren(option('', 'Selecione sua cidade'));
    select.disabled = !regions[state];
    if (regions[state]) regions[state].cities.forEach(name => select.appendChild(option(name, name)));
    select.value = city || '';
    updateSubmit();
  }

  function updateSubmit() {
    const state = dialog.querySelector('#location-state').value;
    const city = dialog.querySelector('#location-city').value;
    dialog.querySelector('[data-location-confirm]').disabled = !validate({ state, city });
    dialog.querySelector('#location-error').textContent = '';
  }

  function buildDialog() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.id = 'location-dialog';
    dialog.className = 'location-dialog';
    dialog.setAttribute('aria-labelledby', 'location-title');
    dialog.setAttribute('aria-describedby', 'location-description');
    dialog.innerHTML = '<form id="location-form">'
      + '<span class="location-pin" aria-hidden="true">⌖</span>'
      + '<h2 id="location-title">Escolha sua localização</h2>'
      + '<p id="location-description">Selecione seu estado e sua cidade para ver as informações de entrega.</p>'
      + '<label for="location-state">Estado</label>'
      + '<select id="location-state" name="state" required autofocus></select>'
      + '<label for="location-city">Cidade</label>'
      + '<select id="location-city" name="city" required disabled></select>'
      + '<p id="location-error" role="alert"></p>'
      + '<button type="submit" class="location-confirm" data-location-confirm disabled>Confirmar localização</button>'
      + '<button type="button" class="location-cancel" data-location-cancel>Cancelar</button>'
      + '</form>';
    document.body.appendChild(dialog);
    const stateSelect = dialog.querySelector('#location-state');
    stateSelect.appendChild(option('', 'Selecione seu estado'));
    Object.entries(regions).sort((a, b) => a[1].name.localeCompare(b[1].name, 'pt-BR')).forEach(([uf, region]) => {
      stateSelect.appendChild(option(uf, region.name));
    });
    stateSelect.addEventListener('change', () => updateCities(stateSelect.value));
    dialog.querySelector('#location-city').addEventListener('change', updateSubmit);
    dialog.querySelector('[data-location-cancel]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', event => { if (required) event.preventDefault(); });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape' && required) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
    dialog.querySelector('#location-form').addEventListener('submit', event => {
      event.preventDefault();
      const value = { state: stateSelect.value, city: dialog.querySelector('#location-city').value };
      if (!validate(value)) { updateSubmit(); return; }
      if (!set(value)) {
        dialog.querySelector('#location-error').textContent = 'Não foi possível salvar sua localização. Permita o armazenamento neste navegador e tente novamente.';
        return;
      }
      required = false;
      dialog.close();
    });
  }

  function choose(options) {
    buildDialog();
    if (dialog.open) return;
    const current = get();
    required = Boolean(options && options.required) || !current;
    dialog.setAttribute('closedby', required ? 'none' : 'closerequest');
    dialog.querySelector('[data-location-cancel]').hidden = required;
    dialog.querySelector('#location-state').value = current ? current.state : '';
    updateCities(current ? current.state : '', current ? current.city : '');
    dialog.showModal();
  }

  function init() {
    refresh();
    if (!get()) choose({ required: true });
  }

  root.DeliveryLocation = Object.freeze({ get, set, choose, refresh, init });
  root.escolherLocalizacao = root.escolherLocalizacaoManual = () => choose();
  root.atualizarLocalizacao = () => Promise.resolve(refresh());
  root.fecharModalRestauranteProximo = function () {
    const modal = document.getElementById('modalRestauranteProximo');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
  };
  root.verOfertasModal = function () {
    root.fecharModalRestauranteProximo();
    const section = document.getElementById('marmitas-pratos');
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  document.addEventListener('click', event => {
    if (event.target.closest && event.target.closest('[data-location-change]')) choose();
  });
  document.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-location-change]:not(button)')) {
      event.preventDefault();
      choose();
    }
  });
  root.addEventListener('pageshow', init);
  root.addEventListener('storage', event => {
    if (event.key === KEY || event.key === null) {
      selected = null;
      const current = get();
      if (current) writeCookies(current);
      init();
    }
  });
  root.addEventListener('delivery-location-change', refresh);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
