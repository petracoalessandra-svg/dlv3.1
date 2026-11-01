(function (root) {
  'use strict';
  const el = id => document.getElementById(id);
  const money = amount => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount);
  function setupPix(pix, cents, createdAt) {
    if (!pix || !['PENDING','PAID'].includes(pix.status) || pix.amount !== cents || !pix.paymentData) return;
    const payment = pix.paymentData;
    const code = typeof payment.copyPaste === 'string' ? payment.copyPaste.trim() : '';
    if (!code || code.length > 8192) return;
    el('payment-status').textContent = 'Aguardando pagamento';
    el('pix-code').textContent = code;
    const image = payment.qrCodeBase64;
    if (typeof image === 'string' && /^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(image) && image.length <= 500000) {
      el('pix-qr').src = image;
      el('pix-qr').hidden = false;
      el('qr-placeholder').hidden = true;
    } else {
      try {
        if (typeof root.qrcode !== 'function') throw Error('QR indisponível');
        const qr = root.qrcode(0, 'M');
        qr.addData(code, 'Byte'); qr.make();
        el('pix-qr').src = qr.createDataURL(5, 20);
        el('pix-qr').hidden = false; el('qr-placeholder').hidden = true;
      } catch (_) {
        el('qr-placeholder').textContent = 'QR Code indisponível. Use o código PIX abaixo para pagar.';
      }
    }
    const buttons = [el('pix-copy'), el('pix-copy-footer')];
    buttons.forEach(button => {
      button.disabled = false;
      button.addEventListener('click', async () => {
        try { await root.navigator.clipboard.writeText(code); el('pix-copy-status').textContent = 'Código PIX copiado.'; }
        catch (_) { el('pix-copy-status').textContent = 'Não foi possível copiar automaticamente. Selecione o código acima para copiar.'; }
        el('pix-copy-status').hidden = false;
      });
    });
    let finished = false;
    const expiration = Date.parse(payment.expiresAt);
    const start = Number.isFinite(createdAt) && createdAt <= Date.now() ? createdAt : Date.now();
    const update = () => {
      const remaining = Math.max(0, Math.ceil((start + 300000 - Date.now()) / 1000));
      const minutes = Math.floor(remaining / 60), seconds = remaining % 60;
      el('pix-expiration').textContent = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
      el('pix-expiration').hidden = finished;
      if (Number.isFinite(expiration) && expiration <= Date.now() && !finished) { el('payment-status').textContent = 'PIX expirado'; buttons.forEach(button => { button.disabled = true; }); }
    };
    update(); root.setInterval(update, 1000);
    if (root.PaymentSession && root.PaymentSession.enabled() && pix.sessionToken) {
      const session = root.PaymentSession.save(pix.sessionToken,pix.sessionExpiresAt);
      if (session) {
        try { const link=new URL(root.location.href); for (const key of Array.from(link.searchParams.keys())) if (!['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].includes(key)) link.searchParams.delete(key); link.hash=new URLSearchParams({token:session.token}).toString(); root.history.replaceState(null,'',link.href); } catch (_) {}
      }
      if (session) root.PaymentSession.start(session,{amount:cents,onTerminal:status=>{ finished=true; el('payment-status').textContent=status === 'REFUNDED' ? 'Pagamento estornado' : 'PIX cancelado'; buttons.forEach(button=>{button.disabled=true;}); },onExpired:()=>{el('payment-status').textContent='Link expirado. Entre em contato com a loja.';}});
      return;
    }
    if (root.PIX_API_BASE_URL && typeof pix.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pix.requestId)) {
      let endpoint;
      try {
        endpoint = new URL('/api/pix/status', root.PIX_API_BASE_URL);
        if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) return;
      } catch (_) { return; }
      let checking = false;
      const check = async () => {
        if (checking || finished || document.hidden) return;
        checking = true;
        try {
          const response = await root.fetch(endpoint.href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: pix.requestId }) });
          if (!response.ok) return;
          const result = await response.json();
          if (result.amount !== cents) return;
          if (result.status === 'PAID') {
            if (root.MetaTracking) root.MetaTracking.track('Purchase', {currency:'BRL', value:cents / 100}, pix.requestId);
            finished = true; el('payment-status').textContent = 'Pagamento confirmado';
            el('delivery-dialog-status-text').textContent = 'Pagamento confirmado · rastreio indisponível';
            el('delivery-event-first').textContent = 'Pagamento confirmado';
            el('delivery-event-second').textContent = 'Rastreamento em tempo real ainda não disponível';
            el('pix-expiration').hidden = true;
            buttons.forEach(button => { button.disabled = true; });
          } else if (result.status === 'CANCELLED' || result.status === 'REFUNDED') {
            finished = true; el('payment-status').textContent = result.status === 'REFUNDED' ? 'Pagamento estornado' : 'PIX cancelado';
            el('delivery-dialog-status-text').textContent = result.status === 'REFUNDED' ? 'Pagamento estornado' : 'PIX cancelado';
            el('delivery-event-first').textContent = 'Pagamento não confirmado';
            el('delivery-event-second').textContent = 'Rastreamento em tempo real indisponível';
            el('pix-expiration').hidden = true;
            buttons.forEach(button => { button.disabled = true; });
          }
        } catch (_) { /* Keep the last verified status until the next check. */ }
        finally { checking = false; }
      };
      check(); root.setInterval(check, 20000);
    }
  }
  function fail() { el('payment-error').hidden = false; el('payment-content').hidden = true; }
  function init() {
    if (root.PaymentSession && root.PaymentSession.enabled()) {
      const session = root.PaymentSession.read();
      let preview;
      try { preview=JSON.parse(root.sessionStorage.getItem('checkout_payment_preview')); } catch (_) {}
      if (session && (!preview || !preview.pix || (root.location.hash.includes('token=') && preview.pix.sessionToken !== session.token))) {
        el('session-resume').hidden=false;
        root.PaymentSession.start(session,{onTerminal:()=>{el('session-resume').textContent='Pagamento cancelado ou estornado.';},onExpired:()=>{el('session-resume').textContent='Link expirado. Entre em contato com a loja.';}});
        return;
      }
    }
    try {
      const data = JSON.parse(root.sessionStorage.getItem('checkout_payment_preview') || 'null');
      const items = data && data.pix && data.cart ? data.cart.items : JSON.parse(root.localStorage.getItem('cart') || 'null');
      if (!data || !data.address || !data.customer || !data.cart || !Array.isArray(data.cart.items) || !Array.isArray(items) || !items.length) return fail();
      const a = data.address;
      if (![a.street, a.number, a.city, a.state, data.customer.name].every(value => typeof value === 'string' && value.trim())) return fail();
      let cents = 0;
      const normalized = items.map(item => {
        if (!item || typeof item.name !== 'string' || !item.name.trim() || !Number.isFinite(Number(item.price)) || Number(item.price) < 0 || !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) < 1) throw Error('invalid cart');
        const total = Math.round(Number(item.price) * 100) * Number(item.quantity);
        cents += total;
        return { ...item, quantity: Number(item.quantity), price: Math.round(Number(item.price) * 100) / 100, total: total / 100 };
      });
      if (!Number.isSafeInteger(cents) || JSON.stringify(normalized) !== JSON.stringify(data.cart.items) || cents !== Math.round(Number(data.cart.total) * 100)) return fail();
      const street = a.street.trim() + ', ' + a.number.trim() + (a.complement ? ' · ' + a.complement.trim() : '');
      const city = [a.neighborhood, a.city + '/' + a.state].filter(Boolean).join(' · ');
      el('payment-total').textContent = money(cents / 100); el('how-total').textContent = money(cents / 100); el('receipt-total').textContent = money(cents / 100);
      el('delivery-street').textContent = street; el('delivery-city').textContent = city; el('delivery-person').textContent = data.customer.name;
      el('delivery-full').textContent = street + ' · ' + city; el('receipt-name').textContent = data.customer.name; el('receipt-street').textContent = street; el('receipt-city').textContent = city;
      el('delivery-map').src = 'https://maps.google.com/maps?output=embed&q=' + encodeURIComponent([a.street, a.number, a.neighborhood, a.city, a.state, a.cep, 'Brasil'].filter(Boolean).join(', '));
      el('delivery-track-open').addEventListener('click', () => {
        const dialog = el('delivery-dialog');
        if (!el('delivery-dialog-map').src) el('delivery-dialog-map').src = el('delivery-map').src;
        if (!dialog.open) dialog.showModal();
      });
      el('delivery-dialog-close').addEventListener('click', () => el('delivery-dialog').close());
      const date = new Date(data.createdAt);
      el('receipt-date').textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      el('receipt-items').replaceChildren(...normalized.map(item => {
        const row = document.createElement('div'); row.className = 'receipt-item';
        const name = document.createElement('span'); name.textContent = item.quantity + 'X ' + item.name.toUpperCase();
        const value = document.createElement('span'); value.textContent = money(item.total); row.appendChild(name); row.appendChild(value); return row;
      }));
      setupPix(data.pix, cents, data.createdAt);
      el('payment-content').hidden = false;
    } catch (_) { fail(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
