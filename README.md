# DVI Heatpump Desktop App

Windows desktop shell for the DVI Heatpump experience. The target architecture is a thin Electron wrapper around a browser window, with all device discovery, pairing, tunnel refresh, and secure token handling kept in the desktop main process.

## Scope

This repository starts with the desktop shell and the parity contract for matching the existing iOS app behavior:

- discover the local DVI bridge on the home network
- fetch a token with `POST /pair`
- refresh tunnel metadata with `GET /api/tunnel`
- store tokens securely in the Windows credential store
- attach `Authorization: Bearer <token>` when requests go through the remote tunnel

## Initial Layout

```text
.
|-- .github/
|   `-- copilot-instructions.md
|-- docs/
|   `-- ios-parity.md
|-- src/
|   |-- main/
|   |   |-- bridgeDiscovery.ts
|   |   |-- main.ts
|   |   |-- pairing.ts
|   |   |-- secureStore.ts
|   |   `-- tunnel.ts
|   |-- preload/
|   |   `-- index.ts
|   |-- renderer/
|   |   |-- index.html
|   |   |-- main.ts
|   |   `-- styles.css
|   `-- shared/
|       `-- runtime.ts
|-- electron.vite.config.ts
|-- package.json
`-- tsconfig.json
```

## Architectural Direction

- `src/main/` owns discovery, pairing, tunnel refresh, auth, and persistence.
- `src/preload/` exposes a narrow, typed bridge to the renderer.
- `src/renderer/` stays a thin web UI layer and should not hold secrets.
- `docs/ios-parity.md` is the current parity contract and should be updated when the iOS behavior is verified in more detail.

## Getting Started

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Start the shell with `npm run dev`.

## Windows Installer Output

The intended Windows deliverable is a standard `.exe` installer generated with `electron-builder` using the NSIS target.

The build resources include a custom NSIS `multiUser.nsh` override so all-users installs default to the native `Program Files` location on ARM64 Windows instead of falling back to `Program Files (x86)`.

- `npm run build` compiles the Electron app into `dist/`.
- `npm run dist:win` builds both `x64` and `arm64` Windows installers into `release/`.
- `npm run dist:win:x64` builds only the `x64` installer.
- `npm run dist:win:arm64` builds only the `arm64` installer.
- The expected installable artifacts are `.exe` files similar to `release/DVI Heatpump Setup <version>-x64.exe` and `release/DVI Heatpump Setup <version>-arm64.exe`.

The packaged installer bundles the Electron runtime, so the end user does not need Node.js installed on the target Windows machine.

## Runtime Flow

The current implementation keeps connection logic in the Electron main process:

- local bridge discovery checks configured bridge URLs first, then browses for `_dvi-bridge._tcp` over Bonjour/mDNS on the local network
- a manual bridge URL override can be saved in the app UI for VPN cases where automatic local discovery is not the right choice
- when a local bridge is found, the desktop shell automatically refreshes the token with `POST /pair` and stores it with `keytar`
- tunnel refresh calls `GET /api/tunnel` and prefers `Authorization: Bearer <token>` when a stored token is available
- the last successful tunnel URL is cached in the app data directory so remote mode can still be selected when the bridge is no longer reachable
- the renderer only receives a connection snapshot and pairing/refresh commands through preload IPC

## Useful Environment Overrides

- `DVI_BRIDGE_URL` or `DVI_BRIDGE_URLS`: explicitly set one or more candidate local bridge URLs
- `DVI_BRIDGE_PORT`: override the default local bridge port used when normalizing local manual bridge URLs
- `DVI_BRIDGE_PROTOCOL`: choose `http` or `https` for generated local bridge URLs
- `DVI_BRIDGE_DISCOVERY_PATH`: override the primary bridge-specific probe path used to test whether a bridge is reachable
- `DVI_BRIDGE_DISCOVERY_PATHS`: override or extend the list of bridge-specific probe paths used during discovery
- `DVI_BRIDGE_DISCOVERY_TIMEOUT_MS`: adjust the per-host probe timeout
- `DVI_BRIDGE_DISCOVERY_CONCURRENCY`: adjust how many resolved discovery candidates are probed in parallel
- `DVI_BRIDGE_DISCOVERY_WINDOW_MS`: adjust how long Bonjour discovery listens for `_dvi-bridge._tcp` services before falling back
- `DVI_BRIDGE_MDNS_SERVICE_TYPE`: override the Bonjour service type name if the bridge advertises a different `_type._tcp` service
- `DVI_PAIR_PATH` or `DVI_PAIR_PATHS`: override or extend the pair endpoint path candidates when the bridge does not expose `POST /pair` at the root
- `DVI_TUNNEL_PATH` or `DVI_TUNNEL_PATHS`: override or extend the tunnel endpoint path candidates when the bridge does not expose `GET /api/tunnel`
- `DVI_DISABLE_HARDWARE_ACCELERATION`: set to `0` to re-enable Chromium GPU acceleration if you want to compare rendering behavior

The discovery implementation now follows the iOS app's Bonjour model for local bridge discovery and keeps the manual override as an explicit fallback.

## Next Build Steps

1. Implement local bridge discovery with the same strategy the iOS app uses.
2. Add pairing, secure token storage, and tunnel refresh services in `src/main/`.
3. Define IPC contracts for connection state, pairing state, and remote tunnel usage.
4. Confirm the desktop flow against the actual iOS app and tighten `docs/ios-parity.md`.
