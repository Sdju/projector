# @ai-projector/hub

Projector Hub: one web origin for several Projector devices. Hub keeps the shared interface and tunnels browser requests to each connected device, so a browser only needs access to the Hub.

## Install

```bash
npm install -g @ai-projector/hub
PROJECTOR_HUB_PASSWORD='<browser password>' \
PROJECTOR_HUB_DEVICE_TOKEN='<device token>' \
projector-hub
```

The browser password and the device token must differ. Hub listens on `127.0.0.1:4180` by default; set `PROJECTOR_HUB_HOST`, `PROJECTOR_HUB_PORT` and `PROJECTOR_HUB_ORIGIN` for a public origin. A remote origin requires HTTPS terminated by a reverse proxy that keeps the original Host and supports WebSocket and SSE.

Then open <http://localhost:4180>, sign in and add the Hub in Projector **Settings → Hub** with the same URL, device id and token. Projects, files, terminals and agents stay on the connected devices.

Requirements: Node.js 24.11–24.x. Hub does not need GTK or a build toolchain.
