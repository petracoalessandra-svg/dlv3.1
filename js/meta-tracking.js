(function(root){
  'use strict';
  var pixel='4491668551074059', endpoint='https://marmita.laura66hg.workers.dev/api/meta', key='meta_customer';
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(root,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  root.fbq('init',pixel);
  function cookie(name){try{return document.cookie.split('; ').find(function(x){return x.indexOf(name+'=')===0})?.slice(name.length+1)||''}catch(_){return ''}}
  function customer(){try{return JSON.parse(root.sessionStorage.getItem(key)||'{}')}catch(_){return {}}}
  function track(name,data,id){
    try {
      id=id||root.crypto.randomUUID(); data=data||{};
      root.fbq('track',name,data,{eventID:id});
      var url=new URL(root.location.href); url.search=''; url.hash='';
      var body={event_name:name,event_id:id,event_source_url:url.href,custom_data:data,user_data:customer(),fbp:cookie('_fbp'),fbc:cookie('_fbc')};
      if(name==='Purchase') body.requestId=id;
      root.fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:true}).catch(function(){});
    }catch(_){}
  }
  root.MetaTracking={track:track,attribution:function(){return {fbp:cookie('_fbp'),fbc:cookie('_fbc')}},setCustomer:function(c,a){try{root.sessionStorage.setItem(key,JSON.stringify({name:c.name,email:c.email,phone:c.phone,city:a.city,state:a.state,zip:a.cep}));}catch(_){}}};
  track('PageView');
  root.addEventListener('checkout:requested',function(e){var c=e.detail; track('InitiateCheckout',{currency:'BRL',value:c.total,num_items:c.items.reduce(function(n,i){return n+i.quantity},0),content_type:'product',content_ids:c.items.map(function(i){return i.name})})});
  root.addEventListener('checkout:customer-ready',function(e){var d=e.detail;root.MetaTracking.setCustomer(d.customer,d.address);track('Lead',{currency:'BRL',value:d.cart.total})});
})(window);
