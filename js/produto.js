(function () {
  'use strict';

  const catalog = window.PRODUCT_CATALOG;
  const template = window.PRODUCT_TEMPLATE;
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('slug') || 'kit-familia-3-marmitas-churrasco-g';
  const product = catalog && Object.prototype.hasOwnProperty.call(catalog, slug) ? catalog[slug] : null;
  if (product && window.MetaTracking) window.MetaTracking.track('ViewContent', {currency:'BRL', value:product.price, content_type:'product', content_ids:[product.name], content_name:product.name});
  const hasStaticDetails = product && ['side', 'simple', 'grill'].includes(product.kind);
  const groups = hasStaticDetails ? [] : template.groups;
  const byId = id => document.getElementById(id);
  const currency = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  let quantity = 1;
  const selections = Object.create(null);
  const selectedAddons = new Set();
  const variants = Object.create(null);

  function announce(message) {
    const status = byId('status-message');
    if (status) status.textContent = message;
  }

  function readStorage(storageName, key) {
    try { return window[storageName].getItem(key); } catch (_) { return null; }
  }

  function writeStorage(storageName, key, value) {
    try { window[storageName].setItem(key, value); return true; } catch (_) { return false; }
  }

  function destination(path, targetSlug) {
    const url = new URL(path, window.location.href);
    for (const [key, value] of params) {
      if (key !== 'slug' && key !== 'pedidos' && !/^_?fb/i.test(key)) url.searchParams.append(key, value);
    }
    if (targetSlug) url.searchParams.set('slug', targetSlug);
    return url.pathname + url.search + url.hash;
  }

  function wireNavigation() {
    const links = {
      'back-to-menu': destination('/'),
      'nav-home': destination('/'),
      'nav-orders': destination('/?pedidos=1'),
      'nav-checkout': destination('/carrinho.html'),
      'confirm-checkout': destination('/carrinho.html')
    };
    Object.entries(links).forEach(([id, href]) => {
      const element = byId(id);
      if (!element) return;
      if (element.tagName === 'A') element.href = href;
      else element.addEventListener('click', () => {
        const dialog = element.closest('dialog');
        if (dialog && dialog.open) dialog.close();
        window.location.href = href;
      });
    });
    const confirmContinue = byId('confirm-continue');
    if (confirmContinue) confirmContinue.addEventListener('click', () => {
      byId('confirm-dialog').close();
      window.location.href = destination('/');
    });
    document.querySelectorAll('[data-close-dialog]').forEach(button => {
      button.addEventListener('click', () => button.closest('dialog').close());
    });
    document.querySelectorAll('dialog').forEach(dialog => {
      dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    });
  }

  function renderOptions() {
    const root = byId('product-options');
    if (hasStaticDetails) {
      const section = document.createElement('section');
      section.className = 'choice-group product-details';
      const heading = document.createElement('h2');
      heading.className = 'section-label';
      heading.id = 'product-details-title';
      heading.textContent = 'Acompanhamentos';
      section.setAttribute('aria-labelledby', heading.id);
      section.appendChild(heading);
      const details = document.createElement('div');
      details.className = 'detail-list';
      const descriptions = product.kind === 'grill' ? template.grill.details : product.details || [];
      descriptions.forEach(text => {
        const tag = document.createElement('span');
        tag.className = 'detail-tag';
        tag.textContent = text;
        details.appendChild(tag);
      });
      section.appendChild(details);
      root.appendChild(section);
      return;
    }
    groups.forEach(group => {
      selections[group.id] = [];
      const section = document.createElement('section');
      section.className = 'choice-group' + (group.id === 'brinde' ? ' choice-group--gift' : '');
      section.dataset.group = group.id;
      const heading = document.createElement('h2');
      heading.className = 'section-label';
      heading.id = 'group-title-' + group.id;
      heading.textContent = group.label;
      section.setAttribute('aria-labelledby', heading.id);
      section.appendChild(heading);
      const choices = document.createElement('div');
      choices.className = 'choice-list';
      group.items.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'choice';
        button.dataset.group = group.id;
        button.dataset.value = item;
        button.setAttribute('aria-pressed', 'false');
        button.textContent = item;
        button.addEventListener('click', () => {
          const chosen = selections[group.id];
          const index = chosen.indexOf(item);
          if (index !== -1) chosen.splice(index, 1);
          else if (group.max === 1) selections[group.id] = [item];
          else if (chosen.length < group.max) chosen.push(item);
          else {
            announce('Você pode escolher no máximo ' + group.max + ' opções nesta categoria.');
            return;
          }
          choices.querySelectorAll('.choice').forEach(choice => {
            const on = selections[group.id].includes(choice.dataset.value);
            choice.classList.toggle('is-selected', on);
            choice.setAttribute('aria-pressed', String(on));
          });
          announce('');
        });
        choices.appendChild(button);
      });
      section.appendChild(choices);
      root.appendChild(section);
    });
  }

  function updateQuantity() {
    byId('quantity-value').textContent = String(quantity);
    byId('product-quantity-minus').disabled = quantity === 1;
    byId('product-quantity-minus').setAttribute('aria-disabled', String(quantity === 1));
  }

  function refreshAddon(id) {
    const card = document.querySelector('.addon-card[data-addon-id="' + id + '"]');
    if (!card) return;
    const selected = selectedAddons.has(id);
    card.classList.toggle('is-selected', selected);
    const toggle = card.querySelector('[data-addon-toggle]');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(selected));
      toggle.textContent = selected ? '✓' : '+';
      toggle.setAttribute('aria-label', (selected ? 'Retirar ' : 'Adicionar ') + template.addons[id].name);
    }
    card.querySelectorAll('[data-addon-variant]').forEach(button => {
      const picked = button.dataset.variant === variants[id];
      button.classList.toggle('is-picked', picked);
      button.setAttribute('aria-pressed', String(picked));
    });
  }

  function wireAddons() {
    Object.entries(template.addons).forEach(([id, addon]) => {
      variants[id] = addon.variants[0] || '';
      refreshAddon(id);
    });
    document.querySelectorAll('[data-addon-toggle]').forEach(button => {
      button.addEventListener('click', () => {
        const id = button.dataset.addonId || button.closest('[data-addon-id]').dataset.addonId;
        if (!template.addons[id]) return;
        if (selectedAddons.has(id)) selectedAddons.delete(id);
        else selectedAddons.add(id);
        refreshAddon(id);
      });
    });
    document.querySelectorAll('[data-addon-variant]').forEach(button => {
      button.addEventListener('click', () => {
        const id = button.dataset.addonId || button.closest('[data-addon-id]').dataset.addonId;
        const addon = template.addons[id];
        if (!addon || !addon.variants.includes(button.dataset.variant)) return;
        variants[id] = button.dataset.variant;
        selectedAddons.add(id);
        refreshAddon(id);
      });
    });
  }

  function readCart() {
    let raw;
    try { raw = localStorage.getItem('cart'); } catch (_) {
      throw new Error('Não foi possível acessar sua sacola. Verifique as permissões de armazenamento do navegador.');
    }
    if (!raw) return [];
    let cart;
    try { cart = JSON.parse(raw); } catch (_) {
      throw new Error('Não foi possível ler sua sacola. Seus itens foram preservados; volte ao cardápio para conferir.');
    }
    if (!Array.isArray(cart) || cart.some(item => !item || typeof item !== 'object' || !Number.isFinite(Number(item.total)) || Number(item.total) < 0)) {
      throw new Error('Não foi possível ler sua sacola. Seus itens foram preservados; volte ao cardápio para conferir.');
    }
    return cart;
  }

  function addToCart() {
    let cart;
    try { cart = readCart(); } catch (error) { announce(error.message); return; }
    const now = Date.now();
    const summaries = groups.map(group => {
      return selections[group.id].length ? group.summary + ': ' + selections[group.id].join(', ') : '';
    }).filter(Boolean);
    const observation = byId('observation').value.trim();
    if (observation) summaries.push(observation);
    const item = {
      id: now,
      name: product.name,
      image: new URL(product.image, window.location.href).href,
      price: product.price,
      quantity,
      options: Object.fromEntries(Object.entries(selections).map(([key, values]) => [key, values.slice()])),
      observation: summaries.join(' | '),
      total: Math.round(product.price * quantity * 100) / 100
    };
    const extras = Array.from(selectedAddons).map((id, index) => {
      const addon = template.addons[id];
      const card = document.querySelector('.addon-card[data-addon-id="' + id + '"]');
      const image = card && card.querySelector('img');
      return {
        id: now + index + 1,
        name: addon.name + (variants[id] ? ' ' + variants[id] : ''),
        image: (card && card.dataset.image) || (image ? image.src : ''),
        price: addon.price,
        quantity: 1,
        options: variants[id] ? { variant: variants[id] } : {},
        observation: 'Adicional',
        total: addon.price
      };
    });
    if (!writeStorage('localStorage', 'cart', JSON.stringify(cart.concat(item, extras)))) {
      announce('Não foi possível salvar sua sacola. Verifique as permissões de armazenamento e tente novamente.');
      return;
    }
    if (window.MetaTracking) window.MetaTracking.track('AddToCart', {currency:'BRL', value:item.total + extras.reduce((sum, extra) => sum + extra.total, 0), content_type:'product', content_ids:[item.name, ...extras.map(extra => extra.name)], num_items:quantity + extras.length});
    announce('Produto adicionado à sacola.');
    byId('confirm-dialog').showModal();
  }

  function updateCity() {
    if (window.DeliveryLocation) window.DeliveryLocation.refresh();
  }

  function startDeliveryEstimate() {
    const pairs = ['20–23', '20–24', '21–24', '21–25', '22–25', '20–25'];
    const cycle = 5 * 60 * 1000;
    let pair = readStorage('localStorage', 'delivery_eta_pair');
    let next = Number(readStorage('localStorage', 'delivery_eta_next_at'));
    function tick() {
      const now = Date.now();
      if (!pairs.includes(pair) || !next || next <= now || next - now > cycle) {
        const choices = pairs.filter(value => value !== pair);
        pair = choices[Math.floor(Math.random() * choices.length)];
        next = now + cycle;
        writeStorage('localStorage', 'delivery_eta_pair', pair);
        writeStorage('localStorage', 'delivery_eta_next_at', String(next));
      }
      byId('delivery-eta').textContent = pair;
      byId('prep-minutes').textContent = String(Math.max(12, parseInt(pair, 10) - 4));
    }
    tick();
    setInterval(tick, 15000);
  }

  function startCountdown() {
    const key = 'promo_urgency_ends_at_1h';
    const cycle = 60 * 60 * 1000;
    let end = Number(readStorage('localStorage', key));
    function tick() {
      const now = Date.now();
      if (!end || end <= now || end - now > cycle) {
        end = now + cycle;
        writeStorage('localStorage', key, String(end));
      }
      const seconds = Math.max(0, Math.ceil((end - now) / 1000));
      byId('promo-countdown').textContent = [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60]
        .map(value => String(value).padStart(2, '0')).join(':');
    }
    tick();
    setInterval(tick, 1000);
  }

  function renderSuggestion() {
    const suggestion = template.suggestion;
    const linkedProduct = catalog[suggestion.slug];
    const root = byId('product-suggestion');
    if (!root || !linkedProduct) return;
    const heading = byId('suggestion-title');
    if (heading) heading.textContent = suggestion.label;
    const link = root.querySelector('.suggestion-link');
    if (link) link.href = destination('produto.html', suggestion.slug);
    const image = root.querySelector('img');
    if (image) { image.src = linkedProduct.image; image.alt = linkedProduct.name; }
    const name = root.querySelector('[data-suggestion-name]');
    const price = root.querySelector('[data-suggestion-price]');
    const description = root.querySelector('[data-suggestion-description]');
    if (name) {
      name.textContent = suggestion.displayName || linkedProduct.name;
      name.title = linkedProduct.name;
    }
    if (price) price.textContent = currency(linkedProduct.price);
    if (description) description.textContent = suggestion.description;
  }

  function init() {
    wireNavigation();
    if (!product || !template) {
      document.body.classList.add('product-not-found');
      document.title = 'Produto não encontrado | Fogão da Vovó';
      byId('product-title').textContent = 'Produto não encontrado';
      byId('add-to-cart').disabled = true;
      const image = byId('product-image');
      image.hidden = true;
      announce('Este produto não está disponível. Volte ao cardápio para escolher outro item.');
      return;
    }
    document.title = product.name + ' | Fogão da Vovó';
    byId('product-title').textContent = product.name;
    byId('product-price').textContent = currency(product.price);
    byId('product-image').src = product.image;
    byId('product-image').alt = product.name;
    if (product.kind === 'side') {
      document.body.classList.add('side-product');
    }
    if (product.kind === 'grill') {
      document.body.classList.add('grill-product');
    }
    if (Number.isFinite(product.originalPrice) && product.originalPrice > product.price) {
      const originalPrice = byId('product-original-price');
      if (originalPrice) {
        originalPrice.textContent = currency(product.originalPrice);
        originalPrice.hidden = false;
      }
      const offer = byId('product-offer-label');
      const savings = (Math.round(product.originalPrice * 100) - Math.round(product.price * 100)) / 100;
      if (offer) offer.textContent = 'Economize ' + currency(savings);
    }
    const mappings = {
      '[data-product-servings]': product.servings ?? (product.kind === 'grill' ? template.grill.servings : template.servings),
      '[data-product-rating]': product.rating ?? template.rating,
      '[data-product-review]': product.review ?? template.review,
      '[data-product-reviewer]': product.reviewer ?? template.reviewer
    };
    Object.entries(mappings).forEach(([selector, text]) => {
      const element = document.querySelector(selector);
      if (element) element.textContent = text;
    });
    renderOptions();
    // Required on every product/category, including side dishes and future records.
    wireAddons();
    renderSuggestion();
    updateCity();
    startDeliveryEstimate();
    startCountdown();
    updateQuantity();
    byId('product-quantity-minus').addEventListener('click', () => { quantity = Math.max(1, quantity - 1); updateQuantity(); });
    byId('product-quantity-plus').addEventListener('click', () => { quantity += 1; updateQuantity(); });
    byId('add-to-cart').addEventListener('click', addToCart);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
