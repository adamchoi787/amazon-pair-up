import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMockAi } from '../src/ai/mock.js';
import { openDb } from '../src/db/client.js';
import { seedLifestyle } from '../src/db/demo-lifestyle.js';
import { getSuggestions } from '../src/market/context.js';
import { postOffer, postRequest } from '../src/market/service.js';

test('labelled demo lunch history is idempotent, closed and suggested before noon',async()=>{
  const db=await openDb({databaseUrl:'',pgliteDir:'',embeddingDim:64},{inMemory:true});
  const deps={db,ai:createMockAi(64),cfg:{matchThreshold:0.35}};
  const now=new Date('2026-10-20T11:45:00+08:00');
  try{
    assert.equal(await seedLifestyle(deps,now),15);
    assert.equal(await seedLifestyle(deps,now),0);
    const s=await getSuggestions(deps,'u_tony',now);
    assert.equal(s.suggestions.length,1);
    assert.deepEqual([s.suggestions[0].request.max_price,s.suggestions[0].request.pickup,s.suggestions[0].request.location],[4,'LG7 canteen','Hall 5']);
    assert.equal((await db.query("SELECT id FROM buy_intents WHERE status != 'cancelled'")).rows.length,0);
    assert.equal((await db.query('SELECT id FROM deals')).rows.length,0);
  }finally{await db.close();}
});


test('offline printer-paper requests choose printer paper ahead of tissues',async()=>{
  const db=await openDb({databaseUrl:'',pgliteDir:'',embeddingDim:64},{inMemory:true});
  const deps={db,ai:createMockAi(64),cfg:{matchThreshold:0.35}};
  try{
    await postOffer(deps,{user_id:'tissue-seller',title:'Pocket tissues, 6 packs',category:'tissue',ask_price:2});
    const paper=await postOffer(deps,{user_id:'paper-seller',title:'A4 printer paper, 500 sheets',category:'stationery',ask_price:4});
    const request=await postRequest(deps,{user_id:'paper-buyer',raw_request:'I need printer paper, max $5'});
    assert.equal(request.deal?.offer_id,paper.offer.offer_id);
  }finally{await db.close();}
});
