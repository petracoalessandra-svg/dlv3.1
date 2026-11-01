(function (root) {
  'use strict';
  const message=document.getElementById('session-message'), page=document.getElementById('verified-order');
  // Public page: verification enriches the order but never gates access.
  if (message) message.hidden=true;
  page.hidden=false;
  let session=null;
  try { session=root.PaymentSession && root.PaymentSession.read(); } catch (_) {}
  document.getElementById('tmt-pay').addEventListener('click',()=>{
    const url=new URL('/pagamento-tmt.html',root.location.href);
    for (const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']) {
      const value=new URL(root.location.href).searchParams.get(key) || (session && session.campaign || {})[key];
      if (value) url.searchParams.set(key,value.slice(0,200));
    }
    if (session) url.hash=new URLSearchParams({token:session.token}).toString();
    root.location.assign(url.href);
  });
  const key='tmt_deadline_v1:' + (session ? session.token.split('.')[0] : 'direct');
  let deadline=Date.now()+600000, offset=0, timer, checking=false, next;
  try {
    const saved=Number(root.localStorage.getItem(key));
    if (Number.isFinite(saved) && saved>0) deadline=saved;
    else root.localStorage.setItem(key,String(deadline));
  } catch (_) {}
  function tick() {
    const seconds=Math.max(0,Math.ceil((deadline-(Date.now()+offset))/1000));
    if (!seconds) { document.getElementById('timer-text').textContent='Prazo encerrado. Seu pedido segue retido — pague a TMT para liberar.'; root.clearInterval(timer); return; }
    document.getElementById('timer-text').textContent='Prazo para liberar seu pedido: ' + String(Math.floor(seconds/60)).padStart(2,'0') + ':' + String(seconds%60).padStart(2,'0');
  }
  function startTimer() { root.clearInterval(timer); tick(); if(deadline>Date.now()+offset) timer=root.setInterval(tick,1000); }
  startTimer();
  if (!session || !root.PaymentSession.enabled()) return;
  async function enrich() {
    if (checking || document.hidden) return;
    checking=true; const controller=new AbortController(); const timeout=root.setTimeout(()=>controller.abort(),8000);
    try {
      const result=await root.PaymentSession.request(session,'open',controller.signal);
      if (result.status === 'PAID' && Number.isFinite(result.tmtExpiresAt) && Number.isFinite(result.serverNow)) {
        document.getElementById('order-reference').textContent='PEDIDO ' + result.orderReference;
        deadline=result.tmtExpiresAt; offset=result.serverNow-Date.now();
        startTimer();
      }
    } catch (_) { /* Public access remains available for pending, expired or offline sessions. */ }
    finally { checking=false; root.clearTimeout(timeout); }
    root.clearTimeout(next); next=root.setTimeout(enrich,15000);
  }
  root.addEventListener('online',enrich); root.addEventListener('focus',enrich); document.addEventListener('visibilitychange',enrich);
  enrich();
})(window);
