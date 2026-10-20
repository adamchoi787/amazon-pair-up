import { ensureUser, type Deps } from '../market/service.js';
import { DEFAULT_TIME_ZONE, localInstant } from '../market/scheduling.js';

/** Labelled, idempotent demo history. Closed requests never reserve a real offer. */
export async function seedLifestyle(deps:Deps, now=new Date(), userId='u_tony') {
  await ensureUser(deps.db,userId,'Tony (demo)');
  await deps.db.query(`UPDATE users SET time_zone=$2, home_area='McCarty Hall' WHERE id=$1`,[userId,DEFAULT_TIME_ZONE]);
  const need='pick up my lunch';
  const embedding=JSON.stringify(await deps.ai.embed(need));
  let added=0;
  for(let days=21;days>=1;days--){
    // 12:15 local on each past weekday, correct across daylight-saving changes.
    const at=localInstant(now,days,12*60+15);
    const weekday=new Intl.DateTimeFormat('en-US',{timeZone:DEFAULT_TIME_ZONE,weekday:'short'}).format(at);
    if(['Sat','Sun'].includes(weekday))continue;
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:DEFAULT_TIME_ZONE}).format(at);
    const r=await deps.db.query(`INSERT INTO buy_intents
      (id,buyer_id,need,raw_request,kind,price_unit,max_price,pickup,location,schedule,status,embedding,created_at)
      VALUES ($1,$2,$3,'DEMO DATA: weekday lunch-run history','service','job',4,'the HUB','McCarty Hall','around 12:15','cancelled',$4::vector,$5)
      ON CONFLICT (id) DO NOTHING RETURNING id`,[`req_demo_lunch_${userId}_${date}`,userId,need,embedding,at]);
    added+=r.rows.length;
  }
  return added;
}
