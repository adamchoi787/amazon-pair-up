import { ensureUser, type Deps } from '../market/service.js';

/** Labelled, idempotent demo history. Closed requests never reserve a real offer. */
export async function seedLifestyle(deps:Deps, now=new Date(), userId='u_tony') {
  await ensureUser(deps.db,userId,'Tony (demo)');
  await deps.db.query(`UPDATE users SET time_zone='Asia/Hong_Kong', home_area='Hall 5' WHERE id=$1`,[userId]);
  const need='pick up my lunch';
  const embedding=JSON.stringify(await deps.ai.embed(need));
  const today=new Date(now.toLocaleDateString('en-CA',{timeZone:'Asia/Hong_Kong'})+'T12:15:00+08:00');
  let added=0;
  for(let days=21;days>=1;days--){
    const at=new Date(today.getTime()-days*86400000);
    const weekday=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Hong_Kong',weekday:'short'}).format(at);
    if(['Sat','Sun'].includes(weekday))continue;
    const date=at.toISOString().slice(0,10);
    const r=await deps.db.query(`INSERT INTO buy_intents
      (id,buyer_id,need,raw_request,kind,price_unit,max_price,pickup,location,schedule,status,embedding,created_at)
      VALUES ($1,$2,$3,'DEMO DATA: weekday lunch-run history','service','job',4,'LG7 canteen','Hall 5','around 12:15','cancelled',$4::vector,$5)
      ON CONFLICT (id) DO NOTHING RETURNING id`,[`req_demo_lunch_${userId}_${date}`,userId,need,embedding,at]);
    added+=r.rows.length;
  }
  return added;
}
