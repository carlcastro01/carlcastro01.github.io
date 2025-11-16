// Small geodesy helpers (Haversine + bearing)
export function haversineMeters(a, b){
  const R = 6371000;
  const toRad = (d)=>d*Math.PI/180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat/2), sinDLon = Math.sin(dLon/2);
  const h = sinDLat*sinDLat + Math.cos(lat1)*Math.cos(lat2)*sinDLon*sinDLon;
  return 2*R*Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDegrees(a, b){
  const toRad = (d)=>d*Math.PI/180, toDeg=(r)=>r*180/Math.PI;
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat), dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon)*Math.cos(lat2);
  const x = Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export const sleep = (ms)=> new Promise(res=>setTimeout(res, ms));

export function fmtMeters(m){
  if(m<1000) return `${Math.round(m)} m`;
  return `${(m/1000).toFixed(2)} km`;
}
