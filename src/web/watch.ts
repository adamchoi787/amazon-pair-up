import { Auth, type AppConfig } from './auth.js';
import { Mcp, resultData } from './mcp.js';
import { canListen, listen, speak } from './voice.js';

const $ = (id:string)=>document.getElementById(id)!;
let auth:Auth, mcp:Mcp, busy=false;
let action:{kind:'deal'|'suggestion';id:string;budget:number|null}|null=null;
const say=(text:string,voice=false)=>{$('message').textContent=text;if(voice)speak(text);};
const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
async function refresh(){
  if(busy)return;
  const deals=resultData(await mcp.call('get_deal_status',{})).deals as {deal_id:string;title:string;price:number;waiting_for_you:boolean;status:string}[];
  const deal=deals.find(d=>d.status==='proposed'&&d.waiting_for_you);
  if(deal){action={kind:'deal',id:deal.deal_id,budget:null};say(`${deal.title} for $${deal.price}. Confirm?`);}
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
  $('refresh').onclick=()=>void refresh().catch(()=>say('Could not refresh. Try again.'));
  $('mic').hidden=!canListen;
  $('mic').onclick=()=>void run(async()=>{
    const session=listen(text=>say(text||'Listening…'));say('Listening…');
    const text=await session.done;if(!text)return 'I didn’t hear anything. Try again.';
    const r=await auth.fetch('/api/voice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,time_zone:zone})});
    if(!r.ok)throw Error();const data=await r.json();action=null;$('actions').hidden=true;return data.say;
  });
  ($('words') as HTMLFormElement).onsubmit=e=>{e.preventDefault();const i=$('text') as HTMLInputElement;void voice(i.value);i.value='';};
  await refresh();
}
void boot().catch(()=>say('PairUp is unavailable. Reload to try again.'));
