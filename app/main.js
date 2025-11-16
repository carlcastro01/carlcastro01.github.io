import { MeshClient } from './meshtasticClient.js';
import { db, addMessage, listMessages, addDraft, listNodes, upsertNode, addPosition } from './storage.js';
import { initMap, upsertNodeMarker, startBreadcrumb, addBreadcrumbPoint, loadMBTiles, showDistance } from './map.js';
import { setConnected, setBattery, appendMessage, renderNodes } from './ui.js';

let mesh = null;
let myNode = { id:'self' };
let lastPositions = new Map();

// PWA SW
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

// Map init
initMap();

async function boot(){
  mesh = new MeshClient({
    onEvent: (ev, payload)=>{
      // Try to handle common events (payload shape depends on library build)
      if(ev?.includes?.('TELEMETRY') || payload?.power){
        const pct = payload?.power?.batteryLevel || payload?.batteryLevel || payload?.battery;
        if(pct!=null) setBattery(pct);
      }
      if(ev?.includes?.('POSITION') || payload?.position){
        const p = payload.position;
        const lat = p.latitude || (p.latitudeI/1e7), lon = p.longitude || (p.longitudeI/1e7);
        const id = payload?.from || payload?.nodeId || 'unknown';
        lastPositions.set(id, {lat, lon});
        upsertNode({ id, lat, lon, lastHeard: Date.now() });
        upsertNodeMarker({ id, lat, lon, name: id });
        if(id === myNode.id) addBreadcrumbPoint(lat, lon);
      }
      if(ev?.includes?.('TEXT') || payload?.text){
        const msg = {
          ts: Date.now(), from: payload?.from || 'node', to: payload?.to || 'me',
          text: payload.text, channel: payload?.channel ?? 0, outgoing: false, status: 'rx'
        };
        addMessage(msg); appendMessage(msg);
      }
    }
  });

  // Restore messages
  (await listMessages()).reverse().forEach(appendMessage);
  renderNodes(await listNodes());
}
boot();

// UI handlers
const methodSel = document.getElementById('connectMethod');
const ipField = document.getElementById('ipAddress');
document.getElementById('btnConnect').addEventListener('click', async ()=>{
  try{
    const method = methodSel.value;
    const address = ipField.value.trim();
    await mesh.connect(method, { address });
    setConnected(true);
  }catch(e){
    alert('Connect failed: ' + e.message);
    setConnected(false);
  }
});

document.getElementById('btnDisconnect').addEventListener('click', async ()=>{
  try{ await mesh.disconnect(); }catch{}
  setConnected(false);
});

document.getElementById('btnBlink').addEventListener('click', async ()=>{
  try{ await mesh.blinkLED(); }catch(e){ alert('Blink failed: '+e.message); }
});
document.getElementById('btnRestart').addEventListener('click', async ()=>{
  if(confirm('Restart device?')){
    try{ await mesh.restartDevice(); }catch(e){ alert('Restart failed: '+e.message); }
  }
});

document.getElementById('btnSend').addEventListener('click', async ()=>{
  const text = document.getElementById('message').value;
  const dest = document.getElementById('destNode').value || 'broadcast';
  const channel = Number(document.getElementById('channel').value) || 0;
  const wantAck = true;
  const msg = { ts: Date.now(), from:'me', to: dest, text, channel, outgoing: true, status:'tx-queued' };
  appendMessage(msg);
  await addMessage(msg);
  try{
    await mesh.sendText({ text, destination: dest, channel, wantAck });
    msg.status = 'tx-sent';
  }catch(e){
    msg.status = 'tx-error';
    alert('Send failed (queued offline): ' + e.message);
  }
});

document.getElementById('btnSaveDraft').addEventListener('click', async ()=>{
  const text = document.getElementById('message').value;
  if(!text.trim()) return;
  await addDraft({ ts: Date.now(), text });
  alert('Saved for offline send.');
});

document.getElementById('btnGPS').addEventListener('click', async ()=>{
  try{
    const pos = await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy:true }));
    const { latitude:lat, longitude:lon } = pos.coords;
    await mesh.sharePosition(lat, lon);
    upsertNodeMarker({ id:'me', lat, lon, name:'Me' });
  }catch(e){ alert('GPS failed: '+e.message); }
});

document.getElementById('btnBreadcrumb').addEventListener('click', ()=>{
  startBreadcrumb();
  navigator.geolocation.watchPosition((pos)=>{
    const { latitude:lat, longitude:lon } = pos.coords;
    addBreadcrumbPoint(lat, lon);
  }, (e)=>console.warn('breadcrumb gps', e), { enableHighAccuracy:true, maximumAge:10000, timeout:20000 });
});

document.getElementById('mbtilesFile').addEventListener('change', async (e)=>{
  const file = e.target.files?.[0];
  await loadMBTiles(file);
});

// Emergency buttons
function buildEmergencyText(kind, includeGPS){
  const base = {
    SOS: '[SOS] Emergency broadcast — NEED HELP NOW',
    MEDICAL: '[MEDICAL] Medical emergency — require assistance',
    RESCUE: '[RESCUE] Lost/Rescue needed',
    DISASTER: '[ALERT] Natural disaster warning'
  }[kind] || '[ALERT]';
  return base;
}

async function sendEmergency(kind){
  const include = document.getElementById('includeGPS').checked;
  const channel = 0;
  let text = buildEmergencyText(kind, include);
  try{
    if(include && navigator.geolocation){
      const pos = await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy:true }));
      const lat = pos.coords.latitude.toFixed(5), lon = pos.coords.longitude.toFixed(5);
      text += ` | GPS ${lat},${lon}`;
      // also share position on the mesh
      await mesh.sharePosition(pos.coords.latitude, pos.coords.longitude);
    }
  }catch{}
  await mesh.sendText({ text, destination:'broadcast', channel, wantAck:true, priority:'emergency' });
  appendMessage({ ts:Date.now(), from:'me', to:'broadcast', text, channel, outgoing:true, status:'tx-sent' });
}

document.querySelectorAll('.sos').forEach(btn=>btn.addEventListener('click', (e)=>{
  const kind = e.currentTarget.getAttribute('data-type');
  sendEmergency(kind);
}));

// Distance calculator: click two nodes in the list to compute distance
let lastClicked = null;
document.getElementById('nodes').addEventListener('click', async (e)=>{
  const item = e.target.closest('li');
  if(!item) return;
  const nameText = item.textContent;
  const idMatch = nameText.match(/\(([^)]+)\)\s*$/);
  if(!idMatch) return;
  const id = idMatch[1];
  const nodes = await db.nodes.toArray();
  const node = nodes.find(n=>n.id===id);
  if(!node?.lat || !node?.lon) return;
  if(!lastClicked){ lastClicked = node; return; }
  showDistance(lastClicked, node);
  lastClicked = null;
});


// Config buttons
const out = document.getElementById('configOut');
document.getElementById('btnGetStats').addEventListener('click', async ()=>{
  try{ out.textContent = JSON.stringify(await mesh.getStatistics(), null, 2); }catch(e){ out.textContent = 'Error: '+e.message; }
});
document.getElementById('btnGetNetworks').addEventListener('click', async ()=>{
  try{ out.textContent = JSON.stringify(await mesh.connection.getNetworks?.(), null, 2); }catch(e){ out.textContent = 'Error: '+e.message; }
});
document.getElementById('btnGetSPIFFS').addEventListener('click', async ()=>{
  try{ out.textContent = JSON.stringify(await mesh.connection.getSPIFFS?.(), null, 2); }catch(e){ out.textContent = 'Error: '+e.message; }
});
