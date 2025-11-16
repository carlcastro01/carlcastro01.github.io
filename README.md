# ConnectTa — Meshtastic Emergency Web Client

A static, offline-first PWA for emergency-ready messaging with Meshtastic devices.
- **Transports**: Web Serial, Web Bluetooth, WiFi/HTTP
- **Features**: Real-time text, SOS quick-casts, GPS share, breadcrumbs, battery, map with offline .mbtiles, distance/bearing, IndexedDB offline storage.
- **Design**: Dark, high contrast, battery-friendly; large touch targets; mobile-first.

## How to run

1. Place your Meshtastic JavaScript **packages** into `./packages` and map `@meshtastic/js` in `index.html`'s import map.
   - Example mapping (default in this repo):
   ```json
   { "imports": { "@meshtastic/js": "/packages/js/index.js" } }
   ```
   If you publish or vendor the library differently, adjust that path accordingly.

2. (Optional but recommended) Vendor Leaflet & MBTiles plugin for complete offline maps. See `vendor/README.txt`.

3. Serve as a static site **over HTTPS** (required for Web Bluetooth and recommended for Web Serial).
   - During local development you can use: `npx http-server -S -C cert.pem -K key.pem` or deploy to GitHub Pages / Netlify.

4. On first load, the PWA service worker will cache the app shell. Use the app at `https://your-domain` and install as an app on mobile.

## Emergency quick actions
- **SOS, Medical, Rescue, Disaster** send pre-tagged broadcast text messages and (optionally) your GPS. They also push a `POSITION` packet when GPS is enabled.

## Offline message storage
- Messages are persisted in IndexedDB. If sending fails, drafts/outbox can be retried on next connection.

## Map / Offline tiles
- Click **Load offline .mbtiles** to select a local tileset. The plugin reads the file client-side; no server needed.

## Security & Safety
- Change your device’s Bluetooth fixed PIN from the default and prefer HTTPS for WiFi mode.
- Be mindful that SOS broadcasts travel to the entire mesh; test with caution.

## Building to production
- This is a static site — deploy the folder to any static host.
- Ensure `/packages` contains a compatible `@meshtastic/js` build (2.5+).

## License
- You own your changes. Dependencies retain their respective licenses.
