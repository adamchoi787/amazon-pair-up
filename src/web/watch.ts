import { Auth, type AppConfig } from './auth.js';
import { Mcp, resultData } from './mcp.js';
import { canListen, listen, speak } from './voice.js';
import { icon, mark, type IconName } from '../design/icons.js';

const $ = (id:string)=>document.getElementById(id)!;
let auth:Auth, mcp:Mcp, busy=false;
let pointDeal:string|null=null;
let action:{kind:'deal'|'suggestion';id:string;budget:number|null}|null=null;
// Each new line cross-fades in, so a glance shows that something changed.
const say=(text:string,voice=false)=>{const m=$('message');if(m.textContent!==text){m.textContent=text;m.classList.remove('swap');void m.offsetWidth;m.classList.add('swap');}if(voice)speak(text);};
for(const slot of document.querySelectorAll<HTMLElement>('[data-icon]'))slot.replaceWith(icon(slot.dataset.icon as IconName,20));
for(const a of document.querySelectorAll<HTMLElement>('[data-mark]'))a.prepend(mark(Number(a.dataset.mark)));
const tick=()=>{$('clock').textContent=new Date().toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});};tick();setInterval(tick,15_000);
const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
async function refresh(){
  if(busy)return;
  const deals=resultData(await mcp.call('get_deal_status',{})).deals as {deal_id:string;title:string;price:number;total:number|null;waiting_for_you:boolean;status:string;meetup:{point?:{name:string;status:string;you:string;them:string}|null};delivery?:{selected:boolean;pick_up:{name:string};drop_off:{name:string}}|null}[];
  pointDeal=null;$('checkin').hidden=true;
  const deal=deals.find(d=>d.status==='proposed'&&d.waiting_for_you);
  const meeting=deals.find(d=>d.status==='confirmed'&&d.meetup.point);
  const delivery=deals.find(d=>d.status==='confirmed'&&d.delivery?.selected);
  if(deal){action={kind:'deal',id:deal.deal_id,budget:null};say(`${deal.title} for $${deal.total??deal.price}. Confirm?`);}
  else if(meeting){
    action=null;const p=meeting.meetup.point!;pointDeal=meeting.deal_id;
    say(p.status==='both_here'?`${p.name}. Both here. Go ahead with the hand-off.`:`${p.name}. You: ${p.you==='confirmed'?'here, Ring confirmed':p.you==='checked_in'?'waiting for Ring':'on the way'}. Them: ${p.them==='confirmed'?'here, Ring confirmed':'on the way'}. Press the doorbell when you arrive.`);
    $('checkin').hidden=p.you==='confirmed';
  }
  else if(delivery){action=null;say(`${delivery.title}. Demo delivery quote: drop off at ${delivery.delivery!.drop_off.name}, pick up at ${delivery.delivery!.pick_up.name}. Total $${delivery.total??delivery.price}.`);}
  else{
    const list=resultData(await mcp.call('get_suggestions',{})).suggestions as {suggestion_id:string;say:string;from:string;request:{need:string;max_price:number|null}}[];
    const s=list[0];action=s?{kind:'suggestion',id:s.suggestion_id,budget:s.request.max_price}:null;
    say(s ? `${s.from==='routine'?'Your usual':`From your ${s.from==='bee'?'Bee':s.from}`}: ${s.request.need}. ${s.request.max_price==null?'What’s your budget?':`Up to $${s.request.max_price}. Ask now?`}` : 'You’re all caught up. Tell me what you need.');
  }
  $('actions').hidden=!action;
  $('budget').hidden=!(action?.kind==='suggestion'&&action.budget===null);
}
async function run(fn:()=>Promise<string>){
  if(busy)return;busy=true;document.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);
  try{say(await fn(),true);}catch{say('Could not reach PairUp. Please try again.');}
  finally{busy=false;document.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=false);}
}
async function voice(text:string){
  if(!text.trim())return;
  await run(async()=>{
    const r=await auth.fetch('/api/voice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,time_zone:zone})});
    const data=await r.json(); if(!r.ok)throw Error();
    action=null;$('actions').hidden=true;$('budget').hidden=true;return data.say;
  });
}
async function answer(yes:boolean){
  const a=action;if(!a)return;
  const budget=a.budget??Number(($('budget') as HTMLInputElement).value);
  if(yes&&a.kind==='suggestion'&&!(budget>0)){say('Enter your budget first.');$('budget').focus();return;}
  await run(async()=>{
    const tool=a.kind==='deal'?(yes?'confirm_deal':'decline_deal'):(yes?'accept_suggestion':'dismiss_suggestion');
    const args=a.kind==='deal'?{deal_id:a.id}:{suggestion_id:a.id,...(yes?{max_price:budget}:{})};
    const r=await mcp.call(tool,{...args,idempotency_key:crypto.randomUUID()});
    if(!r.isError){
      const d=resultData(r).deal as {deal_id:string;status:string;waiting_for_you:boolean}|undefined;
      action=d?.status==='proposed'&&d.waiting_for_you?{kind:'deal',id:d.deal_id,budget:null}:null;
      $('actions').hidden=!action;$('budget').hidden=true;
    }
    return String(resultData(r).say??'Done.');
  });
}
async function boot(){
  auth=new Auth(await (await fetch('/api/app-config')).json() as AppConfig);
  await auth.completeSignIn();
  if(!auth.signedIn){
    $('signin').hidden=false;$('screen').hidden=true;
    if(auth.config.auth==='none'){
      $('local').hidden=false;($('local') as HTMLFormElement).onsubmit=e=>{e.preventDefault();auth.signInLocally(($('name') as HTMLInputElement).value);location.reload();};
    }
    return;
  }
  mcp=new Mcp(auth);await mcp.connect();
  $('yes').onclick=()=>void answer(true);$('no').onclick=()=>void answer(false);
  $('checkin').onclick=()=>void (async()=>{
    if(!pointDeal)return;
    await run(async()=>{const r=await mcp.call('check_in_at_point',{deal_id:pointDeal,idempotency_key:crypto.randomUUID()});return String(resultData(r).say??'Please try again.');});
    await refresh();
  })().catch(()=>say('Could not refresh. Try again.'));
  $('refresh').onclick=()=>void refresh().catch(()=>say('Could not refresh. Try again.'));
  $('mic').hidden=!canListen;
  $('mic').onclick=()=>void run(async()=>{
    const session=listen(text=>say(text||'Listening…'));say('Listening…');
    $('mic').classList.add('listening');
    const text=await session.done.finally(()=>$('mic').classList.remove('listening'));if(!text)return 'I didn’t hear anything. Try again.';
    const r=await auth.fetch('/api/voice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,time_zone:zone})});
    if(!r.ok)throw Error();const data=await r.json();action=null;$('actions').hidden=true;return data.say;
  });
  ($('words') as HTMLFormElement).onsubmit=e=>{e.preventDefault();const i=$('text') as HTMLInputElement;void voice(i.value);i.value='';};
  await refresh();
}
void boot().catch(()=>say('PairUp is unavailable. Reload to try again.'));
