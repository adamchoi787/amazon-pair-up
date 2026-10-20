import type { Auth } from './auth.js';
import { Mcp, resultData } from './mcp.js';

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
  const n = document.createElement(tag); n.textContent = text; return n;
};
export async function refreshSuggestions(mcp: Mcp, onChange: () => void = () => undefined) {
  const strip = document.getElementById('for-you')!;
  try {
    const r = await mcp.call('get_suggestions', {});
    if (r.isError) throw Error(String(resultData(r).say));
    const items = resultData(r).suggestions as {suggestion_id:string; say:string; request:{max_price:number|null}}[];
    strip.replaceChildren(); strip.hidden = !items.length;
    if (!items.length) return;
    strip.append(node('h2', 'For you'));
    for (const s of items.slice(0, 3)) {
      const card=node('article'), message=node('p',s.say), actions=node('div');
      const budget=node('input'); budget.type='number'; budget.min='0.01'; budget.max='100000'; budget.step='0.01'; budget.placeholder='Your budget'; budget.setAttribute('aria-label','Your maximum budget');
      if(s.request.max_price===null) card.append(budget);
      const status=node('p'); status.setAttribute('role','status');
      for(const [label, tool, extra] of [
        ['Yes','accept_suggestion',{}], ['Not now','dismiss_suggestion',{}], ['Forget','dismiss_suggestion',{forget:true}],
      ] as const) {
        const b=node('button',label); b.type='button';
        b.onclick=async()=>{
          const max_price=s.request.max_price??Number(budget.value);
          if(tool==='accept_suggestion'&&!(max_price>0)){status.textContent='Enter your budget first.';budget.focus();return;}
          const buttons=Array.from(actions.querySelectorAll('button'));buttons.forEach(x=>x.disabled=true);
          try {
            const res=await mcp.call(tool,{suggestion_id:s.suggestion_id,...extra,...(tool==='accept_suggestion'?{max_price,idempotency_key:crypto.randomUUID()}:{})});
            status.textContent=String(resultData(res).say??'');
            if(!res.isError){actions.remove();budget.remove();onChange();}
          }catch{status.textContent='Could not reach PairUp. Please try again.';}
          finally{buttons.forEach(x=>x.disabled=false);}
        }; actions.append(b);
      }
      card.prepend(message); card.append(actions,status);strip.append(card);
    }
  } catch { strip.hidden=false;strip.replaceChildren(node('p','Suggestions are unavailable. Try again in a moment.')); }
}

export async function showDevices(auth: Auth) {
  const panel=document.getElementById('panel-devices')!;
  panel.replaceChildren(node('h2','Your devices'),node('p','Connect a watch, Bee, or phone. Each token is shown once and can be revoked here.'));
  const kind=node('select');kind.setAttribute('aria-label','Device type');
  for(const k of ['watch','bee','phone']){const o=node('option',k==='watch'?'Apple Watch':k==='bee'?'Bee':'Phone');o.value=k;kind.append(o);}
  const label=node('input');label.placeholder='Device name';label.maxLength=40;label.setAttribute('aria-label','Device name');
  const create=node('button','Create token'), status=node('p'), secret=node('div'), list=node('div'); status.setAttribute('role','status');secret.setAttribute('aria-live','polite');
  const watch=node('a','Open watch view');watch.href='/watch/';panel.append(watch,kind,label,create,status,secret,list);
  const load=async()=>{
    const r=await auth.fetch('/api/devices');if(!r.ok)throw Error('Could not load your devices.');
    const data=await r.json() as {devices:{device_id:string;label:string;kind:string}[]};list.replaceChildren();
    if(!data.devices.length)list.append(node('p','No devices connected yet.'));
    for(const d of data.devices){const row=node('p',`${d.label} (${d.kind}) `),revoke=node('button','Revoke');
      revoke.onclick=async()=>{revoke.disabled=true;try{const r=await auth.fetch(`/api/devices/${encodeURIComponent(d.device_id)}`,{method:'DELETE'});if(!r.ok)throw Error('Could not revoke this device.');secret.replaceChildren();await load();}catch(e){status.textContent=(e as Error).message;}finally{revoke.disabled=false;}};
      row.append(revoke);list.append(row);
    }
  };
  create.onclick=async()=>{
    create.disabled=true;secret.replaceChildren();status.textContent='';
    try {
      const r=await auth.fetch('/api/devices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:kind.value,label:label.value||undefined})});
      const data=await r.json();if(!r.ok)throw Error(data.say??'Could not create a token.');
      const instructions=`Token (shown once): ${data.token}\nVoice URL: ${data.endpoints.voice}\nContext URL: ${data.endpoints.context}\n\nShortcut: Dictate Text → Get Contents of URL (POST)\nAuthorization: Bearer ${data.token}\nJSON: {"text": "[Dictated Text]", "time_zone": "${Intl.DateTimeFormat().resolvedOptions().timeZone}"}\nGet Dictionary Value: say → Speak Text\nName your Shortcut PairUp, then say “Hey Siri, PairUp”.`;
      const pre=node('pre',instructions),copy=node('button','Copy Shortcut steps'),hide=node('button','Hide token');
      copy.onclick=()=>void navigator.clipboard.writeText(instructions).then(()=>{status.textContent='Copied.';},()=>{status.textContent='Select and copy the steps above.';});
      hide.onclick=()=>secret.replaceChildren();secret.append(pre,copy,hide);await load();
    }catch(e){status.textContent=(e as Error).message;}finally{create.disabled=false;}
  };
  try{await load();}catch(e){status.textContent=(e as Error).message;}
}
