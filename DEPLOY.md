# Deploying ConnectTa (static)

## GitHub Pages (recommended)
1. Create a new repo and push this folder.
2. In repo settings → Pages → Deploy from branch → `main` → `/` (root).
3. Ensure Pages domain is HTTPS. Web Bluetooth requires HTTPS.

## Netlify / Cloudflare Pages / Vercel
- Drag-and-drop this folder to your host. Ensure `index.html` is root and `sw.js` is served at `/sw.js`.

## Custom server
- Serve files over HTTPS. Example (Node / http-server):
```
npx http-server -S -C cert.pem -K key.pem -p 443 .
```

> Important: Ensure your `/packages` path contains the Meshtastic JS library and your import map in `index.html` points to the correct entry module, e.g. `/packages/js/index.js`.
