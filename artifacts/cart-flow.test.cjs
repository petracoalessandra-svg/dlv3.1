const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rootPath = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(rootPath, 'js/carrinho.js'), 'utf8');
const data = fs.readFileSync(path.join(rootPath, 'js/produto-data.js'), 'utf8');
const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.listeners = new Map();
    this.textContent = ''; this.className = ''; this.disabled = false; this.hidden = false; this.open = false;
  }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  click() { if (!this.disabled) this.listeners.get('click')?.({ target: this }); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [child, ...child.querySelectorAll('*')]).filter(child => {
      if (selector === '*') return true;
      if (selector.startsWith('.')) return child.className.split(/\s+/).includes(selector.slice(1));
      return child.tagName.toLowerCase() === selector.toLowerCase();
    });
  }
}

function page({ cart, query = '', values = new Map(), blocked = false, denyWrites = false } = {}) {
  if (cart !== undefined) values.set('cart', typeof cart === 'string' ? cart : JSON.stringify(cart));
  const ids = new Map();
  for (const id of ['cart-status', 'cart-items', 'cart-empty', 'cart-subtotal', 'cart-total', 'cart-limit-warning', 'cart-finalize', 'cart-back', 'cart-continue', 'checkout-ready-dialog', 'checkout-ready-close']) ids.set(id, new Element());
  const document = { readyState: 'complete', getElementById: id => ids.get(id), createElement: tag => new Element(tag) };
  const handlers = new Map();
  const events = [];
  const window = {
    location: { href: 'http://127.0.0.1:5500/carrinho.html' + query, search: query },
    localStorage: {
      getItem(key) { if (blocked) throw Error('Storage blocked'); return values.get(key) ?? null; },
      setItem(key, value) { if (blocked || denyWrites) throw Error('Storage blocked'); values.set(key, value); }
    },
    addEventListener(type, handler) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(handler); },
    dispatchEvent(event) { events.push(event); (handlers.get(event.type) || []).forEach(handler => handler(event)); return !event.defaultPrevented; }
  };
  class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; this.cancelable = options.cancelable; this.defaultPrevented = false; }
    preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  }
  const context = vm.createContext({ window, document, URL, URLSearchParams, Intl, CustomEvent });
  vm.runInContext(data, context); vm.runInContext(source, context);
  return { window, values, events, el: id => ids.get(id), rows: () => ids.get('cart-items').querySelectorAll('.cart-item'), remove: index => ids.get('cart-items').querySelectorAll('.cart-remove')[index].click(), cart: () => JSON.parse(values.get('cart') || '[]') };
}

const item = (name, price, quantity = 1, extra = {}) => ({ id: name, name, price, quantity, total: Math.round(price * quantity * 100) / 100, image: '', options: {}, observation: '', ...extra });

test('the review renders every product and upsell with quantity, choices and accurate totals', () => {
  const cart = [item('Marmita Artesanal Churrasco P', 18.9, 2, { observation: 'Proteínas: Costela Premium | Sem cebola' }), item('Coca-Cola 2L Zero', 9.9), item('Sobremesa da Casa', 8.9)];
  const app = page({ cart });
  assert.equal(app.rows().length, 3);
  assert.deepEqual(app.el('cart-items').querySelectorAll('h2').map(el => el.textContent), cart.map(el => el.name));
  assert.deepEqual(app.el('cart-items').querySelectorAll('.cart-item-price').map(el => el.textContent), [money(37.8), money(9.9), money(8.9)]);
  assert.equal(app.el('cart-items').querySelectorAll('.cart-item-quantity')[0].textContent, 'Quantidade: 2x');
  assert.equal(app.el('cart-items').querySelectorAll('.cart-item-details')[0].textContent, cart[0].observation);
  assert.equal(app.el('cart-items').querySelectorAll('.cart-sprite').length, 1);
  assert.equal(app.el('cart-items').querySelectorAll('img')[1].src,'https://ik.imagekit.io/njb6ql4jt/rs/10001707-removebg-preview%20(1).png');
  assert.equal(app.el('cart-subtotal').textContent, money(56.6));
  assert.equal(app.el('cart-total').textContent, money(56.6));
  assert.equal(app.el('cart-finalize').disabled, false);
});

