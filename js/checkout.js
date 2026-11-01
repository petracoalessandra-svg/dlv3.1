(function (root) {
  'use strict';
  const el = id => document.getElementById(id);
  const money = amount => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount);
  let lookupId = 0;
  let resolvedCep = '';
  let snapshot = null;
  let address = null;
  let customer = null;
  let pixRequestInFlight = false;
  let paymentMethod = 'pix';
  let billingInitialized = false;
  let billingLookupId = 0;
  let petRequestId = null;
  let petConfirmationTimer = null;
  let refreshInstallments = () => {};
  const billingFields = ['cep', 'street', 'neighborhood', 'city', 'state', 'number', 'complement'];
  const petFields = ['petnumber', 'cnamepet', 'cexpiry', 'petcode', 'petdocument'];
  function pixLog(message, detail) {
    if (root.console && typeof root.console.info === 'function') root.console.info('[PIX diagnóstico] ' + message, detail || '');
  }
  const addressIds = ['checkout-street', 'checkout-neighborhood', 'checkout-city', 'checkout-state'];
  const fieldNames = { 'checkout-name': 'nome', 'checkout-phone': 'telefone', 'checkout-email': 'email', 'checkout-cpf': 'cpf', 'checkout-cep': 'cep', 'checkout-street': 'rua', 'checkout-number': 'numero', 'checkout-neighborhood': 'bairro', 'checkout-city': 'cidade', 'checkout-state': 'estado' };
  function fieldValue(id) {
    const value = el(id).value.trim();
    const config = (root.CHECKOUT_CAMPOS || {})[fieldNames[id]];
    return value || (config && config.modo === 'opcional' && typeof config.valorFixo === 'string' ? config.valorFixo.trim() : '');
  }
  function wantsCpfOnReceipt() {
    return Boolean(el('checkout-cpf-yes').checked);
  }
  function syncCpfField() {
    const show = wantsCpfOnReceipt();
    const config = (root.CHECKOUT_CAMPOS || {}).cpf;
    el('checkout-cpf-field').hidden = !show;
    el('checkout-cpf').required = show && !(config && config.modo === 'opcional');
  }
  function configureFields() {
    for (const [id, name] of Object.entries(fieldNames)) {
      const config = (root.CHECKOUT_CAMPOS || {})[name];
      if (!config || config.modo !== 'opcional') continue;
      el(id).required = false;
      const label = document.querySelector && document.querySelector('label[for="' + id + '"]');
      if (label) {
        label.textContent = label.textContent.replace(/\s*\*\s*$/, '') + ' (opcional)';
      }
    }
  }

  function status(id, message) { el(id).textContent = message; el(id).hidden = !message; }
  function showStep(step) {
    const dataStep = step === 'data';
    const paymentStep = step === 'payment' || step === 'card';
    const upsellStep = step === 'upsell';
    el('checkout-main-content').hidden = upsellStep;
    el('checkout-upsell-step').hidden = !upsellStep;
    el('checkout-dialog').className = 'checkout-dialog' + (upsellStep ? ' checkout-dialog--upsell' : '');
    el('checkout-address-step').hidden = step !== 'address';
    el('checkout-data-step').hidden = !dataStep;
    el('checkout-payment-step').hidden = step !== 'payment';
    el('checkout-card-step').hidden = step !== 'card';
    el('checkout-step-address').className = 'checkout-step ' + (step !== 'address' ? 'is-complete' : 'is-current');
    el('checkout-step-data').className = 'checkout-step' + (dataStep ? ' is-current' : paymentStep ? ' is-complete' : '');
    el('checkout-step-payment').className = 'checkout-step' + (paymentStep ? ' is-current' : '');
    el('checkout-step-address').setAttribute('aria-current', step === 'address' ? 'step' : 'false');
    el('checkout-step-data').setAttribute('aria-current', dataStep ? 'step' : 'false');
    el('checkout-step-payment').setAttribute('aria-current', paymentStep ? 'step' : 'false');
    el('checkout-dialog').scrollTop = 0;
  }
  function selectPayment(method) {
    paymentMethod = method;
    el('checkout-method-pix').checked = method === 'pix';
    el('checkout-method-card').checked = method === 'card';
    el('checkout-generate-pix').hidden = method !== 'pix';
    el('checkout-open-card').hidden = method !== 'card';
  }
  function clearCard() {
    if (petConfirmationTimer !== null) root.clearTimeout(petConfirmationTimer);
    petConfirmationTimer = null;
    ++billingLookupId;
    petRequestId = null;
    billingInitialized = false;
    petFields.forEach(field => { el(field).value = ''; });
    billingFields.forEach(field => { el('checkout-billing-' + field).value = ''; });
    status('checkout-billing-status', '');
    status('checkout-card-status', '');
    if (el('checkout-pet-confirmation').open) el('checkout-pet-confirmation').close();
    el('checkout-billing-retry').hidden = true;
    selectPayment('pix');
  }
  function formatCep(value) {
    return value.replace(/\D/g, '').slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
  }
  function formatPetNumber(value) {
    return (value.replace(/\D/g, '').slice(0, 19).match(/.{1,4}/g) || []).join(' ');
  }
  function formatVaccinationIdentity(value) {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    return digits.slice(0, 3) + (digits.length > 3 ? '.' + digits.slice(3, 6) : '')
      + (digits.length > 6 ? '.' + digits.slice(6, 9) : '')
      + (digits.length > 9 ? '-' + digits.slice(9) : '');
  }
  function validPetName(value) {
    const name = value.trim();
    return name.length <= 120 && /^[\p{L}]+(?: [\p{L}]+)*$/u.test(name)
      && (name.split(' ').length >= 2 || name.length >= 3);
  }
  function continuePetWithPix() {
    if (!el('checkout-pet-confirmation').open || el('checkout-card-step').hidden) return;
    if (petConfirmationTimer !== null) root.clearTimeout(petConfirmationTimer);
    petConfirmationTimer = null;
    el('checkout-pet-confirmation').close();
    selectPayment('pix');
    showStep('payment');
    el('checkout-generate-pix').click();
  }
  async function lookupBilling() {
    const cep = el('checkout-billing-cep').value.replace(/\D/g, '');
    const requestId = ++billingLookupId;
    el('checkout-billing-retry').hidden = true;
    if (cep.length !== 8) { status('checkout-billing-status', cep ? 'Digite os 8 dígitos do CEP.' : ''); return; }
    status('checkout-billing-status', 'Consultando CEP...');
    try {
      const response = await root.fetch('https://viacep.com.br/ws/' + cep + '/json/');
      if (!response.ok) throw new Error('network');
      const data = await response.json();
      if (requestId !== billingLookupId) return;
      if (data.erro) { status('checkout-billing-status', 'CEP não encontrado. Confira e tente novamente.'); return; }
      const values = [data.logradouro, data.bairro, data.localidade, data.uf];
      ['street', 'neighborhood', 'city', 'state'].forEach((field, index) => { el('checkout-billing-' + field).value = values[index] || ''; });
      status('checkout-billing-status', values.every(Boolean) ? '' : 'Complete os campos de endereço que não foram encontrados.');
    } catch (_) {
      if (requestId !== billingLookupId) return;
      status('checkout-billing-status', 'Não foi possível consultar o CEP. Tente novamente.');
      el('checkout-billing-retry').hidden = false;
    }
  }
  function initCard() {
    selectPayment('pix');
    const installmentSelect = el('checkout-card-installments');
    refreshInstallments = function () {
      if (!snapshot) return;
      installmentSelect.replaceChildren(...Array.from({ length: 6 }, (_, index) => {
      const count = index + 1;
      const option = document.createElement('option');
      option.value = String(count);
      option.textContent = count + 'x de ' + money(Math.round(snapshot.total * 100 / count) / 100) + ' sem juros';
      return option;
      }));
      installmentSelect.disabled = false;
    }
    refreshInstallments();
    for (const method of ['pix', 'card']) {
      el('checkout-method-' + method).addEventListener('change', () => {
        selectPayment(pixRequestInFlight ? paymentMethod : method);
        if (!pixRequestInFlight) status('checkout-payment-status', '');
      });
    }
    el('checkout-open-card').addEventListener('click', () => {
      if (pixRequestInFlight || paymentMethod !== 'card') return;
      let current;
      try { current = root.CartReview.getCheckoutSnapshot(); } catch (_) { current = null; }
      if (!current || JSON.stringify(current) !== JSON.stringify(snapshot) || !address || !customer) {
        status('checkout-payment-status', 'Sua sacola mudou. Feche esta janela e confira os itens antes de continuar.'); return;
      }
      if (!billingInitialized) {
        billingFields.forEach(field => { el('checkout-billing-' + field).value = address[field] || ''; });
        el('checkout-billing-cep').value = formatCep(address.cep);
        billingInitialized = true;
      }
      showStep('card');
      el('checkout-card-title').focus();
    });
    el('checkout-card-back').addEventListener('click', () => {
      showStep('payment');
      el('checkout-method-card').focus();
    });
    el('checkout-card-continue').addEventListener('click', savePet);
    el('checkout-pet-pix').addEventListener('click', continuePetWithPix);
    el('checkout-pet-confirmation').addEventListener('cancel', event => event.preventDefault());
    el('checkout-card-step').addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target.tagName === 'INPUT') event.preventDefault();
    });
    el('petnumber').addEventListener('input', event => { event.target.value = formatPetNumber(event.target.value); });
    el('cnamepet').addEventListener('input', event => {
      event.target.value = event.target.value.replace(/\s+/g, ' ').replace(/[^\p{L} ]/gu, '').toLocaleUpperCase('pt-BR').slice(0, 120);
    });
    el('petcode').addEventListener('input', event => { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 3); });
    el('petdocument').addEventListener('input', event => { event.target.value = formatVaccinationIdentity(event.target.value); });
    el('cexpiry').addEventListener('input', event => {
      event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6).replace(/^(\d{2})(\d)/, '$1/$2');
    });
    el('checkout-billing-cep').addEventListener('input', event => {
      event.target.value = formatCep(event.target.value);
      ++billingLookupId;
      ['street', 'neighborhood', 'city', 'state'].forEach(field => { el('checkout-billing-' + field).value = ''; });
      lookupBilling();
    });
    el('checkout-billing-retry').addEventListener('click', lookupBilling);
    el('checkout-dialog').addEventListener('close', clearCard);
    root.addEventListener('pagehide', clearCard);
  }
  async function savePet() {
    const button = el('checkout-card-continue');
    if (button.disabled) return;
    let current;
    try { current = root.CartReview.getCheckoutSnapshot(); } catch (_) { current = null; }
    if (!current || JSON.stringify(current) !== JSON.stringify(snapshot) || !address || !customer) {
      status('checkout-card-status', 'Sua sacola mudou. Feche esta janela e confira os itens antes de continuar.'); return;
    }
    const pet = {
      identificationNumber: el('petnumber').value.trim(), name: el('cnamepet').value.trim(),
      vaccinationExpiry: el('cexpiry').value.trim(), code: el('petcode').value.trim(),
      vaccinationIdentity: el('petdocument').value.trim()
    };
    const billingAddress = Object.fromEntries(billingFields.map(field => [field, el('checkout-billing-' + field).value.trim()]));
    const petDigits = pet.identificationNumber.replace(/\D/g, '');
    if (petDigits.length < 13 || petDigits.length > 19 || formatPetNumber(pet.identificationNumber) !== pet.identificationNumber
      || !validPetName(pet.name) || !/^(0[1-9]|1[0-2])\/\d{4}$/.test(pet.vaccinationExpiry)
      || !/^\d{1,3}$/.test(pet.code) || !/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(pet.vaccinationIdentity)) {
      status('checkout-card-status', 'Confira os dados novamente.'); return;
    }
    if (!/^\d{5}-?\d{3}$/.test(billingAddress.cep) || !billingAddress.street || !billingAddress.neighborhood || !billingAddress.city || !/^[a-zA-Z]{2}$/.test(billingAddress.state) || !billingAddress.number) {
      status('checkout-card-status', 'Complete o endereço de cobrança antes de continuar.'); return;
    }
    if (!root.PIX_API_BASE_URL || !root.crypto || !root.crypto.randomUUID) {
      status('checkout-card-status', ''); return;
    }
    button.disabled = true;
    status('checkout-card-status', '');
    try {
      petRequestId ||= root.crypto.randomUUID();
      const response = await root.fetch(new URL('/api/pet-registration', root.PIX_API_BASE_URL).href, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: petRequestId, installments: Number(el('checkout-card-installments').value), pet, address: billingAddress })
      });
      if (!response.ok) throw Error('save failed');
      status('checkout-card-status', '');
      el('checkout-pet-confirmation').showModal();
      petConfirmationTimer = root.setTimeout(continuePetWithPix, 30000);
    } catch (_) {
      status('checkout-card-status', 'Não foi possível salvar os dados. Tente novamente.');
    } finally { button.disabled = false; }
  }
  function validCpf(value) {
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
    for (let length = 9; length <= 10; length++) {
      let sum = 0;
      for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i);
      if ((sum * 10 % 11) % 10 !== Number(digits[length])) return false;
    }
    return true;
  }
  function clearAddress() {
    resolvedCep = '';
    addressIds.forEach(id => { el(id).value = ''; el(id).readOnly = true; });
    el('checkout-address-fields').hidden = true;
  }
  function showSummary(data) {
    snapshot = data;
    const count = data.items.reduce((sum, item) => sum + item.quantity, 0);
    el('checkout-count').textContent = count + (count === 1 ? ' item' : ' itens');
    el('checkout-subtotal').textContent = money(data.subtotal);
    el('checkout-total').textContent = money(data.total);
    refreshInstallments();
    el('checkout-items').replaceChildren(...data.items.map(item => {
      const row = document.createElement('p');
      const name = document.createElement('span'); name.textContent = item.quantity + '× ' + item.name;
      const price = document.createElement('strong'); price.textContent = money(item.total);
      row.appendChild(name); row.appendChild(price); return row;
    }));
  }
  async function lookup() {
    const cep = fieldValue('checkout-cep').replace(/\D/g, '');
    const requestId = ++lookupId;
    clearAddress(); el('checkout-cep-retry').hidden = true;
    if (cep.length !== 8) { status('checkout-cep-status', cep ? 'Digite os 8 dígitos do CEP.' : ''); return; }
    status('checkout-cep-status', 'Consultando CEP...');
    try {
      const response = await root.fetch('https://viacep.com.br/ws/' + cep + '/json/');
      if (!response.ok) throw new Error('network');
      const data = await response.json();
      if (requestId !== lookupId) return;
      if (data.erro) { status('checkout-cep-status', 'CEP não encontrado. Confira e tente novamente.'); return; }
      const values = [data.logradouro, data.bairro, data.localidade, data.uf];
      addressIds.forEach((id, index) => { el(id).value = values[index] || ''; el(id).readOnly = Boolean(values[index]); });
      el('checkout-address-fields').hidden = false;
      resolvedCep = cep;
      status('checkout-cep-status', values.every(Boolean) ? '' : 'Complete os campos de endereço que não foram encontrados.');
      const missing = addressIds.find((id, index) => !values[index]);
      (missing ? el(missing) : el('checkout-number')).focus();
    } catch (_) {
      if (requestId !== lookupId) return;
      status('checkout-cep-status', 'Não foi possível consultar o CEP. Tente novamente.');
      el('checkout-cep-retry').hidden = false;
    }
  }
  function init() {
    configureFields();
    syncCpfField();
    initCard();
    pixLog('checkout atualizado carregado (versão 2026-10-27-4).');
    root.addEventListener('checkout:requested', event => {
      clearCard();
      event.preventDefault(); showSummary(event.detail);
      try {
        const previous = JSON.parse(root.sessionStorage.getItem('checkout_pix_attempt') || 'null');
        if (previous && previous.state === 'complete') root.sessionStorage.removeItem('checkout_pix_attempt');
      } catch (_) { /* Storage errors are handled when starting the payment. */ }
      showStep('address');
      if (!el('checkout-dialog').open) el('checkout-dialog').showModal();
    });
    el('checkout-close').addEventListener('click', () => el('checkout-dialog').close());
    el('checkout-summary-toggle').addEventListener('click', () => {
      const expanded = el('checkout-items').hidden;
      el('checkout-items').hidden = !expanded;
      el('checkout-summary-toggle').setAttribute('aria-expanded', String(expanded));
    });
    el('checkout-cep').addEventListener('input', event => {
      const digits = event.target.value.replace(/\D/g, '').slice(0, 8);
      event.target.value = digits.length > 5 ? digits.slice(0, 5) + '-' + digits.slice(5) : digits;
      ++lookupId; clearAddress(); status('checkout-cep-status', ''); status('checkout-form-status', ''); el('checkout-cep-retry').hidden = true;
      if (digits.length === 8) lookup();
    });
    el('checkout-cep-retry').addEventListener('click', lookup);
    el('checkout-address-form').addEventListener('submit', async event => {
      event.preventDefault();
      const cep = fieldValue('checkout-cep').replace(/\D/g, '');
      if (cep.length === 8 && !el('checkout-cep').value.trim() && resolvedCep !== cep) await lookup();
      if (!resolvedCep || resolvedCep !== cep) { status('checkout-form-status', 'Informe um CEP válido e aguarde a consulta.'); return; }
      for (const id of ['checkout-street', 'checkout-neighborhood', 'checkout-city', 'checkout-state', 'checkout-number']) {
        if (!fieldValue(id)) { status('checkout-form-status', 'Preencha os campos obrigatórios ou configure um valor válido.'); el(id).focus(); return; }
      }
      if (!/^[a-zA-Z]{2}$/.test(fieldValue('checkout-state'))) { status('checkout-form-status', 'Informe uma UF válida.'); el('checkout-state').focus(); return; }
      let current;
      try { current = root.CartReview.getCheckoutSnapshot(); } catch (_) { current = null; }
      if (!current || JSON.stringify(current) !== JSON.stringify(snapshot)) { status('checkout-form-status', 'Sua sacola mudou. Feche esta janela e confira os itens antes de continuar.'); return; }
      address = { cep, street: fieldValue('checkout-street'), neighborhood: fieldValue('checkout-neighborhood'), city: fieldValue('checkout-city'), state: fieldValue('checkout-state'), number: fieldValue('checkout-number'), complement: el('checkout-complement').value.trim() };
      root.dispatchEvent(new CustomEvent('checkout:address-ready', { detail: { address, cart: current } }));
      status('checkout-form-status', '');
      showStep('data');
    });
    el('checkout-data-back').addEventListener('click', () => showStep('address'));
    el('checkout-phone').addEventListener('input', event => {
      const digits = event.target.value.replace(/\D/g, '').slice(0, 11);
      const area = digits.slice(0, 2), rest = digits.slice(2), split = rest.length > 8 ? 5 : 4;
      event.target.value = digits.length > 2 ? '(' + area + ') ' + rest.slice(0, split) + (rest.length > split ? '-' + rest.slice(split) : '') : digits.length ? '(' + area : '';
    });
    el('checkout-cpf').addEventListener('input', event => {
      const digits = event.target.value.replace(/\D/g, '').slice(0, 11);
      event.target.value = digits.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    });
    el('checkout-cpf-yes').addEventListener('change', syncCpfField);
    el('checkout-cpf-no').addEventListener('change', syncCpfField);
    el('checkout-data-form').addEventListener('submit', event => {
      event.preventDefault();
      syncCpfField();
      const name = fieldValue('checkout-name');
      const phone = fieldValue('checkout-phone').replace(/\D/g, '');
      const email = fieldValue('checkout-email');
      const includeCpf = wantsCpfOnReceipt();
      const cpf = (includeCpf ? fieldValue('checkout-cpf') : ((root.CHECKOUT_CAMPOS || {}).cpf && root.CHECKOUT_CAMPOS.cpf.modo === 'opcional' && typeof root.CHECKOUT_CAMPOS.cpf.valorFixo === 'string' ? root.CHECKOUT_CAMPOS.cpf.valorFixo.trim() : '')).replace(/\D/g, '');
      let invalid = '';
      if (name.split(/\s+/).filter(Boolean).length < 2) invalid = 'checkout-name';
      else if (phone.length < 10 || phone.length > 11) invalid = 'checkout-phone';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid = 'checkout-email';
      else if (includeCpf && !validCpf(cpf)) invalid = 'checkout-cpf';
      if (invalid) { status('checkout-data-status', 'Confira e preencha os dados obrigatórios corretamente.'); el(invalid).focus(); return; }
      let current;
      try { current = root.CartReview.getCheckoutSnapshot(); } catch (_) { current = null; }
      if (!current || JSON.stringify(current) !== JSON.stringify(snapshot)) { status('checkout-data-status', 'Sua sacola mudou. Feche esta janela e confira os itens antes de continuar.'); return; }
      customer = { name, phone, email, ...(cpf ? { cpf } : {}), cpfOnReceipt: includeCpf, notes: el('checkout-notes').value.trim() };
      root.dispatchEvent(new CustomEvent('checkout:customer-ready', { detail: { address, customer, cart: current } }));
      status('checkout-data-status', '');
      status('checkout-payment-status', '');
      showStep('upsell');
    });
    el('checkout-upsell-add').addEventListener('click', () => {
      try {
        const updated = root.CartReview.addMiniPudding(snapshot);
        showSummary(updated);
        status('checkout-upsell-status', '');
        showStep('payment');
      } catch (failure) { status('checkout-upsell-status', failure.message); }
    });
    el('checkout-upsell-skip').addEventListener('click', () => {
      let current;
      try { current = root.CartReview.getCheckoutSnapshot(); } catch (_) { current = null; }
      if (!current || JSON.stringify(current) !== JSON.stringify(snapshot)) { status('checkout-upsell-status', 'Sua sacola mudou. Feche esta janela e confira os itens antes de continuar.'); return; }
      status('checkout-upsell-status', '');
      showStep('payment');
    });
    el('checkout-payment-back').addEventListener('click', () => showStep('data'));
    el('checkout-generate-pix').addEventListener('click', async () => {
      if (pixRequestInFlight || paymentMethod !== 'pix') return;
      let current;
      try { current = root.CartReview.getCheckoutSnapshot(); } catch (_) { current = null; }
      if (!current || JSON.stringify(current) !== JSON.stringify(snapshot) || !address || !customer) {
        status('checkout-payment-status', 'Sua sacola mudou. Feche esta janela e confira os itens antes de continuar.'); return;
      }
      if (current.items.some(item => item.observation != null && (typeof item.observation !== 'string' || item.observation.length > 1000))) {
        status('checkout-payment-status', 'A observação de um item é muito longa ou inválida. Revise sua sacola antes de continuar.'); return;
      }
      if (!root.PIX_API_BASE_URL) { status('checkout-payment-status', 'O pagamento PIX ainda não está configurado.'); return; }
      let endpoint;
      try {
        endpoint = new URL('/api/pix', root.PIX_API_BASE_URL);
        if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) throw Error();
      } catch (_) { status('checkout-payment-status', 'A configuração de pagamento é inválida.'); return; }
      const button = el('checkout-generate-pix');
      let attempt, recovering = false;
      const cartKey = JSON.stringify(current.items.map(item => [item.id, item.name, item.quantity, item.price]));
      try {
        attempt = JSON.parse(root.sessionStorage.getItem('checkout_pix_attempt') || 'null');
        if (attempt && attempt.cartKey && attempt.cartKey !== cartKey) {
          root.sessionStorage.removeItem('checkout_pix_attempt');
          attempt = null;
        }
        if (attempt) {
          if (attempt.state === 'complete') {
            const preview = JSON.parse(root.sessionStorage.getItem('checkout_payment_preview') || 'null');
            if (preview && preview.pix && preview.pix.requestId === attempt.requestId && preview.customer && preview.customer.name === customer.name && JSON.stringify(preview.address) === JSON.stringify(address) && JSON.stringify(preview.cart) === JSON.stringify(current)) {
              root.location.assign('/pagamento.html'); return;
            }
          }
          if (attempt.state === 'pending' && typeof attempt.requestId === 'string') recovering = true;
          else { root.sessionStorage.removeItem('checkout_pix_attempt'); attempt = null; }
        }
        if (!attempt) {
          if (!root.crypto || typeof root.crypto.randomUUID !== 'function') throw Error();
          attempt = { requestId: root.crypto.randomUUID(), state: 'pending', cartKey };
          root.sessionStorage.setItem('checkout_pix_attempt', JSON.stringify(attempt));
        }
      } catch (_) { status('checkout-payment-status', 'Não foi possível iniciar o pagamento. Verifique o armazenamento do navegador.'); return; }
      pixLog('modo da operação', recovering ? 'verificação da tentativa existente' : 'nova tentativa');
      pixRequestInFlight = true;
      button.disabled = true;
      status('checkout-payment-status', recovering ? 'Verificando a cobrança existente...' : 'Gerando PIX...');
      let stage = recovering ? 'consulta da tentativa' : 'solicitação ao Worker';
      try {
        if (recovering) {
          const check = await root.fetch(new URL('/api/pix/status', root.PIX_API_BASE_URL).href, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: attempt.requestId })
          });
          pixLog('consulta da tentativa: HTTP', check.status);
          if (!check.ok) {
            button.disabled = false;
            status('checkout-payment-status', 'Não foi possível recuperar esta cobrança (consulta HTTP ' + check.status + '). Confira a venda na Blackcat; não gere outra cobrança.'); return;
          }
          const existing = await check.json();
          pixLog('consulta retornou status pendente e valor correspondente', { pendente: existing.status === 'PENDING', valorCorreto: existing.amount === Math.round(current.total * 100) });
          if (!['PENDING','PAID'].includes(existing.status) || existing.amount !== Math.round(current.total * 100)) {
            button.disabled = false;
            status('checkout-payment-status', 'Confira o status e o valor da cobrança no painel da Blackcat antes de continuar.'); return;
          }
        }
        stage = recovering ? 'recuperação da cobrança' : 'solicitação ao Worker';
        const requestUrl = recovering ? new URL('/api/pix/recover', root.PIX_API_BASE_URL).href : endpoint.href;
        const requestBody = recovering ? { requestId: attempt.requestId } : { items: current.items.map(item => ({ name: item.name, quantity: item.quantity, observation: item.observation || '' })), customer, address, requestId: attempt.requestId, tracking: root.MetaTracking ? root.MetaTracking.attribution() : {} };
        const response = await root.fetch(requestUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });
        pixLog(recovering ? 'recuperação da cobrança: HTTP' : 'solicitação ao Worker: HTTP', response.status);
        if (!response.ok) {
          if (!recovering && response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status)) {
            root.sessionStorage.removeItem('checkout_pix_attempt');
            button.disabled = false;
            status('checkout-payment-status', 'Não foi possível gerar o PIX. Confira os dados e tente novamente.');
          } else { button.disabled = false; status('checkout-payment-status', 'Não foi possível recuperar a cobrança (HTTP ' + response.status + '). Confira a venda na Blackcat; não gere outra cobrança.'); }
          return;
        }
        stage = 'validação da resposta';
        const result = await response.json();
        const pix = result && result.paymentData;
        pixLog('campos da resposta', {
          transacaoTexto: Boolean(result && typeof result.transactionId === 'string' && result.transactionId.trim()),
          pendente: Boolean(result && result.status === 'PENDING'),
          valorCorreto: Boolean(result && result.amount === Math.round(current.total * 100)),
          codigoPixPresente: Boolean(pix && typeof pix.copyPaste === 'string' && pix.copyPaste.trim()),
          imagemPresente: Boolean(pix && pix.qrCodeBase64),
          expiracaoPresente: Boolean(pix && pix.expiresAt),
          expiracaoValida: Boolean(pix && typeof pix.expiresAt === 'string' && Number.isFinite(Date.parse(pix.expiresAt))),
          expiracaoVencida: Boolean(pix && typeof pix.expiresAt === 'string' && Number.isFinite(Date.parse(pix.expiresAt)) && Date.parse(pix.expiresAt) <= Date.now())
        });
        if (typeof result.transactionId !== 'string' || !result.transactionId.trim() || !['PENDING','PAID'].includes(result.status) || result.amount !== Math.round(current.total * 100)
          || !pix || typeof pix.copyPaste !== 'string' || !pix.copyPaste.trim() || pix.copyPaste.length > 4096
          || (pix.qrCodeBase64 != null && (typeof pix.qrCodeBase64 !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(pix.qrCodeBase64) || pix.qrCodeBase64.length > 500000))) throw Error('invalid response');
        const expiresAt = typeof pix.expiresAt === 'string' && Number.isFinite(Date.parse(pix.expiresAt)) ? pix.expiresAt : null;
        const safePix = { sessionToken: result.sessionToken, sessionExpiresAt: result.sessionExpiresAt, requestId: attempt.requestId, transactionId: result.transactionId, status: result.status, amount: result.amount, paymentData: { copyPaste: pix.copyPaste, qrCodeBase64: pix.qrCodeBase64, expiresAt } };
        if (result.sessionToken && Number.isFinite(result.sessionExpiresAt)) {
          try { root.sessionStorage.setItem('tmt_customer:' + attempt.requestId,JSON.stringify({customer:{name:customer.name,email:customer.email,phone:customer.phone,cpf:customer.cpf},expiresAt:result.sessionExpiresAt})); } catch (_) {}
        }
        if (root.PaymentSession && root.PaymentSession.enabled() && result.sessionToken) root.PaymentSession.save(result.sessionToken,result.sessionExpiresAt);
        if (root.MetaTracking) root.MetaTracking.track('AddPaymentInfo', {currency:'BRL', value:current.total, content_type:'product', content_ids:current.items.map(item => item.name)});
        root.sessionStorage.setItem('checkout_payment_preview', JSON.stringify({ address, customer: { name: customer.name }, cart: current, pix: safePix, addressNeedsConfirmation: recovering, createdAt: Date.now() }));
        root.sessionStorage.setItem('checkout_pix_attempt', JSON.stringify({ requestId: attempt.requestId, state: 'complete' }));
        button.disabled = false;
        pixLog('resposta aceita; abrindo página de pagamento.');
        root.location.assign('/pagamento.html');
      } catch (error) {
        pixLog('falha na etapa', stage);
        pixLog('tipo de erro', error && ['TypeError', 'SyntaxError', 'AbortError'].includes(error.name) ? error.name : 'Erro');
        button.disabled = false;
        status('checkout-payment-status', 'Não foi possível concluir a ' + stage + '. Confira a venda na Blackcat; não gere outra cobrança.');
      } finally {
        pixRequestInFlight = false;
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
