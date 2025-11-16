/*
 * ConnectTa application script
 *
 * This module provides the core logic for the ConnectTa emergency
 * communication client. It handles Meshtastic device connectivity via
 * Web Serial, Web Bluetooth, and HTTP (WiFi), displays incoming
 * messages, sends outbound messages, and renders a live map of node
 * positions. Messages are persisted to IndexedDB so that conversation
 * history remains available offline. The service worker manages
 * offline caching of assets and map tiles.
 */

// Import Meshtastic JS libraries from a CDN. Using esm.sh ensures
// browser-friendly ES modules are delivered. These imports occur at
// module scope so that they are fetched once and cached by the
// service worker. If a future version of the API changes, adjust
// these import specifiers accordingly.
// Note: Avoid eagerly importing the Meshtastic libraries at module scope.
// Importing modules from a remote CDN on insecure origins (file://) causes
// the entire script to fail. Instead, load these modules on demand in
// the connect functions. See connectSerial(), connectBluetooth() and
// connectWifi() below for dynamic imports.
let MeshDevice, WebSerialTransport, WebBluetoothTransport, HttpTransport;

// DOM elements
const statusEl = document.getElementById('connection-status');
const batteryEl = document.getElementById('battery-level');
const messagesEl = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

// Connection buttons
document.getElementById('connect-serial').addEventListener('click', connectSerial);
document.getElementById('connect-bluetooth').addEventListener('click', connectBluetooth);
document.getElementById('connect-wifi').addEventListener('click', connectWifi);

// Emergency buttons
document.getElementById('sos-btn').addEventListener('click', () => sendPriorityMessage('SOS'));
document.getElementById('medical-btn').addEventListener('click', () => sendPriorityMessage('MEDICAL'));
document.getElementById('lost-btn').addEventListener('click', () => sendPriorityMessage('LOST'));
document.getElementById('disaster-btn').addEventListener('click', () => sendPriorityMessage('DISASTER'));

// IndexedDB setup
let dbPromise;
function initDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('connectta-db', 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('messages')) {
        db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

async function saveMessage(msg) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readwrite');
    tx.objectStore('messages').put(msg);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllMessages() {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readonly');
    const store = tx.objectStore('messages');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Application state
let meshDevice = null;
let currentTransport = null;
let unsentQueue = [];

// Leaflet map and marker data
let map;
const nodeMarkers = {}; // { nodeId: marker }
const breadcrumbs = {}; // { nodeId: [latlng] }

// Initialize the map
function initMap() {
  map = L.map('map');
  // Center map at an arbitrary starting point; will adjust when nodes update
  map.setView([0, 0], 2);
  // Add OSM tile layer. If tiles fail to load (offline), show a simple
  // notification in the map container. Leaflet emits a 'tileerror' event
  // when a tile fetch fails.
  const layer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  });
  layer.on('tileerror', () => {
    // Only add notice once
    if (!map._offlineNotice) {
      const notice = L.control({ position: 'bottomleft' });
      notice.onAdd = function () {
        const div = L.DomUtil.create('div', 'offline-notice');
        div.style.background = 'rgba(12, 1, 45, 0.8)';
        div.style.color = '#ECC440';
        div.style.padding = '0.5rem';
        div.style.fontSize = '0.9rem';
        div.innerText = 'Map tiles cannot be loaded. You may be offline.';
        return div;
      };
      notice.addTo(map);
      map._offlineNotice = true;
    }
  });
  layer.addTo(map);
}

// Update connection status text
function updateStatus(text) {
  statusEl.textContent = text;
}