test('removing one line preserves other items and options, recalculates totals, and persists across reload', () => {
  const cart = [item('Produto A', 10, 1, { id: 1, options: { proteina: ['Picanha Premium'] } }), item('Produto B', 5, 2, { id: 1 }), item('Produto C', 8)];
  const app = page({ cart });
  app.remove(1);
  assert.deepEqual(app.cart(), [cart[0], cart[2]]);
  assert.equal(app.el('cart-total').textContent, money(18));
  const reloaded = page({ values: app.values });
  assert.equal(reloaded.rows().length, 2);
  assert.equal(reloaded.el('cart-total').textContent, money(18));
  reloaded.remove(0); reloaded.remove(0);
  assert.deepEqual(reloaded.cart(), []);
  assert.equal(reloaded.el('cart-empty').hidden, false);
  assert.equal(reloaded.el('cart-total').textContent, money(0));
  assert.equal(reloaded.el('cart-finalize').disabled, true);
});

test('a concurrent cart change cannot cause the wrong line to be removed', () => {
  const first = item('Primeiro', 10), second = item('Segundo', 20);
  const app = page({ cart: [first, second] });
  app.values.set('cart', JSON.stringify([second]));
  app.remove(0);
  assert.deepEqual(app.cart(), [second]);
  assert.equal(app.rows().length, 1);
  assert.equal(app.el('cart-total').textContent, money(20));
});

test('empty, invalid and blocked carts never claim readiness or overwrite saved data', () => {
  const empty = page();
  assert.equal(empty.el('cart-empty').hidden, false);
  assert.equal(empty.el('cart-finalize').disabled, true);
  for (const raw of ['invalid JSON', '{}', '[null]', JSON.stringify([item('Inválido', 1, 0)]), JSON.stringify([item('Inválido', -1)]), JSON.stringify([item('Inválido', null)])]) {
    const app = page({ cart: raw });
    assert.equal(app.values.get('cart'), raw);
    assert.equal(app.el('cart-status').hidden, false);
    assert.equal(app.el('cart-finalize').disabled, true);
  }
  const blocked = page({ blocked: true });
  assert.match(blocked.el('cart-status').textContent, /acessar/);
  const saved = [item('Preservado', 10)];
  const writeBlocked = page({ cart: saved, denyWrites: true });
  writeBlocked.remove(0);
  assert.deepEqual(writeBlocked.cart(), saved);
  assert.equal(writeBlocked.rows().length, 1);
  assert.match(writeBlocked.el('cart-status').textContent, /remover/);
});

test('review supports totals above R$ 98 and updates after changes in another tab', () => {
  const app = page({ cart: [item('Limite', 49, 2)] });
  assert.equal(app.el('cart-finalize').disabled, false);
  app.values.set('cart', JSON.stringify([item('Acima do limite', 98.01)]));
  app.window.dispatchEvent({ type: 'storage', key: 'cart' });
  assert.equal(app.el('cart-finalize').disabled, false);
  app.el('cart-finalize').click();
  assert.equal(app.events.filter(event => event.type === 'checkout:requested').length, 1);
  app.values.set('cart', JSON.stringify([item('Dentro do limite', 22.99)]));
  app.window.dispatchEvent({ type: 'pageshow' });
  assert.equal(app.el('cart-finalize').disabled, false);
});

test('finalizing prepares the next step without submitting, charging or clearing the cart', () => {
  const saved = [item('Produto', 9.9, 2, { total: 9.9 })];
  const app = page({ cart: saved });
  assert.equal(app.el('cart-total').textContent, money(19.8));
  app.el('cart-finalize').click();
  const event = app.events.find(event => event.type === 'checkout:requested');
  assert.equal(event.detail.total, 19.8);
  assert.equal(event.detail.shipping, 0);
  assert.equal(event.detail.items[0].total, 19.8);
  assert.deepEqual(app.cart(), saved);
  assert.equal(app.el('checkout-ready-dialog').open, true);
  app.el('checkout-ready-close').click();
  assert.equal(app.el('checkout-ready-dialog').open, false);
  const integrated = page({ cart: saved });
  integrated.window.addEventListener('checkout:requested', event => event.preventDefault());
  integrated.el('cart-finalize').click();
  assert.equal(integrated.el('checkout-ready-dialog').open, false);
});

