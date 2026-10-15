# Browser terminal transport

Projector uses a **SharedWorker**, not a Service Worker, to share terminal connections between
browser tabs on the same origin. One WebSocket carries project control channels and one carries
terminal screen channels. Vite's development HMR connection remains separate.

Each terminal view has its own logical channel, screen snapshot, ACK accounting and lifecycle.
Unsubscribing a view or closing a browser tab does not stop its PTY. Different views of one PTY
retain independent ACK accounting, as with the legacy transport. A slow view can pause that PTY;
it does not pause other terminal sessions.

The server schedules output channels fairly and splits output into small frames. Control traffic
has a separate physical connection. Both transports preserve the existing origin/LAN authentication,
heartbeat, input validation and screen restore behavior. Tokens and subscriptions live in memory;
the worker does not write browser storage.

## Compatibility and rollback

The existing `/api/terminal/control` and `/api/terminal/socket` endpoints remain available.
The new endpoint is `/api/terminal/shared?kind=control` or `kind=data`.

Browsers without SharedWorker use the legacy transport. Failure to start the worker or open an
initial channel also falls back to legacy, before sending input or mutations. SharedWorker availability
is browser/context dependent; in particular plain HTTP over a LAN may lack the required browser
capabilities. Verify the actual connection paths rather than assuming sharing is active.

Add `?terminalTransport=legacy` to a project page to force the old transport for that page.
Reload to select a transport. Existing loaded pages are not migrated in place.

After an established connection is lost, existing control/view reconnect logic resubscribes and
receives fresh screen snapshots. Input and operations whose result is unknown are never replayed.
The worker releases channels when their page closes and expires unresponsive page ports after
120 seconds. Frozen/background pages restore their subscriptions through the normal reconnect
path when they resume.

## Isolated verification

```bash
vp test run tests/terminal-shared.test.mjs tests/terminal.test.mjs tests/access-security.test.mjs
node tests/helpers/terminal-shared-server.mjs
```

The browser probe listens on loopback port 4188 with temporary projects and data. It does not run
Projector instance/tray/startup hooks and does not touch the running server on 4177. Open
`http://localhost:4188/tests/fixtures/terminal-shared.html` in several tabs. The fixture exposes
`window.probe` to open control/data channels, send commands, observe messages and pause ACKs.
`/__probe` reports current terminal socket paths. `?brokenWorker=1` tests initial fallback.
POST `/__probe/drop` to interrupt only the probe's shared connections and verify reconnect.
Set `PROBE_PRODUCTION=1 PROBE_PORT=4189` to serve the built client instead of Vite.

A full Projector UI is also served by this probe, using only its temporary projects. Terminating
the probe closes its own PTYs and removes its temporary data.

Do not copy server changes into a running `vp dev` checkout from one of its terminals: those
modules are dependencies of the Vite config, so the copy can trigger a restart and kill that terminal.
Apply the change from an external terminal after saving work in Projector's sessions.
