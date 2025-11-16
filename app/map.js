import * as L from 'leaflet';
import { haversineMeters, bearingDegrees, fmtMeters } from './utils.js';

let map, markers = new Map(), breadcrumb = null, breadcrumbCoords = [];
let mbtilesLayer = null;

export function initMap(){
  map = L.map('map', { zoomControl: true, attributionControl: false }).setView([0,0], 2);
  // Default base: OSM (will be cached by SW; can be used offline once cached)
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, crossOrigin: false
  });
  osm.addTo(map);
  return map;
}

// Add or update a node marker
export function upsertNodeMarker(node){
  if(!node?.lat || !node?.lon) return;
  const id = node.id;
  const pos = [node.lat, node.lon];
  let m = markers.get(id);
  if(!m){
    m = L.marker(pos, { title: node.name||id });
    m.addTo(map);
    markers.set(id, m);
  }else{
    m.setLatLng(pos);
  }
  m.bindPopup(`<b>${node.name||id}</b><br>lat ${node.lat.toFixed(5)}, lon ${node.lon.toFixed(5)}<br>${node.battery!=null?`Battery: ${node.battery}%`:''}`);
}

// Track breadcrumb locally
export function startBreadcrumb(){
  if(breadcrumb){
    breadcrumb.setLatLngs([]);
    breadcrumbCoords = [];
  }else{
    breadcrumb = L.polyline([], { weight: 3 }).addTo(map);
  }
}
export function addBreadcrumbPoint(lat, lon){
  breadcrumbCoords.push([lat, lon]);
  breadcrumb?.setLatLngs(breadcrumbCoords);
}

// Distance/bearing helper (display between two nodes)
export function showDistance(a, b){
  if(!a || !b) return;
  const A = {lat:a.lat, lon:a.lon}, B = {lat:b.lat, lon:b.lon};
  const d = haversineMeters(A, B);
  const brg = bearingDegrees(A, B);
  document.getElementById('distance').textContent = `Distance ${fmtMeters(d)} | Bearing ${Math.round(brg)}°`;
}

// Optional: load offline MBTiles chosen by the user
export async function loadMBTiles(file){
  if(!file) return;
  // Dynamically import the plugin only when needed
  try{
    const { default: MBTiles } = await import('leaflet-mbtiles');
    const arrayBuffer = await file.arrayBuffer();
    if(mbtilesLayer) map.removeLayer(mbtilesLayer);
    mbtilesLayer = new MBTiles(arrayBuffer, { minZoom: 0, maxZoom: 19 });
    mbtilesLayer.addTo(map);
  }catch(e){
    console.error('Failed to load MBTiles plugin', e);
    alert('Failed to load .mbtiles (check that /vendor/leaflet-tilelayer-mbtiles-ts and /vendor/sql.js are present).');
  }
}
