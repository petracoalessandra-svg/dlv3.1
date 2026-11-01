(function (root) {
  'use strict';
  const KEY = 'payment_session_v1';
  const pattern = /^[0-9a-f-]{36}\.[0-9a-f]{64}$/;
  const campaigns = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
  const enabled = () => root.PAYMENT_SESSION_ENABLED === true;
  function read() {
    try {
      const token = new URLSearchParams(root.location.hash.slice(1)).get('token');
      if (token !== null) return pattern.test(token) ? {token} : null;
      const saved = JSON.parse(root.localStorage.getItem(KEY));
      return saved && pattern.test(saved.token) && saved.expiresAt > Date.now() ? saved : null;
    } catch (_) { return null; }
  }
  function save(token, expiresAt) {
    if (!pattern.test(token || '') || !Number.isFinite(expiresAt)) return null;
    const params = new URL(root.location.href).searchParams, campaign = {};
    for (const key of campaigns) { const value = params.get(key); if (value) campaign[key] = value.slice(0,200); }
    const session = {token,expiresAt,campaign};
    try { root.localStorage.setItem(KEY,JSON.stringify(session)); } catch (_) {}
    return session;
  }
  async function request(session, action, signal) {
    const endpoint = new URL('/api/payment-session/' + action,root.PIX_API_BASE_URL);
    if (endpoint.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(endpoint.hostname)) throw Error('Configuração inválida');
    const response = await root.fetch(endpoint.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:session.token}),cache:'no-store',referrerPolicy:'no-referrer',signal});
    if (!response.ok) {
      const error = new Error('Consulta indisponível'); error.status = response.status;
      const retry = response.headers.get('Retry-After');
      error.retryMs = retry ? (/^\d+$/.test(retry) ? Number(retry)*1000 : Math.max(0,Date.parse(retry)-Date.now())) : 0;
      throw error;
    }
    const result = await response.json();
    if (!['PENDING','PAID','REFUNDED','CANCELLED'].includes(result.status) || !Number.isSafeInteger(result.amount) || result.amount <= 0 || !Number.isFinite(result.expiresAt)) throw Error('Resposta inválida');
    return result;
  }
  function destination(session) {
    const url = new URL('/tmt.html',root.location.href);
    for (const key of campaigns) { const value = new URL(root.location.href).searchParams.get(key) || (session.campaign || {})[key]; if (value) url.searchParams.set(key,value.slice(0,200)); }
    url.hash = new URLSearchParams({token:session.token}).toString(); return url.pathname + url.search + url.hash;
  }
  function start(session, options = {}) {
    let running = false, stopped = false, failures = 0, timer, channel, leaseUntil = 0, redirected = false;
    try { channel = new root.BroadcastChannel('payment:' + session.token.split('.')[0]); channel.onmessage = event => { if (event.data === 'checking') leaseUntil = Date.now()+7000; }; } catch (_) {}
    const schedule = ms => { root.clearTimeout(timer); if (!stopped) timer = root.setTimeout(check,ms); };
    const stop = () => { stopped = true; root.clearTimeout(timer); if (channel) channel.close(); root.removeEventListener('online',wake); root.removeEventListener('focus',wake); document.removeEventListener('visibilitychange',wake); };
    async function check() {
      if (running || stopped) return;
      if (document.hidden || root.navigator.onLine === false) { schedule(6000); return; }
      if (leaseUntil > Date.now()) { schedule(leaseUntil-Date.now()+100); return; }
      running = true;
      try { if (channel) channel.postMessage('checking'); } catch (_) {}
      const controller = new AbortController(); const timeout = root.setTimeout(()=>controller.abort(),8000);
      let delay = 6000;
      try {
        const result = await request(session,'status',controller.signal);
        if (options.amount != null && result.amount !== options.amount) throw Error('Valor divergente');
        failures = 0;
        if (result.status === 'PAID') {
          if (!redirected) {
            redirected = true; stop();
            // Restore the same browser Pixel + keepalive CAPI path used by legacy polling.
            // The request UUID is also the webhook event_id, so Meta can deduplicate.
            try {
              if (root.MetaTracking) root.MetaTracking.track('Purchase',{currency:'BRL',value:result.amount/100},session.token.split('.')[0]);
            } catch (_) { /* Tracking failures must not block the paid redirect. */ }
            root.location.replace(destination(session));
          }
        } else if (['REFUNDED','CANCELLED'].includes(result.status)) { stop(); if (options.onTerminal) options.onTerminal(result.status); }
      } catch (error) {
        failures++; delay = Math.max(Math.min(30000,6000 * 2 ** Math.min(failures,3)),error.retryMs || 0);
        if ([401,410].includes(error.status)) { stop(); if (options.onExpired) options.onExpired(); }
      } finally { root.clearTimeout(timeout); running = false; schedule(delay + Math.floor(Math.random()*1001)); }
    }
    function wake() { leaseUntil=0; schedule(0); }
    root.addEventListener('online',wake); root.addEventListener('focus',wake); document.addEventListener('visibilitychange',wake);
    check(); return stop;
  }
  root.PaymentSession = {enabled,read,save,request,start,destination};
})(window);
