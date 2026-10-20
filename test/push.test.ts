import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema, ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMockAi } from '../src/ai/mock.js';
import { openDb } from '../src/db/client.js';
import { createMcpServer } from '../src/mcp/server.js';
import { subscriberCount } from '../src/mcp/subscriptions.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';

test('HTTP sessions stream updates, reject another user and preserve stateless POST calls', async()=>{
  const db=await openDb({databaseUrl:'',pgliteDir:'',embeddingDim:64},{inMemory:true});
  const deps={db,ai:createMockAi(64),cfg:{matchThreshold:0.35}};
  const app=createApp(deps,{...config,authMode:'none',mcpApiKey:'',originSecret:'',allowedOrigins:[],mcpSessions:true});
  const http=app.listen(0,'127.0.0.1');await new Promise<void>(r=>http.once('listening',r));
  const address=http.address();assert.ok(address&&typeof address==='object');const url=new URL(`http://127.0.0.1:${address.port}/mcp`);
  const client=new Client({name:'http-push-test',version:'1'});
  const transport=new StreamableHTTPClientTransport(url,{requestInit:{headers:{'X-User-Id':'http-owner'}}});
  try{
    await client.connect(transport); assert.ok(transport.sessionId);
    let received=false;client.setNotificationHandler(ResourceUpdatedNotificationSchema,()=>{received=true;});
    await client.subscribeResource({uri:'posts://me'});
    const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream','Mcp-Session-Id':transport.sessionId!,'X-User-Id':'intruder'};
    assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:99,method:'resources/read',params:{uri:'posts://me'}})})).status,404);
    await client.callTool({name:'post_offer',arguments:{title:'Desk lamp',ask_price:10}});
    for(let i=0;i<80&&!received;i++)await new Promise(r=>setTimeout(r,25));assert.equal(received,true);
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','X-User-Id':'stateless'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'list_my_posts',arguments:{}}})});
    assert.equal(r.status,200);assert.match(await r.text(),/offers/);
    await transport.terminateSession();assert.equal(app.locals.mcpSessions.size,0);
  }finally{await client.close();await app.locals.mcpSessions.closeAll();http.closeAllConnections();await new Promise<void>(r=>http.close(()=>r()));await db.close();}
});

test('subscriptions deliver only the signed-in user’s changes and clean up on close; elicitation requires yes', async () => {
  const db = await openDb({ databaseUrl:'', pgliteDir:'', embeddingDim:64 }, { inMemory:true });
  const deps = { db, ai:createMockAi(64), cfg:{ matchThreshold:0.35 } };
  const clients: Client[] = [];
  let action: 'accept' | 'decline' = 'decline';
  let questions = 0;
  const connect = async (userId:string, form=false) => {
    const [a,b]=InMemoryTransport.createLinkedPair();
    await createMcpServer(deps,{userId}).connect(a);
    const c=new Client({name:'push-test',version:'1'}, {capabilities: form ? {elicitation:{form:{}}} : {}});
    if(form) c.setRequestHandler(ElicitRequestSchema,async()=>{questions++; return {action, ...(action==='accept'?{content:{confirm:true}}:{})};});
    await c.connect(b); await c.listTools(); clients.push(c); return c;
  };
  const call = async(c:Client,name:string,args:Record<string,unknown>={})=> {
    const r=await c.callTool({name,arguments:args});
    return {...JSON.parse((r.content as {text:string}[])[0].text), isError:r.isError};
  };
  try {
    const buyer=await connect('push-buyer',true), seller=await connect('push-seller'), stranger=await connect('push-stranger');
    const notices:string[]=[]; let other=0;
    buyer.setNotificationHandler(ResourceUpdatedNotificationSchema,n=>{notices.push(n.params.uri);});
    stranger.setNotificationHandler(ResourceUpdatedNotificationSchema,()=>{other++;});
    await buyer.subscribeResource({uri:'deals://me'}); await buyer.subscribeResource({uri:'posts://me'});
    await stranger.subscribeResource({uri:'deals://me'});
    await call(seller,'post_offer',{title:'Desk lamp',ask_price:10});
    const req=await call(buyer,'post_request',{need:'desk lamp',max_price:12});
    assert.ok(req.deal);
    for(let i=0;i<40&&!notices.includes('deals://me');i++) await new Promise(r=>setTimeout(r,25));
    assert.ok(notices.includes('deals://me')); assert.ok(notices.includes('posts://me')); assert.equal(other,0);
    const resource=await buyer.readResource({uri:'deals://me'});
    assert.ok(!JSON.stringify(resource).includes('min_price'));
    assert.equal((await call(buyer,'confirm_deal',{deal_id:req.deal.deal_id})).isError,true);
    action='accept';
    assert.equal((await call(buyer,'confirm_deal',{deal_id:req.deal.deal_id})).deal.status,'confirmed');
    assert.equal(questions,2);
    action='decline';
    assert.equal((await call(buyer,'post_offer',{title:'TI-84 graphing calculator',ask_price:1})).isError,true);
    action='accept';
    assert.ok((await call(buyer,'post_offer',{title:'TI-84 graphing calculator',ask_price:1})).offer);
    assert.equal(questions,4);
    await buyer.unsubscribeResource({uri:'posts://me'});
    await buyer.close(); await stranger.close();
    assert.equal(subscriberCount(),0);
  } finally { for(const c of clients) await c.close(); await db.close(); }
});

test('delete_my_data needs confirmation and erases an account with a past deal without leaking limits', async()=>{
  const db=await openDb({databaseUrl:'',pgliteDir:'',embeddingDim:64},{inMemory:true});
  const deps={db,ai:createMockAi(64),cfg:{matchThreshold:0.35}};
  const clients:Client[]=[];
  const as=async(userId:string)=>{
    const [a,b]=InMemoryTransport.createLinkedPair(); await createMcpServer(deps,{userId}).connect(a);
    const c=new Client({name:'erase-test',version:'1'}); await c.connect(b); clients.push(c);
    return async(name:string,args:Record<string,unknown>={})=>{const r=await c.callTool({name,arguments:args});return {...JSON.parse((r.content as {text:string}[])[0].text),isError:r.isError};};
  };
  try {
    const seller=await as('erase-seller'), buyer=await as('erase-buyer');
    await seller('post_offer',{title:'Desk lamp',ask_price:10,min_price:7});
    const r=await buyer('post_request',{need:'desk lamp',max_price:9});
    await buyer('confirm_deal',{deal_id:r.deal.deal_id});
    assert.equal((await seller('delete_my_data')).code,'confirm_delete');
    assert.equal((await seller('delete_my_data',{confirm:true})).deleted,true);
    assert.equal((await db.query("SELECT id FROM users WHERE id='erase-seller'")).rows.length,0);
    const status=await buyer('get_deal_status');
    assert.equal(status.deals[0].counterpart,'Former member');
    assert.ok(!JSON.stringify(status).includes('min_price'));
    assert.equal((await seller('delete_my_data',{confirm:true})).deleted,true);
  } finally {for(const c of clients) await c.close();await db.close();}
});
