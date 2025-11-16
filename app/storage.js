import Dexie from 'dexie';

export const db = new Dexie('connectta');
db.version(1).stores({
  messages: '++id, ts, from, to, channel, outgoing, status',
  drafts: '++id, ts',
  nodes: 'id, lastHeard, name, lat, lon, battery',
  positions: '++id, nodeId, ts',
  breadcrumbs: '++id, ts'
});

export async function addMessage(msg){
  return db.messages.add(msg);
}
export async function listMessages(limit=200){
  return db.messages.orderBy('ts').reverse().limit(limit).toArray();
}
export async function addDraft(d){
  return db.drafts.add(d);
}
export async function listNodes(){
  return db.nodes.orderBy('lastHeard').reverse().toArray();
}
export async function upsertNode(n){
  return db.nodes.put(n);
}
export async function addPosition(p){
  return db.positions.add(p);
}
export async function getBreadcrumb(){
  return db.breadcrumbs.toArray();
}