// Add a message element to the UI
function appendMessage({ id, text, from, timestamp, priority, self }) {
  const msgEl = document.createElement('div');
  msgEl.classList.add('message');
  msgEl.classList.add(self ? 'sent' : 'received');
  if (priority) msgEl.classList.add('priority');
  msgEl.innerHTML = `
    <div class="content">${text}</div>
    <div class="meta">${from ? from : 'You'} · ${new Date(timestamp).toLocaleTimeString()}</div>
  `;
  messagesEl.appendChild(msgEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Send a regular text message
async function sendTextMessage() {
  const text = messageInput.value.trim();
  if (!text) return;
  const msg = {
    text,
    timestamp: Date.now(),
    priority: false,
    from: null,
    self: true,
  };
  // Optimistically add to UI and database
  appendMessage({ ...msg, id: undefined });
  await saveMessage(msg);
  messageInput.value = '';
  // Attempt to send over the mesh
  if (meshDevice) {
    try {
      await meshDevice.sendText(text);
    } catch (err) {
      // Queue unsent message if sending fails
      unsentQueue.push(msg);
    }
  } else {
    // No device connected; queue message
    unsentQueue.push(msg);
  }
}

// Send a priority alert message
async function sendPriorityMessage(type) {
  const alertMap = {
    SOS: '🚨 SOS: Emergency assistance needed! ',
    MEDICAL: '🩺 Medical emergency! ',
    LOST: '🧭 Lost/rescue required! ',
    DISASTER: '🌋 Natural disaster warning! ',
  };
  const text = alertMap[type] || `${type}:`;
  const msg = {
    text,
    timestamp: Date.now(),
    priority: true,
    from: null,
    self: true,
  };
  appendMessage(msg);
  await saveMessage(msg);
  if (meshDevice) {
    try {
      await meshDevice.sendText(text);
    } catch (err) {
      unsentQueue.push(msg);
    }
  } else {
    unsentQueue.push(msg);
  }
}

// Handle incoming messages from the mesh device
function handleIncomingMessage(data) {
  // Data structure depends on the Meshtastic JS library. We expect
  // `data` to contain at least a `text` field and optional `from` and
  // `rxTime` properties. This handler is robust against unknown
  // formats.
  const text = data.text || JSON.stringify(data);
  const timestamp = data.rxTime ? data.rxTime * 1000 : Date.now();
  const from = data.from || 'Node';
  const msg = {
    text,
    timestamp,
    priority: false,
    from,
    self: false,
  };
  appendMessage(msg);
  saveMessage(msg);
}

// Update battery indicator
function updateBattery(status) {
  if (!status || typeof status.batteryLevel === 'undefined') {
    batteryEl.textContent = '';
    return;
  }
  const level = status.batteryLevel;
  batteryEl.textContent = `Battery: ${level}%`;
}

// Update a node’s position on the map
function updateNodePosition(nodeId, lat, lon) {
  const latLng = [lat, lon];
  if (!nodeMarkers[nodeId]) {
    // Create new marker with popup
    const marker = L.marker(latLng).addTo(map);
    marker.bindPopup(`Node ${nodeId}`);
    nodeMarkers[nodeId] = marker;
    breadcrumbs[nodeId] = [];
  } else {
    nodeMarkers[nodeId].setLatLng(latLng);
  }
  // Zoom to include this marker if map view is still at world scale
  if (map.getZoom() < 4) {
    map.setView(latLng, 13);
  }
  // Add to breadcrumb trail
  breadcrumbs[nodeId].push(latLng);
  // Draw/update polyline for this node
  if (breadcrumbs[nodeId].length > 1) {
    // Remove previous polyline layer if exists
    if (nodeMarkers[nodeId].breadcrumb) {
      map.removeLayer(nodeMarkers[nodeId].breadcrumb);
    }
    const polyline = L.polyline(breadcrumbs[nodeId], { color: '#ECC440' }).addTo(map);
    nodeMarkers[nodeId].breadcrumb = polyline;
  }
}

// Subscribe to device events after connection
function subscribeToDevice() {
  if (!meshDevice) return;
  // Clear existing listeners by creating new instance of events? (Not documented yet)
  try {
    const events = meshDevice.events;
    // Listen for text/packet events. The Meshtastic library exposes
    // rich event types; fallback to generic handling if names differ.
    ['text', 'meshPacket', 'message'].forEach((eventName) => {
      if (events?.on) {
        events.on(eventName, handleIncomingMessage);
      }
    });
    // Listen for device status updates (battery, etc.)
    if (events?.on) {
      events.on('deviceStatus', updateBattery);
    }
    // Listen for position updates
    if (events?.on) {
      events.on('position', (pos) => {
        if (pos && pos.id && pos.latitude != null && pos.longitude != null) {
          updateNodePosition(pos.id, pos.latitude, pos.longitude);
        }
      });
    }
  } catch (err) {
    console.error('Error subscribing to events:', err);
  }
  // Attempt to send any unsent queued messages
  if (unsentQueue.length) {
    unsentQueue.forEach(async (msg) => {
      try {
        await meshDevice.sendText(msg.text);
        msg.sent = true;
      } catch {
        // remain in queue
      }
    });
    unsentQueue = unsentQueue.filter((m) => !m.sent);
  }
}

// Device connection functions
async function connectSerial() {
  // Ensure secure context before attempting Web Serial. Most Web APIs
  // require HTTPS or localhost; if not secure, show a helpful message.
  if (!window.isSecureContext) {
    alert(
      'Web Serial is only available over HTTPS or on localhost.\n' +
        'Please serve this app via a local web server (e.g. python -m http.server) or deploy it over HTTPS.'
    );
    return;
  }
  if (!('serial' in navigator)) {
    alert('Web Serial API not supported in this browser.');
    return;
  }
  updateStatus('Connecting via USB…');
  try {
    // Dynamically import Meshtastic classes if not already loaded
    if (!WebSerialTransport) {
      const core = await import('https://esm.sh/@meshtastic/core?target=esnext');
      const serial = await import('https://esm.sh/@meshtastic/transport-web-serial?target=esnext');
      MeshDevice = core.MeshDevice;
      WebSerialTransport = serial.WebSerialTransport;
    }
    const port = await navigator.serial.requestPort();
    currentTransport = new WebSerialTransport({ port });
    meshDevice = new MeshDevice(currentTransport);
    await meshDevice.connect();
    updateStatus('Connected via USB');
    subscribeToDevice();
  } catch (err) {
    console.error(err);
    updateStatus('USB connection failed');
  }
}

async function connectBluetooth() {
  if (!window.isSecureContext) {
    alert(
      'Web Bluetooth is only available over HTTPS or on localhost.\n' +
        'Please serve this app via a local web server (e.g. python -m http.server) or deploy it over HTTPS.'
    );
    return;
  }
  if (!('bluetooth' in navigator)) {
    alert('Web Bluetooth API not supported in this browser.');
    return;
  }
  updateStatus('Connecting via Bluetooth…');
  try {
    // Dynamically import Meshtastic classes if not already loaded
    if (!WebBluetoothTransport) {
      const core = await import('https://esm.sh/@meshtastic/core?target=esnext');
      const bluetooth = await import('https://esm.sh/@meshtastic/transport-web-bluetooth?target=esnext');
      MeshDevice = core.MeshDevice;
      WebBluetoothTransport = bluetooth.WebBluetoothTransport;
    }
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [],
    });
    currentTransport = new WebBluetoothTransport({ device });
    meshDevice = new MeshDevice(currentTransport);
    await meshDevice.connect();
    updateStatus('Connected via Bluetooth');
    subscribeToDevice();
  } catch (err) {
    console.error(err);
    updateStatus('Bluetooth connection failed');
  }
}

