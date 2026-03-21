# iOS Parity Notes

## Goal

The Windows desktop app should reproduce the connection behavior of the existing iOS DVI Heatpump app while using a desktop shell architecture.

## Required parity points

| Area | Expected behavior |
| --- | --- |
| Local discovery | Find the DVI bridge on the same home network before attempting remote access. |
| Pairing | Fetch a token with `POST /pair`. |
| Tunnel refresh | Refresh remote tunnel metadata with `GET /api/tunnel`. |
| Secret storage | Persist the token in OS-backed secure storage. |
| Remote auth | Send `Authorization: Bearer <token>` when requests go through the remote tunnel. |
| Shell model | Present the product in a browser window hosted by the desktop app. |

## Proposed desktop mapping

| iOS responsibility | Desktop responsibility |
| --- | --- |
| Reachability and local network access | Electron main-process discovery service |
| Keychain token persistence | Windows credential-backed secure store |
| App lifecycle refresh points | Main-process refresh service wired to app start, resume, and connectivity changes |
| Web presentation | BrowserWindow + preload bridge |

## Assumptions to verify against the iOS app

1. The exact discovery mechanism used by iOS has not yet been copied into this repo.
2. The expected token lifetime and tunnel refresh cadence are not yet documented.
3. The desktop app should prefer the local bridge over the remote tunnel whenever both are available.
4. Any renderer-facing status should be derived from main-process state, not from ad hoc browser requests.

## Current desktop implementation note

The desktop implementation now uses configured bridge URLs plus Bonjour discovery for `_dvi-bridge._tcp` as the local-network discovery path, matching the current iOS app more closely than the earlier subnet-probing approximation.
When a local bridge is discovered, the desktop shell also refreshes token and tunnel metadata automatically in the main process instead of exposing manual pairing in the renderer.

## First implementation slices

1. Implement and validate local bridge discovery.
2. Add pairing and secure token storage.
3. Add tunnel refresh and remote-request auth.
4. Mirror the iOS fallback order between local bridge and remote tunnel.

## Open questions

1. Does the iOS app use mDNS, SSDP, a fixed subnet probe, or another discovery method?
2. Is the `/pair` token long-lived, refreshable, or regenerated per device/app install?
3. What events trigger `GET /api/tunnel` on iOS: launch, foreground, explicit retry, periodic polling, or all of them?
4. Are there additional headers, device identifiers, or error-handling rules required for parity?