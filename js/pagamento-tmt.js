(function (root) {
  'use strict';
  const el=id=>document.getElementById(id);
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let session, customer, inFlight=false, polling=false, finished=false, feeId, timer, failures=0;
  try { session=root.PaymentSession.read(); } catch (_) {}
  if (!session) {el('tmt-payment-status').textContent='Pedido não identificado';el('tmt-message').textContent='Abra esta etapa pelo link do pagamento do seu pedido para gerar o PIX da TMT.';return;}
  const customerKey='tmt_customer:' + session.token.split('.')[0];
  try {
    const cached=JSON.parse(root.sessionStorage.getItem(customerKey));
    if (cached && cached.expiresAt>Date.now()) customer=cached.customer;
    else root.sessionStorage.removeItem(customerKey);
  } catch (_) {}
  const back=new URL(root.location.href);back.pathname='/tmt.html';el('tmt-back').href=back.href;
  async function api(action, data={}) {
    const controller=new AbortController(), timeout=root.setTimeout(()=>controller.abort(),action==='pix'?25000:8000);
    try {
      const endpoint=new URL('/api/tmt/'+action,root.PIX_API_BASE_URL);
      if (endpoint.protocol!=='https:' && !['localhost','127.0.0.1'].includes(endpoint.hostname)) throw Error('Configuração inválida.');
      const response=await root.fetch(endpoint.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:session.token,...data}),cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
      const result=await response.json();
      if (!response.ok) {const error=new Error(result.error || 'Não foi possível consultar o PIX.');error.code=result.code;error.status=response.status;error.retryMs=Number(response.headers.get('Retry-After'))*1000 || 0;throw error;}
      if(result.amount!==990 || !['PENDING','PAID','CANCELLED','REFUNDED'].includes(result.status) || !uuid.test(result.feeRequestId || '') || result.feeRequestId===session.token.split('.')[0] || (feeId && feeId!==result.feeRequestId)) throw Error('Resposta de pagamento inválida.');
      feeId=result.feeRequestId;return result;
    } finally {root.clearTimeout(timeout);}
  }
  function applyStatus(result) {
    if(result.status==='PENDING') {el('tmt-payment-status').textContent='Aguardando pagamento';return;}
    if(finished)return;
    finished=true;root.clearTimeout(timer);el('tmt-pix').hidden=true;el('tmt-customer').hidden=true;el('tmt-retry').hidden=true;el('tmt-message').textContent='';
    if(result.status==='PAID') {
      el('tmt-payment-status').textContent='Pagamento confirmado';el('tmt-success').hidden=false;
      try {if(root.MetaTracking)root.MetaTracking.track('Purchase',{currency:'BRL',value:9.90},feeId);} catch (_) {}
      const next=new URL('/taxa-entrega.html',root.location.href);
      for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']) {
        const value=new URL(root.location.href).searchParams.get(key) || (session.campaign || {})[key];
        if(value)next.searchParams.set(key,value.slice(0,200));
      }
      next.hash=new URLSearchParams({token:session.token}).toString();
      root.location.replace(next.pathname+next.search+next.hash);
    } else el('tmt-payment-status').textContent=result.status==='REFUNDED'?'Pagamento estornado':'PIX cancelado';
  }
  const schedule=delay=>{root.clearTimeout(timer);if(!finished)timer=root.setTimeout(poll,delay);};
  async function poll() {
    if(finished||polling)return;
    if(document.hidden || root.navigator.onLine===false){schedule(6000);return;}
    polling=true;let delay=6000;
    try {const result=await api('status');failures=0;el('tmt-message').textContent='';applyStatus(result);}
    catch(error){failures++;delay=Math.max(Math.min(30000,6000*2**Math.min(failures,3)),error.retryMs||0);el('tmt-message').textContent='Não foi possível atualizar o status. A verificação será repetida.';if([401,410].includes(error.status)){finished=true;el('tmt-message').textContent=error.message;}}
    finally {polling=false;schedule(delay+Math.floor(Math.random()*1001));}
  }
  async function generate() {
    if(inFlight||finished)return;inFlight=true;el('tmt-generate').disabled=true;el('tmt-retry').hidden=true;el('tmt-message').textContent='Gerando ou recuperando seu PIX…';
    try {
      let result;
      try { result=await api('pix'); }
      catch (error) {
        if (error.code==='CUSTOMER_REQUIRED' && customer) result=await api('pix',{customer});
        else throw error;
      }
      applyStatus(result);if(finished)return;
      const payment=result.paymentData, code=payment && payment.copyPaste;
      if(typeof code!=='string'||!code||code.length>4096)throw Error('Código PIX indisponível.');
      el('tmt-code').textContent=code;
      const image=payment.qrCodeBase64;
      if(typeof image==='string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image) && image.length<=500000){el('tmt-qr').src=image;el('tmt-qr').hidden=false;}
      else {try{const qr=root.qrcode(0,'M');qr.addData(code,'Byte');qr.make();el('tmt-qr').src=qr.createDataURL(5,20);el('tmt-qr').hidden=false;}catch(_){el('tmt-qr').hidden=true;}}
      el('tmt-pix').hidden=false;el('tmt-customer').hidden=true;el('tmt-message').textContent='';schedule(6000);
    } catch(error) {
      el('tmt-message').textContent=error.code==='CUSTOMER_REQUIRED'?error.message:'Não foi possível confirmar a geração do PIX. Tente recuperar a mesma cobrança; se persistir, entre em contato com a loja.';
      el('tmt-payment-status').textContent='PIX ainda não disponível';
      if(error.code==='CUSTOMER_REQUIRED'){el('tmt-customer').hidden=false;for(const key of ['name','email','phone','cpf'])if(customer && customer[key])el('tmt-'+key).value=customer[key];}
      else el('tmt-retry').hidden=false;
    } finally {inFlight=false;el('tmt-generate').disabled=false;}
  }
  el('tmt-customer').addEventListener('submit',event=>{event.preventDefault();customer={};for(const key of ['name','email','phone','cpf'])customer[key]=el('tmt-'+key).value.trim();generate();});
  el('tmt-retry').addEventListener('click',generate);
  el('tmt-copy').addEventListener('click',async()=>{try{await root.navigator.clipboard.writeText(el('tmt-code').textContent);el('tmt-copy-status').textContent='Código PIX copiado.';}catch(_){el('tmt-copy-status').textContent='Selecione o código PIX acima para copiar.';}});
  const wake=()=>{if(feeId&&!finished)schedule(0);};root.addEventListener('online',wake);root.addEventListener('focus',wake);document.addEventListener('visibilitychange',wake);
  generate();
})(window);