async function connectWifi() {
  const host = prompt('Enter the IP address of your Meshtastic device:');
  if (!host) return;
  updateStatus('Connecting via Wi‑Fi…');
  try {
    // Dynamically import Meshtastic classes if not already loaded
    if (!HttpTransport) {
      const core = await import('https://esm.sh/@meshtastic/core?target=esnext');
      const http = await import('https://esm.sh/@meshtastic/transport-http?target=esnext');
      MeshDevice = core.MeshDevice;
      HttpTransport = http.HttpTransport;
    }
    currentTransport = new HttpTransport({ host });
    meshDevice = new MeshDevice(currentTransport);
    await meshDevice.connect();
    updateStatus('Connected via Wi‑Fi');
    subscribeToDevice();
  } catch (err) {
    console.error(err);
    updateStatus('Wi‑Fi connection failed');
  }
}

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('service-worker.js')
    .catch((err) => console.error('Service worker registration failed:', err));
}

// Load existing messages from IndexedDB on startup
async function loadStoredMessages() {
  const msgs = await getAllMessages();
  msgs.sort((a, b) => a.timestamp - b.timestamp);
  msgs.forEach((m) => appendMessage(m));
}

// Attach form handler
messageForm.addEventListener('submit', (event) => {
  event.preventDefault();
  sendTextMessage();
});

// Initialize the database and map on page load
window.addEventListener('DOMContentLoaded', async () => {
  // If the site is not served over HTTPS or localhost, many Web APIs (Serial,
  // Bluetooth, service workers) will be unavailable. Inform the user early.
  if (!window.isSecureContext) {
    updateStatus('Insecure context');
    // Display a notice overlay on the map about secure contexts. Many Web APIs
    // (Serial, Bluetooth, service workers) are disabled under the file:// scheme.
    const mapContainer = document.getElementById('map');
    if (mapContainer) {
      const overlay = document.createElement('div');
      overlay.style.position = 'absolute';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.right = '0';
      overlay.style.bottom = '0';
      overlay.style.backgroundColor = 'rgba(12, 1, 45, 0.9)';
      overlay.style.color = '#ECC440';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.padding = '1rem';
      overlay.style.textAlign = 'center';
      overlay.style.zIndex = '1000';
      overlay.innerText =
        'This app is running from the file:// protocol. Device connections, service workers and map tiles require HTTPS or http://localhost.\n\nPlease host this directory using a local web server (for example `python -m http.server`) or deploy it over HTTPS for full functionality.';
      // Ensure the map container is positioned relative so the overlay is positioned correctly
      mapContainer.style.position = 'relative';
      mapContainer.appendChild(overlay);
    }
  }
  dbPromise = initDatabase();
  initMap();
  await loadStoredMessages();
});