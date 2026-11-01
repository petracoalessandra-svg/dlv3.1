(function (root) {
  'use strict';
  const byId = id => document.getElementById(id);
  const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
  let displayedCart = [];

  function destination(path) {
    const url = new URL(path, root.location.href);
    new URLSearchParams(root.location.search).forEach((value, key) => {
      if (!['slug', 'pedidos'].includes(key) && !/^_?fb/i.test(key)) url.searchParams.append(key, value);
    });
    return url.pathname + url.search;
  }

  function readCart() {
    let raw;
    try { raw = root.localStorage.getItem('cart'); }
    catch (_) { throw Error('Não foi possível acessar sua sacola. Verifique as permissões de armazenamento do navegador.'); }
    let items;
    try { items = raw ? JSON.parse(raw) : []; }
    catch (_) { throw Error('Não foi possível carregar sua sacola. Recarregue a página ou volte ao cardápio. Seus itens foram preservados.'); }
    if (!Array.isArray(items)) throw Error('Não foi possível carregar sua sacola. Seus itens foram preservados.');
    items.forEach(item => {
      if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name.trim()
        || !['number', 'string'].includes(typeof item.price) || String(item.price).trim() === ''
        || !Number.isFinite(Number(item.price)) || Number(item.price) < 0
        || !['number', 'string'].includes(typeof item.quantity) || String(item.quantity).trim() === ''
        || !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) < 1
        || !Number.isSafeInteger(Math.round(Number(item.price) * 100) * Number(item.quantity))) {
        throw Error('Não foi possível carregar sua sacola. Seus itens foram preservados; volte ao cardápio para conferir.');
      }
    });
    return items;
  }

  function itemCents(item) { return Math.round(Number(item.price) * 100) * Number(item.quantity); }

  function subtotal(items) {
    const total = items.reduce((sum, item) => sum + itemCents(item), 0);
    if (!Number.isSafeInteger(total)) throw Error('Não foi possível calcular sua sacola. Volte ao cardápio para conferir os itens.');
    return total;
  }

  function error(message) {
    byId('cart-status').textContent = message;
    byId('cart-status').hidden = false;
    byId('cart-finalize').disabled = true;
  }

  function imageUrl(value) {
    if (!value || typeof value !== 'string') return '';
    try {
      const url = new URL(value, root.location.href);
      const local = url.origin === new URL(root.location.href).origin;
      const imagekit = url.origin === 'https://ik.imagekit.io' && url.pathname.startsWith('/njb6ql4jt/rs/');
      if (!/^https?:$/.test(url.protocol) || (!local && !imagekit) || url.username || url.password) return '';
      // Stored carts may still refer to a catalog image by its previous local URL.
      if (local && url.pathname.startsWith('/images/')) {
        const equivalent = Object.values(root.PRODUCT_CATALOG || {}).find(product => product.image === 'https://ik.imagekit.io/njb6ql4jt/rs/' + url.pathname.slice('/images/'.length));
        if (equivalent) return equivalent.image;
      }
      return url.href;
    } catch (_) { return ''; }
  }

  function photo(item) {
    const box = document.createElement('div');
    box.className = 'cart-item-photo';
    const fallbackProduct = Object.values(root.PRODUCT_CATALOG || {}).find(product => product.name === item.name);
    const url = imageUrl(item.image) || imageUrl(fallbackProduct && fallbackProduct.image);
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = item.name;
      img.width = 88;
      img.height = 88;
      img.addEventListener('error', () => { box.replaceChildren(fallbackPhoto(item)); }, { once: true });
      box.appendChild(img);
    } else box.appendChild(fallbackPhoto(item));
    return box;
  }

  function fallbackPhoto(item) {
    const sprite = /^Coca-Cola 2L(?: |$)/.test(item.name) ? 'coke-2l'
      : /^Coca-Cola Lata(?: |$)/.test(item.name) ? 'coke-can'
      : item.name === 'Sobremesa da Casa' ? 'dessert' : '';
    const element = document.createElement('span');
    element.className = sprite ? 'cart-sprite cart-sprite--' + sprite : 'fa-solid fa-bag-shopping';
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', item.name);
    return element;
  }

  function details(item) {
    if (typeof item.observation === 'string' && item.observation.trim() && item.observation !== 'Adicional') return item.observation;
    const labels = { proteina: 'Proteínas', acomp: 'Acompanhamentos', extra: 'Toque do chef', brinde: 'Brinde', recheio: 'Recheio' };
    if (!item.options || typeof item.options !== 'object') return '';
    return Object.entries(item.options).filter(([key]) => Object.hasOwn(labels, key)).map(([key, value]) => {
      const values = Array.isArray(value) ? value.filter(text => typeof text === 'string') : typeof value === 'string' ? [value] : [];
      return values.length ? labels[key] + ': ' + values.join(', ') : '';
    }).filter(Boolean).join(' | ');
  }

  function remove(index) {
    const target = displayedCart[index];
    if (!target) return;
    try {
      const current = readCart();
      const signature = JSON.stringify(target);
      const position = JSON.stringify(current[index]) === signature ? index : current.findIndex(item => JSON.stringify(item) === signature);
      if (position === -1) { render(); return; }
      current.splice(position, 1);
      try { root.localStorage.setItem('cart', JSON.stringify(current)); }
      catch (_) { throw Error('Não foi possível remover o item. Verifique as permissões de armazenamento e tente novamente.'); }
      render();
    } catch (failure) { error(failure.message); }
  }

  function renderItem(item, index) {
    const card = document.createElement('article');
    card.className = 'cart-item';
    card.appendChild(photo(item));
    const body = document.createElement('div');
    body.className = 'cart-item-body';
    const name = document.createElement('h2');
    name.textContent = item.name;
    body.appendChild(name);
    const quantity = document.createElement('p');
    quantity.className = 'cart-item-quantity';
    quantity.textContent = 'Quantidade: ' + Number(item.quantity) + 'x';
    body.appendChild(quantity);
    const price = document.createElement('p');
    price.className = 'cart-item-price';
    price.textContent = money(itemCents(item));
    body.appendChild(price);
    const description = details(item);
    if (description) {
      const text = document.createElement('p');
      text.className = 'cart-item-details';
      text.textContent = description;
      body.appendChild(text);
    }
    card.appendChild(body);
    const button = document.createElement('button');
    button.className = 'cart-remove';
    button.type = 'button';
    button.setAttribute('aria-label', 'Remover ' + item.name);
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-trash';
    icon.setAttribute('aria-hidden', 'true');
    button.appendChild(icon);
    button.addEventListener('click', () => remove(index));
    card.appendChild(button);
    return card;
  }

  function render() {
    byId('cart-status').hidden = true;
    try {
      const items = readCart();
      const total = subtotal(items);
      displayedCart = items;
      byId('cart-items').replaceChildren(...items.map(renderItem));
      byId('cart-empty').hidden = items.length > 0;
      byId('cart-subtotal').textContent = money(total);
      byId('cart-total').textContent = money(total);
      byId('cart-finalize').disabled = items.length === 0;
    } catch (failure) {
      byId('cart-empty').hidden = true;
      byId('cart-subtotal').textContent = '—';
      byId('cart-total').textContent = '—';
      error(failure.message);
    }
  }

  function getCheckoutSnapshot() {
    const items = readCart();
    const total = subtotal(items);
    if (!items.length) return null;
    return {
        items: items.map(item => ({ ...item, quantity: Number(item.quantity), price: Math.round(Number(item.price) * 100) / 100, total: itemCents(item) / 100 })),
        subtotal: total / 100, shipping: 0, total: total / 100
    };
  }

  function addMiniPudding(expected) {
    const current = getCheckoutSnapshot();
    if (!current || JSON.stringify(current) !== JSON.stringify(expected)) throw Error('Sua sacola mudou. Feche esta janela e confira os itens antes de continuar.');
    const items = readCart();
    if (items.some(item => item.id === 'checkout-mini-pudim')) return current;
    items.push({ id: 'checkout-mini-pudim', name: 'Mini Pudim', price: 5, quantity: 1, total: 5, image: '', options: {}, observation: 'Adicional' });
    try { root.localStorage.setItem('cart', JSON.stringify(items)); }
    catch (_) { throw Error('Não foi possível adicionar o pudim. Verifique o armazenamento e tente novamente.'); }
    render();
    return getCheckoutSnapshot();
  }

  root.CartReview = Object.freeze({ getCheckoutSnapshot, addMiniPudding });

  function finalize() {
    try {
      const snapshot = getCheckoutSnapshot();
      if (!snapshot) { render(); return; }
      const request = new CustomEvent('checkout:requested', { cancelable: true, detail: snapshot });
      if (root.dispatchEvent(request)) {
        const dialog = byId('checkout-ready-dialog');
        if (!dialog.open) dialog.showModal();
      }
    } catch (failure) { error(failure.message); }
  }

  function init() {
    byId('cart-back').href = destination('/');
    byId('cart-continue').href = destination('/');
    byId('cart-finalize').addEventListener('click', finalize);
    byId('checkout-ready-close').addEventListener('click', () => byId('checkout-ready-dialog').close());
    root.addEventListener('storage', event => { if (event.key === 'cart' || event.key === null) render(); });
    root.addEventListener('pageshow', render);
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
