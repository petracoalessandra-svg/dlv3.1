const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootPath = path.resolve(__dirname, '..');
const catalog = fs.readFileSync(path.join(rootPath, 'js/localizacao-data.js'), 'utf8');
const implementation = fs.readFileSync(path.join(rootPath, 'js/localizacao.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function session({ values = new Map(), cookies = new Map(), blockStorage = false, blockCookies = false } = {}) {
  const windowEvents = new Map();
  const documentEvents = new Map();
  const fields = [
    { id: 'header-city', attributes: { 'data-location-city': 'region' }, textContent: '' },
    { id: 'footer-city', attributes: { 'data-location-city': 'name' }, textContent: '' },
    { id: 'footer-state', attributes: { 'data-location-state': '' }, textContent: '' },
    { id: 'delivery-city', attributes: { 'data-location-city': 'region' }, textContent: '' },
    { id: 'full-location', attributes: { 'data-location-full': '' }, textContent: '' }
  ].map(field => ({ ...field, getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; } }));
  function matches(field, selector) {
    if (selector.startsWith('#')) return field.id === selector.slice(1);
    const attribute = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
    if (!attribute) return false;
    if (attribute[1] === 'id') return field.id === attribute[2];
    return Object.hasOwn(field.attributes, attribute[1]) && (attribute[2] === undefined || field.attributes[attribute[1]] === attribute[2]);
  }
  const document = {
    readyState: 'loading',
    body: { style: {} },
    querySelectorAll(selector) { return fields.filter(field => selector.split(',').some(part => matches(field, part.trim()))); },
    getElementById(id) { return fields.find(field => field.id === id) || null; },
    addEventListener(name, callback) { documentEvents.set(name, callback); },
    get cookie() { return blockCookies ? '' : Array.from(cookies, ([key, value]) => key + '=' + value).join('; '); },
    set cookie(value) {
      if (blockCookies) return;
      const pair = value.split(';')[0];
      const split = pair.indexOf('=');
      cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
  };
  const window = {
    location: { protocol: 'http:' },
    localStorage: {
      getItem(key) { if (blockStorage) throw Error('Storage blocked'); return values.get(key) ?? null; },
      setItem(key, value) { if (blockStorage) throw Error('Storage blocked'); values.set(key, value); }
    },
    addEventListener(name, callback) { windowEvents.set(name, callback); },
    dispatchEvent(event) { const callback = windowEvents.get(event.type); if (callback) callback(event); }
  };
  class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
  const context = vm.createContext({ window, document, CustomEvent, console });
  vm.runInContext(catalog, context);
  vm.runInContext(implementation, context);
  return { api: window.DeliveryLocation, fields, window, document, windowEvents, documentEvents, values, cookies, regions: window.DELIVERY_REGIONS };
}

test('a first visit requires a valid state/city pair; partial or invalid selections are not accepted', () => {
  assert.equal(session().api.get(), null);
  assert.equal(session({ cookies: new Map([['localEstado', 'SP']]) }).api.get(), null);
  const app = session();
  assert.equal(app.api.set({ state: 'SP', city: 'Rio de Janeiro' }), false);
  assert.equal(app.api.set({ state: 'XX', city: 'São Paulo' }), false);
  assert.equal(app.values.has('delivery_location'), false);
});

test('one confirmed choice updates every city/state slot and persists an atomic record', () => {
  const app = session();
  assert.equal(app.api.set({ state: 'sp', city: 'sao paulo' }), true);
  assert.deepEqual(plain(app.api.get()), { state: 'SP', city: 'São Paulo' });
  assert.deepEqual(JSON.parse(app.values.get('delivery_location')), { version: 1, state: 'SP', city: 'São Paulo' });
  assert.deepEqual(app.fields.map(field => field.textContent), ['São Paulo - SP e região', 'São Paulo', 'SP', 'São Paulo - SP e região', 'São Paulo - SP']);
  assert.equal(decodeURIComponent(app.cookies.get('localCidade')), 'São Paulo');
  assert.equal(app.cookies.get('localEstado'), 'SP');
});

test('a change never saves a new state with the previous city', () => {
  const app = session();
  app.api.set({ state: 'SP', city: 'São Paulo' });
  const previous = app.values.get('delivery_location');
  assert.equal(app.api.set({ state: 'RJ', city: 'São Paulo' }), false);
  assert.equal(app.values.get('delivery_location'), previous);
  assert.equal(app.api.set({ state: 'RJ', city: 'Rio de Janeiro' }), true);
  assert.deepEqual(plain(app.api.get()), { state: 'RJ', city: 'Rio de Janeiro' });
});

test('a fresh page or session restores the choice from persistent storage without an IP lookup', () => {
  const first = session();
  first.api.set({ state: 'MG', city: 'Belo Horizonte' });
  const nextPage = session({ values: first.values });
  nextPage.api.refresh();
  assert.deepEqual(plain(nextPage.api.get()), { state: 'MG', city: 'Belo Horizonte' });
  assert.equal(nextPage.fields[3].textContent, 'Belo Horizonte - MG e região');
  assert.doesNotMatch(implementation, /fetch\(|geolocation|ipGeo/);
});

test('existing encoded or unencoded location cookies migrate to the shared record', () => {
  for (const city of ['São Paulo', 'S%C3%A3o%20Paulo']) {
    const app = session({ cookies: new Map([['localEstado', 'SP'], ['localCidade', city]]) });
    assert.deepEqual(plain(app.api.get()), { state: 'SP', city: 'São Paulo' });
    assert.equal(JSON.parse(app.values.get('delivery_location')).city, 'São Paulo');
  }
});

test('corrupt storage recovers from valid legacy cookies; invalid city/state combinations are ignored', () => {
  const app = session({ values: new Map([['delivery_location', 'broken JSON']]), cookies: new Map([['localEstado', 'RJ'], ['localCidade', 'Rio de Janeiro']]) });
  assert.equal(app.api.get().state, 'RJ');
  const invalid = session({ values: new Map([['delivery_location', JSON.stringify({ state: 'SP', city: 'Rio de Janeiro' })]]) });
  assert.equal(invalid.api.get(), null);
});

test('cookies preserve a choice if localStorage is blocked, and localStorage works if cookies are blocked', () => {
  const cookieOnly = session({ blockStorage: true });
  assert.equal(cookieOnly.api.set({ state: 'BA', city: 'Salvador' }), true);
  assert.equal(session({ blockStorage: true, cookies: cookieOnly.cookies }).api.get().city, 'Salvador');
  const storageOnly = session({ blockCookies: true });
  assert.equal(storageOnly.api.set({ state: 'PE', city: 'Recife' }), true);
  assert.equal(session({ blockCookies: true, values: storageOnly.values }).api.get().city, 'Recife');
  const blocked = session({ blockStorage: true, blockCookies: true });
  assert.equal(blocked.api.set({ state: 'SP', city: 'São Paulo' }), false);
  assert.equal(blocked.api.get(), null);
});

test('a location changed in another tab updates all existing page labels', () => {
  const app = session();
  app.api.set({ state: 'SP', city: 'São Paulo' });
  app.values.set('delivery_location', JSON.stringify({ version: 1, state: 'RJ', city: 'Rio de Janeiro' }));
  app.window.dispatchEvent({ type: 'storage', key: 'delivery_location' });
  assert.equal(app.fields[0].textContent, 'Rio de Janeiro - RJ e região');
  assert.equal(app.fields[2].textContent, 'RJ');
  assert.equal(app.fields[3].textContent, 'Rio de Janeiro - RJ e região');
});

test('all application pages load the same selector and use location slots instead of duplicated city IDs', () => {
  const app = session();
  assert.equal(Object.keys(app.regions).length, 27);
  assert.ok(Object.values(app.regions).every(region => region.name && region.cities.length));
  for (const file of ['index.html', 'icon.html', 'produto.html']) {
    const html = fs.readFileSync(path.join(rootPath, file), 'utf8');
    for (const source of ['js/localizacao-data.js', 'js/localizacao.js', 'css/localizacao.css']) assert.ok(html.includes(source), file + ': ' + source);
    assert.ok(html.includes('data-location-city="region"'), file);
    assert.ok(html.includes('data-location-change'), file);
    assert.doesNotMatch(html, /id="localCidade"|loc_chooser_seen|function escolherLocalizacao|fetchLocation\(/);
  }
});
