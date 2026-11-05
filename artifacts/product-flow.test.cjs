/* Run with: node --test artifacts/product-flow.test.cjs
 * A deliberately small DOM adapter drives the production scripts through clicks.
 * There is no copy of the product/cart implementation in this test harness.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const dataSource = fs.readFileSync(path.join(projectRoot, 'js/produto-data.js'), 'utf8');
const appSource = fs.readFileSync(path.join(projectRoot, 'js/produto.js'), 'utf8');
// Legacy CDN assets retain local counterparts. New photos are hosted in ImageKit.
function imageFile(image) {
  const base='https://ik.imagekit.io/njb6ql4jt/rs/';
  return image.startsWith(base) ? path.join(projectRoot,'images',image.slice(base.length)) : path.join(projectRoot,image);
}
function assertImageReference(image) {
  const newPhotos = 'https://ik.imagekit.io/njb6ql4jt/New%20Folderv4/';
  if (image.startsWith(newPhotos)) {
    assert.match(image.slice(newPhotos.length), /^[a-z0-9-]+\.(?:jpe?g|webp)$/);
    return;
  }
  assert.ok(fs.existsSync(imageFile(image)), image);
}

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = {};
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.open = false;
    this.listeners = new Map();
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: name => { this.classList.toggle(name, true); },
      toggle: (name, force) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        const enabled = force === undefined ? !names.has(name) : force;
        if (enabled) names.add(name); else names.delete(name);
        this.className = [...names].join(' ');
        return enabled;
      }
    };
  }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
  }
  getAttribute(name) {
    if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] ?? null;
    return this.attributes[name] ?? null;
  }
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(callback);
  }
  click() {
    if (this.disabled) return;
    for (const callback of this.listeners.get('click') || []) callback({ target: this });
  }
  matches(selector) {
    const tag = selector.match(/^[a-z]+/i);
    if (tag && this.tagName !== tag[0].toUpperCase()) return false;
    for (const match of selector.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(match[1])) return false;
    for (const match of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      const value = this.getAttribute(match[1]);
      if (value === null || (match[2] !== undefined && value !== match[2])) return false;
    }
    return true;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [child, ...child.querySelectorAll('*')]).filter(child => child.matches(selector));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current;
    return null;
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

class Storage {
  constructor(values = new Map(), { blocked = false, denyWriteKeys = [] } = {}) {
    this.values = values;
    this.blocked = blocked;
    this.denyWriteKeys = denyWriteKeys;
  }
  getItem(key) {
    if (this.blocked) throw new Error('Storage unavailable');
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    if (this.blocked || this.denyWriteKeys.includes(key)) throw new Error('Storage unavailable');
    this.values.set(key, String(value));
  }
}

function createDocument() {
  const body = new Element('body');
  const ids = new Map();
  function add(id, tag = 'div', parent = body) {
    const element = parent.appendChild(new Element(tag));
    element.id = id;
    ids.set(id, element);
    return element;
  }
  for (const id of ['product-title', 'product-price', 'product-original-price', 'product-offer-label', 'quantity-value', 'delivery-city', 'delivery-eta', 'prep-minutes', 'promo-countdown', 'status-message']) add(id);
  ids.get('product-original-price').hidden = true;
  ids.get('product-offer-label').textContent = 'Oferta do dia';
  add('product-image', 'img');
  add('observation', 'textarea');
  add('product-options');
  for (const id of ['product-quantity-minus', 'product-quantity-plus', 'add-to-cart']) add(id, 'button');
  for (const id of ['back-to-menu', 'nav-home', 'nav-orders', 'nav-checkout']) add(id, 'a');
  const confirmation = add('confirm-dialog', 'dialog');
  add('confirm-continue', 'button', confirmation);
  add('confirm-checkout', 'button', confirmation);
  const limit = add('cart-limit-dialog', 'dialog');
  const close = add('close-limit', 'button', limit);
  close.setAttribute('data-close-dialog', '');
  for (const name of ['servings', 'rating', 'review', 'reviewer']) add('template-' + name).setAttribute('data-product-' + name, '');
  const addons = add('product-addons');
  for (const id of ['coke-2l', 'coke-can', 'dessert']) {
    const card = add('addon-' + id, 'article', addons);
    card.className = 'addon-card';
    card.dataset.addonId = id;
    const toggle = add('toggle-' + id, 'button', card);
    toggle.setAttribute('data-addon-toggle', '');
    toggle.dataset.addonId = id;
  }
  const suggestion = add('product-suggestion');
  add('suggestion-title', 'h2', suggestion);
  const link = add('suggestion-link', 'a', suggestion);
  link.className = 'suggestion-link';
  add('suggestion-image', 'img', link);
  for (const name of ['name', 'price', 'description']) add('suggestion-' + name, 'span', link).setAttribute('data-suggestion-' + name, '');
  return {
    body,
    readyState: 'complete',
    title: 'Kit Família',
    cookie: '',
    createElement: tag => new Element(tag),
    getElementById: id => ids.get(id) || null,
    querySelector: selector => body.querySelector(selector),
    querySelectorAll: selector => body.querySelectorAll(selector)
  };
}

function page({ query = '?slug=kit-familia-3-marmitas-churrasco-g', cart, values = new Map(), blocked = false, denyWriteKeys = [], now = 1800000000000, cookie = '', session = {}, catalogExtra = {}, locationService } = {}) {
  const document = createDocument();
  document.cookie = cookie;
  if (cart !== undefined) values.set('cart', typeof cart === 'string' ? cart : JSON.stringify(cart));
  const localStorage = new Storage(values, { blocked, denyWriteKeys });
  const sessionStorage = new Storage(new Map(Object.entries(session)));
  const timers = [];
  let currentTime = now;
  class Clock extends Date { static now() { return currentTime; } }
  const window = {
    location: { href: 'http://127.0.0.1:5500/produto.html' + query, search: query },
    localStorage, sessionStorage,
    addEventListener() {}
  };
  if (locationService) window.DeliveryLocation = locationService;
  const context = vm.createContext({ window, document, localStorage, sessionStorage, URL, URLSearchParams, Intl, Date: Clock, console, setInterval: fn => { timers.push(fn); return timers.length; } });
  vm.runInContext(dataSource, context, { filename: 'produto-data.js' });
  context.window.PRODUCT_CATALOG = Object.freeze({ ...context.window.PRODUCT_CATALOG, ...catalogExtra });
  vm.runInContext(appSource, context, { filename: 'produto.js' });
  return {
    document, values,
    el: id => document.getElementById(id),
    click: id => document.getElementById(id).click(),
    choices: group => document.querySelectorAll('.choice').filter(button => button.dataset.group === group),
    selected: group => document.querySelectorAll('.choice').filter(button => button.dataset.group === group && button.getAttribute('aria-pressed') === 'true'),
    savedCart: () => JSON.parse(values.get('cart') || '[]'),
    tick: elapsed => { currentTime += elapsed; timers.forEach(fn => fn()); }
  };
}

test('production choice handlers enforce maxima and let optional choices be cleared', () => {
  const app = page();
  const proteins = app.choices('proteina');
  proteins[0].click(); proteins[1].click(); proteins[2].click();
  assert.equal(app.selected('proteina').length, 2);
  assert.match(app.el('status-message').textContent, /máximo 2/);
  proteins[0].click(); proteins[2].click();
  assert.deepEqual(app.selected('proteina').map(choice => choice.textContent), ['Fraldinha Especial', 'Cupim Assado Especial']);
  const sides = app.choices('acomp');
  sides.slice(0, 4).forEach(choice => choice.click());
  assert.equal(app.selected('acomp').length, 3);
  for (const group of ['extra', 'brinde']) {
    app.choices(group)[0].click();
    assert.equal(app.selected(group).length, 1);
    app.choices(group)[0].click();
    assert.equal(app.selected(group).length, 0);
    app.choices(group)[0].click(); app.choices(group)[1].click();
    assert.equal(app.selected(group).length, 1);
    assert.equal(app.selected(group)[0].textContent, app.choices(group)[1].textContent);
  }
});

test('quantity never falls below one and cart records preserve structured choices and notes', () => {
  const app = page({ query: '?slug=marmita-artesanal-churrasco-g' });
  app.click('product-quantity-minus');
  assert.equal(app.el('quantity-value').textContent, '1');
  assert.equal(app.el('product-quantity-minus').disabled, true);
  app.click('product-quantity-plus'); app.click('product-quantity-minus'); app.click('product-quantity-minus');
  assert.equal(app.el('quantity-value').textContent, '1');
  app.click('product-quantity-plus');
  app.choices('proteina')[1].click();
  app.choices('acomp')[0].click();
  app.choices('extra')[1].click();
  app.choices('brinde')[2].click();
  app.el('observation').value = 'Sem cebola';
  app.click('add-to-cart');
  const [item] = app.savedCart();
  assert.equal(item.name, 'Marmita Artesanal Churrasco G');
  assert.equal(item.quantity, 2);
  assert.equal(item.total, 47.8);
  assert.equal(item.price, 23.9);
  assert.deepEqual(item.options, { proteina: ['Fraldinha Especial'], acomp: ['Arroz Branco'], extra: ['Molho Barbecue'], brinde: ['Pudim Mini'] });
  assert.equal(item.observation, 'Proteínas: Fraldinha Especial | Acompanhamentos: Arroz Branco | Toque do chef: Molho Barbecue | Brinde 1º pedido: Pudim Mini | Sem cebola');
  assert.equal(app.el('confirm-dialog').open, true);
});

test('add-ons use their default variant and remain quantity one', () => {
  const app = page({ query: '?slug=marmita-artesanal-churrasco-g' });
  app.click('product-quantity-plus');
  app.click('toggle-coke-2l');
  app.click('toggle-coke-can');
  app.click('toggle-dessert');
  app.click('add-to-cart');
  const cart = app.savedCart();
  assert.equal(cart.length, 4);
  assert.equal(cart[0].quantity, 2);
  assert.deepEqual(cart.slice(1).map(item => [item.name, item.quantity, item.total]), [
    ['Coca-Cola 2L Normal', 1, 9.9], ['Coca-Cola Lata Normal', 1, 6.9], ['Sobremesa da Casa', 1, 8.9]
  ]);
  assert.deepEqual(cart[1].options, { variant: 'Normal' });
  assert.equal(new Set(cart.map(item => item.id)).size, 4);
  const withoutAddon = page();
  withoutAddon.click('toggle-coke-2l'); withoutAddon.click('toggle-coke-2l');
  withoutAddon.click('add-to-cart');
  assert.equal(withoutAddon.savedCart().length, 1);
});

test('cart accepts orders over R$ 98 including add-ons', () => {
  const existing = { id: 1, name: 'Existente', image: '', price: 48.1, quantity: 1, options: {}, observation: '', total: 48.1 };
  const boundary = page({ cart: [existing] });
  boundary.click('add-to-cart');
  assert.equal(boundary.savedCart().length, 2);
  assert.equal(boundary.el('confirm-dialog').open, true);
  const over = page({ cart: [{ ...existing, total: 48.11 }] });
  over.click('add-to-cart');
  assert.equal(over.savedCart().length, 2);
  assert.equal(over.el('confirm-dialog').open, true);
  const extra = page({ cart: [existing] });
  extra.click('toggle-coke-2l'); extra.click('add-to-cart');
  assert.equal(extra.savedCart().length, 3);
  assert.equal(extra.el('confirm-dialog').open, true);
});

test('invalid carts and inaccessible storage preserve data without claiming success', () => {
  for (const raw of ['invalid JSON', '{}', '[null]', '[{"total":-1}]']) {
    const app = page({ cart: raw });
    app.click('add-to-cart');
    assert.equal(app.values.get('cart'), raw);
    assert.equal(app.el('confirm-dialog').open, false);
    assert.match(app.el('status-message').textContent, /Não foi possível ler/);
  }
  const blocked = page({ blocked: true });
  blocked.click('add-to-cart');
  assert.equal(blocked.el('confirm-dialog').open, false);
  assert.match(blocked.el('status-message').textContent, /Não foi possível acessar/);
  const readOnly = page({ cart: [], denyWriteKeys: ['cart'] });
  readOnly.click('add-to-cart');
  assert.deepEqual(readOnly.savedCart(), []);
  assert.equal(readOnly.el('confirm-dialog').open, false);
  assert.match(readOnly.el('status-message').textContent, /Não foi possível salvar/);
});

test('offer countdown persists its deadline across reloads; ETA reuses active cached estimate', () => {
  const now = 1800000000000;
  const values = new Map([
    ['delivery_eta_pair', '21–25'], ['delivery_eta_next_at', String(now + 300000)]
  ]);
  const first = page({ now, values });
  const deadline = values.get('promo_urgency_ends_at_1h');
  assert.equal(first.el('promo-countdown').textContent, '01:00:00');
  assert.equal(first.el('delivery-eta').textContent, '21–25');
  assert.equal(first.el('prep-minutes').textContent, '17');
  first.tick(180000);
  assert.equal(first.el('promo-countdown').textContent, '00:57:00');
  const reloaded = page({ now: now + 180000, values });
  assert.equal(values.get('promo_urgency_ends_at_1h'), deadline);
  assert.equal(reloaded.el('promo-countdown').textContent, '00:57:00');
  assert.equal(reloaded.el('delivery-eta').textContent, '21–25');
});

test('unknown slugs disable purchase and keep a useful return path', () => {
  const app = page({ query: '?slug=missing&pedidos=1&utm_source=campaign' });
  assert.equal(app.document.body.classList.contains('product-not-found'), true);
  assert.equal(app.el('add-to-cart').disabled, true);
  assert.equal(app.el('product-image').hidden, true);
  assert.equal(app.document.title, 'Produto não encontrado | Fogão da Vovó');
  assert.equal(app.el('back-to-menu').href, '/?utm_source=campaign');
  app.click('add-to-cart');
  assert.equal(app.el('confirm-dialog').open, false);
  assert.equal(app.values.has('cart'), false);
});

test('navigation preserves campaign parameters without leaking product/order state', () => {
  const app = page({ query: '?slug=kit-familia-3-marmitas-churrasco-g&pedidos=1&utm_source=campaign&fbclid=discard' });
  assert.equal(app.el('nav-home').href, '/?utm_source=campaign');
  assert.equal(app.el('nav-orders').href, '/?pedidos=1&utm_source=campaign');
  assert.equal(app.el('nav-checkout').href, '/carrinho.html?utm_source=campaign');
  assert.equal(app.el('suggestion-link').href, '/produto.html?utm_source=campaign&slug=kit-familia-3-marmitas-churrasco-g');
});

test('product localization delegates to the shared service instead of reading a separate IP cache', () => {
  let refreshes = 0;
  page({ locationService: { refresh() { refreshes++; } }, session: { ipGeo: JSON.stringify({ city: 'Cidade por IP' }) } });
  assert.equal(refreshes, 1);
  assert.doesNotMatch(appSource, /getItem\(['"]ipGeo/);
});

test('all individual meals open from both catalogs with matching prices, photos and their configured reviews', () => {
  const data = { window: {} };
  vm.runInNewContext(dataSource, data);
  const individualSlugs = new Set();
  for (const file of ['index.html', 'icon.html']) {
    const html = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    const category = html.slice(html.indexOf('<!-- Marmitas Individuais'), html.indexOf('<span>🧄 Acompanhamentos</span>'));
    const links = Array.from(category.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g));
    assert.ok(links.length >= 8);
    for (const [, href, card] of links) {
      assert.match(href, /^produto\.html\?slug=/);
      const slug = new URL(href, 'http://localhost/').searchParams.get('slug');
      individualSlugs.add(slug);
      const product = data.window.PRODUCT_CATALOG[slug];
      assert.ok(product, slug);
      assert.equal(product.name, card.match(/<h3>(.*?)<\/h3>/)[1]);
      assert.equal(product.price, Number(card.match(/<span class="preco">R\$\s*([\d,]+)<\/span>/)[1].replace(',', '.')));
      assert.equal(product.image, card.match(/<img\b[^>]*src="([^"]+)"/)[1]);
      assertImageReference(product.image);
      assert.ok(product.rating && product.review && product.reviewer);
      const app = page({ query: '?slug=' + slug });
      assert.equal(app.el('product-title').textContent, product.name);
      assert.equal(app.el('product-image').src, product.image);
      assert.equal(app.el('template-rating').textContent, product.rating);
      assert.equal(app.el('template-review').textContent, product.review);
      assert.equal(app.el('template-reviewer').textContent, product.reviewer);
      assert.equal(app.choices('proteina').length, 5);
      assert.equal(app.choices('acomp').length, 6);
      app.click('add-to-cart');
      assert.equal(app.savedCart()[0].total, product.price);
      assert.equal(app.savedCart()[0].name, product.name);
    }
  }
  assert.ok(individualSlugs.size >= 8);
  const kit = page();
  assert.equal(kit.el('template-reviewer').textContent, 'Fernanda M. · pedido verificado');
  assert.equal(kit.el('template-rating').textContent, '4,9 · 36 hoje');
});

test('side dishes show reference descriptions without customization and save only quantity and observation', () => {
  const sides = [
    { slug: 'queijo-coalho-no-espeto', name: 'Queijo Coalho no Espeto', price: 12.9, original: 18.9, saving: 6, rating: '4,8 · 21 hoje', reviewer: 'Paula R.', details: ['3 espetos na brasa', 'orégano e toque de limão'] },
    { slug: 'pao-de-alho-na-brasa', name: 'Pão de Alho Caseiro', price: 9.9, original: 14.9, saving: 5, rating: '4,8 · 20 hoje', reviewer: 'Igor M.', details: ['Porção caseira com 3 fatias', 'alho e manteiga'] }
  ];
  const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  for (const side of sides) {
    const app = page({ query: '?slug=' + side.slug });
    assert.equal(app.document.body.classList.contains('side-product'), true);
    assert.equal(app.document.querySelectorAll('.choice').length, 0);
    assert.deepEqual(app.document.querySelectorAll('.detail-tag').map(tag => tag.textContent), side.details);
    assert.ok(app.document.querySelectorAll('.detail-tag').every(tag => tag.tagName === 'SPAN' && tag.listeners.size === 0));
    assert.notEqual(app.el('product-addons').hidden, true);
    assert.equal(app.el('template-servings').textContent, 'Serve 1–2 pessoas');
    assert.equal(app.el('template-rating').textContent, side.rating);
    assert.equal(app.el('template-reviewer').textContent, side.reviewer + ' · pedido verificado');
    assert.equal(app.el('product-original-price').textContent, money(side.original));
    assert.equal(app.el('product-offer-label').textContent, 'Economize ' + money(side.saving));
    assertImageReference(app.el('product-image').src);
    app.click('product-quantity-plus');
    app.el('observation').value = 'Bem quentinho';
    app.click('add-to-cart');
    const cart = app.savedCart();
    assert.equal(cart.length, 1);
    assert.equal(cart[0].name, side.name);
    assert.equal(cart[0].total, side.price * 2);
    assert.deepEqual(cart[0].options, {});
    assert.equal(cart[0].observation, 'Bem quentinho');
    assert.equal(app.el('confirm-dialog').open, true);
    for (const file of ['index.html', 'icon.html']) assert.ok(fs.readFileSync(path.join(projectRoot, file), 'utf8').includes('href="produto.html?slug=' + side.slug + '"'));
  }
});

test('every current product and a future category receive the same functional upsells and family kit recommendation', () => {
  const data = { window: {} };
  vm.runInNewContext(dataSource, data);
  const future = { 'future-product': { name: 'Produto futuro', price: 10, image: 'images/grande.webp', kind: 'future-category' } };
  const records = { ...data.window.PRODUCT_CATALOG, ...future };
  assert.ok(Object.keys(data.window.PRODUCT_CATALOG).length >= 19);
  for (const [slug, product] of Object.entries(records)) {
    const app = page({ query: '?slug=' + slug, catalogExtra: future });
    assert.notEqual(app.el('product-addons').hidden, true, slug);
    assert.equal(app.el('suggestion-title').textContent, 'Vale mais a pena dividir', slug);
    assert.equal(app.el('suggestion-name').textContent, 'Kit Família 3\nMarmitas...', slug);
    assert.equal(app.el('suggestion-name').title, 'Kit Família 3 Marmitas Churrasco G', slug);
    assert.equal(app.el('suggestion-image').src, 'https://ik.imagekit.io/njb6ql4jt/New%20Folderv4/familia.webp', slug);
    assert.equal(app.el('suggestion-price').textContent, 'R$\u00a049,90', slug);
    assert.equal(app.el('suggestion-link').href, '/produto.html?slug=kit-familia-3-marmitas-churrasco-g', slug);
    app.click('toggle-coke-2l');
    app.click('toggle-coke-can');
    app.click('toggle-dessert');
    app.click('add-to-cart');
    const cart = app.savedCart();
    assert.equal(cart.length, 4, slug);
    assert.equal(cart[0].price, product.price, slug);
    assert.deepEqual(cart.slice(1).map(item => [item.name, item.quantity, item.total]), [
      ['Coca-Cola 2L Normal', 1, 9.9], ['Coca-Cola Lata Normal', 1, 6.9], ['Sobremesa da Casa', 1, 8.9]
    ], slug);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(projectRoot, 'produto.html'), 'utf8'), /data-addon-variant|addon-variants/);
  for (const file of ['index.html', 'icon.html']) {
    const html = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    const links = Array.from(html.matchAll(/<a\b[^>]*href="(produto\.html\?slug=[^"]+)"/g));
    assert.equal(links.length, Object.keys(data.window.PRODUCT_CATALOG).length);
    assert.doesNotMatch(html, /href="\/produto\//);
    for (const [, href] of links) assert.ok(data.window.PRODUCT_CATALOG[new URL(href, 'http://localhost/').searchParams.get('slug')]);
  }
});

test('all grill products use the reference static accompaniments, individual reviews and catalog prices', () => {
  const data = { window: {} };
  vm.runInNewContext(dataSource, data);
  for (const file of ['index.html', 'icon.html']) {
    const html = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    const category = html.slice(html.indexOf('<div id="carnes-produtos">'), html.indexOf('</div><!-- /carnes-produtos -->'));
    const links = Array.from(category.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g));
    assert.ok(links.length >= 8);
    for (const [, href, card] of links) {
      const slug = new URL(href, 'http://localhost/').searchParams.get('slug');
      const product = data.window.PRODUCT_CATALOG[slug];
      assert.equal(product.kind, 'grill', slug);
      assert.equal(product.name, card.match(/<h3>(.*?)<\/h3>/)[1]);
      const currentPrice = card.match(/<span class="preco"[^>]*>([\s\S]*?)<\/span>/)[1];
      assert.equal(product.price, Number(currentPrice.match(/R\$\s*([\d,]+)/)[1].replace(',', '.')));
      assert.equal(product.image, card.match(/<img\b[^>]*src="([^"]+)"/)[1]);
      assertImageReference(product.image);
      assert.ok(product.rating && product.review && product.reviewer);
      const app = page({ query: '?slug=' + slug });
      assert.ok(app.document.body.classList.contains('grill-product'));
      assert.equal(app.document.querySelectorAll('.choice').length, 0);
      const tags = app.document.querySelectorAll('.detail-tag');
      assert.deepEqual(tags.map(tag => tag.textContent), ['Arroz', 'Maionese', 'Purê de Batata', 'Molho Especial e Farofa']);
      assert.ok(tags.every(tag => tag.tagName === 'SPAN' && tag.listeners.size === 0));
      assert.equal(app.el('template-servings').textContent, 'Serve 1 pessoa');
      assert.equal(app.el('template-review').textContent, product.review);
      assert.equal(app.el('template-reviewer').textContent, product.reviewer);
      assert.equal(app.el('template-rating').textContent, product.rating);
      app.el('observation').value = 'Molho à parte';
      app.click('add-to-cart');
      const [item] = app.savedCart();
      assert.equal(item.name, product.name);
      assert.equal(item.total, product.price);
      assert.deepEqual(item.options, {});
      assert.equal(item.observation, 'Molho à parte');
    }
  }
  const costelinha = page({ query: '?slug=costelinha-de-porco-premium-400g' });
  assert.equal(costelinha.el('template-rating').textContent, '4,8 · 22 hoje');
  assert.equal(costelinha.el('template-reviewer').textContent, 'Eduarda S. · pedido verificado');
  assert.equal(costelinha.el('template-review').textContent, '“Costelinha no ponto, molho especial\nboa. Pedido rápido.”');
});

test('every product displays its previous price and accurate savings consistently with both home catalogs', () => {
  const data = { window: {} };
  vm.runInNewContext(dataSource, data);
  const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  for (const [slug, product] of Object.entries(data.window.PRODUCT_CATALOG)) {
    assert.ok(Number.isFinite(product.originalPrice) && product.originalPrice > product.price, slug);
    const saving = (Math.round(product.originalPrice * 100) - Math.round(product.price * 100)) / 100;
    const app = page({ query: '?slug=' + slug });
    assert.equal(app.el('product-original-price').hidden, false, slug);
    assert.equal(app.el('product-original-price').textContent, money(product.originalPrice), slug);
    assert.equal(app.el('product-price').textContent, money(product.price), slug);
    assert.equal(app.el('product-offer-label').textContent, 'Economize ' + money(saving), slug);
  }
  for (const file of ['index.html', 'icon.html']) {
    const html = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    for (const [, slug, card] of html.matchAll(/<a\b[^>]*href="produto\.html\?slug=([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const product = data.window.PRODUCT_CATALOG[slug];
      const original = card.match(/<span class="precoPromocao"[^>]*>R\$\s*([\d,]+)<\/span>/);
      const discount = card.match(/Economize R\$\s*([\d,]+)/);
      assert.ok(original && discount, slug);
      assert.equal(Number(original[1].replace(',', '.')), product.originalPrice, slug);
      const expectedCents = Math.round(product.originalPrice * 100) - Math.round(product.price * 100);
      assert.equal(Math.round(Number(discount[1].replace(',', '.')) * 100), expectedCents, slug);
    }
  }
  for (const [slug, price, original] of [
    ['kit-familia-3-marmitas-churrasco-g', 49.90, 62.38],
    ['frango-assado-especial', 48.99, 61.24],
    ['costela-premium-1kg', 64.99, 81.24]
  ]) {
    assert.equal(data.window.PRODUCT_CATALOG[slug].price, price);
    assert.equal(data.window.PRODUCT_CATALOG[slug].originalPrice, original);
    assert.equal(Math.round(Math.round(price * 100) * 5 / 4) / 100, original);
  }
});
