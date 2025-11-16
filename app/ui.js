export function setConnected(connected){
  const pill = document.getElementById('connStatus');
  pill.textContent = connected ? 'Connected' : 'Disconnected';
  pill.classList.toggle('pill--connected', connected);
  pill.classList.toggle('pill--disconnected', !connected);
}

export function setBattery(pct){
  const el = document.getElementById('battery');
  el.textContent = (pct==null) ? '--%' : `${Math.round(pct)}%`;
}

export function appendMessage({outgoing, from, to, text, ts}){
  const t = document.getElementById('thread');
  const row = document.createElement('div');
  row.className = `msg ${outgoing?'msg--out':''}`;
  row.innerHTML = `<div class="msg__bubble">${text}</div><div class="msg__meta">${from||'me'} → ${to||'broadcast'} • ${new Date(ts).toLocaleTimeString()}</div>`;
  t.appendChild(row);
  t.scrollTop = t.scrollHeight;
}

export function renderNodes(nodes){
  const ul = document.getElementById('nodes');
  ul.innerHTML = '';
  nodes.forEach(n=>{
    const li = document.createElement('li');
    li.innerHTML = `<span><b>${n.name||n.id}</b> <span class="label">(${n.id})</span></span><span class="label">${n.battery!=null?`${n.battery}%`:''}</span>`;
    ul.appendChild(li);
  });
}