test('names and instructions render as text and unsafe image URLs are not loaded', () => {
  const app = page({ cart: [item('<img src=x onerror=alert(1)>', 10, 1, { image: 'javascript:alert(1)', observation: '<script>alert(1)</script>' })] });
  assert.equal(app.el('cart-items').querySelectorAll('h2')[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(app.el('cart-items').querySelectorAll('.cart-item-details')[0].textContent, '<script>alert(1)</script>');
  assert.equal(app.el('cart-items').querySelectorAll('img').length, 0);
});
test('ImageKit photos render in new and existing carts while foreign origins and namespaces remain blocked',()=>{
  const base='https://ik.imagekit.io/njb6ql4jt/rs/';
  const current='https://ik.imagekit.io/njb6ql4jt/New%20Folderv4/marmitex-pequena.jpg';
  const direct=page({cart:[item('Produto CDN',10,1,{image:base+'logo.png'})]});assert.equal(direct.el('cart-items').querySelectorAll('img')[0].src,base+'logo.png');
  const saved=[item('Marmita Artesanal Churrasco P',18.9,1,{image:'images/marmitex-pequena.jpg'})];
  const legacy=page({cart:saved});assert.equal(legacy.el('cart-items').querySelectorAll('img')[0].src,current);assert.deepEqual(legacy.cart(),saved);
  for(const oldImage of [base+'marmitex-pequena.jpg','']){
    const oldCart=page({cart:[item(saved[0].name,18.9,1,{image:oldImage})]});
    assert.equal(oldCart.el('cart-items').querySelectorAll('img')[0].src,current);
  }
  const catalog=legacy.window.PRODUCT_CATALOG;
  const allProducts=page({cart:Object.values(catalog).map(product=>item(product.name,product.price,1,{image:product.image}))});
  assert.deepEqual(allProducts.el('cart-items').querySelectorAll('img').map(image=>image.src),Object.values(catalog).map(product=>product.image));
  for(const image of ['https://example.com/photo.png','https://ik.imagekit.io/other-account/photo.png','https://ik.imagekit.io/njb6ql4jt/rs/../private.png','https://ik.imagekit.io/njb6ql4jt/New%20Folderv4/unlisted.jpg','https://user:password@ik.imagekit.io/njb6ql4jt/rs/logo.png']){
    const invalid=page({cart:[item('Produto desconhecido',10,1,{image})]});assert.equal(invalid.el('cart-items').querySelectorAll('img').length,0);
  }
});

test('Coca-Cola and Mini Pudim use current photos even in older saved carts',()=>{
  const saved=[
    item('Coca-Cola 2L Normal',9.9,1,{image:'old-bottle.png'}),
    item('Coca-Cola Lata Normal',6.9,1,{image:''}),
    item('Mini Pudim',5,1,{id:'checkout-mini-pudim',image:''})
  ];
  const app=page({cart:saved});
  const photos=app.el('cart-items').querySelectorAll('img');
  assert.deepEqual(photos.map(photo=>photo.src),[
    'https://ik.imagekit.io/njb6ql4jt/rs/10001707-removebg-preview%20(1).png',
    'https://ik.imagekit.io/njb6ql4jt/rs/10000392-removebg-preview.png',
    'https://ik.imagekit.io/njb6ql4jt/rs/mini-pudim-referencia.png'
  ]);
  assert.equal(photos[2].className,'cart-pudding-photo');
  assert.deepEqual(app.cart(),saved);
});

test('checkout links target the static review and navigation preserves campaign parameters only', () => {
  const app = page({ query: '?slug=produto&pedidos=1&utm_source=campaign&fbclid=discard' });
  assert.equal(app.el('cart-back').href, '/?utm_source=campaign');
  assert.equal(app.el('cart-continue').href, '/?utm_source=campaign');
  for (const file of ['index.html', 'icon.html', 'produto.html', 'js/produto.js']) {
    const content = fs.readFileSync(path.join(rootPath, file), 'utf8');
    assert.ok(content.includes('/carrinho.html'), file);
    assert.doesNotMatch(content, /\/carrinho\.php/);
  }
});
test('mini pudding is added once, persists, and works above R$ 98', () => {
  const app = page({cart:[item('Prato', 22.99)]});
  const original = app.window.CartReview.getCheckoutSnapshot();
  const updated = app.window.CartReview.addMiniPudding(original);
  assert.equal(updated.total, 27.99); assert.equal(app.cart()[1].name, 'Mini Pudim');
  assert.equal(app.cart()[1].image,'https://ik.imagekit.io/njb6ql4jt/rs/mini-pudim-referencia.png');
  assert.equal(app.el('cart-items').querySelectorAll('img')[0].className,'cart-pudding-photo');
  assert.equal(app.el('cart-total').textContent, money(27.99));
  assert.equal(app.window.CartReview.addMiniPudding(updated).items.length, 2);
  assert.throws(() => app.window.CartReview.addMiniPudding(original), /sacola mudou/);
  const limit = page({cart:[item('Prato', 93.01)]});
  assert.equal(limit.window.CartReview.addMiniPudding(limit.window.CartReview.getCheckoutSnapshot()).total, 98.01);
  assert.equal(limit.cart().length, 2);
  const blocked = page({cart:[item('Prato', 10)], denyWrites:true});
  assert.throws(() => blocked.window.CartReview.addMiniPudding(blocked.window.CartReview.getCheckoutSnapshot()), /armazenamento/);
  assert.equal(blocked.cart().length, 1);
});
