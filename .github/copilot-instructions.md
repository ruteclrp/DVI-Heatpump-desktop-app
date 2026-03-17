# DVI Heatpump Desktop App Instructions

## Product intent

- Keep this app a thin Windows desktop shell around a browser-based UI.
- Match the existing iOS app behavior before introducing desktop-only features.
- Treat `docs/ios-parity.md` as the source of truth for parity-sensitive behavior.

## Architecture

- Keep bridge discovery, pairing, tunnel refresh, and token storage in the Electron main process.
- Use the preload layer as the only bridge between renderer and privileged desktop APIs.
- Do not let the renderer access raw tokens, credential storage, or unrestricted networking.
- Prefer small, typed IPC contracts in `src/shared/`.

## Networking and auth

- Prefer the local bridge when it is reachable on the home network.
- Use `POST /pair` to obtain the token and `GET /api/tunnel` to refresh remote tunnel metadata.
- Only attach `Authorization: Bearer <token>` when the remote tunnel is being used.
- Centralize retry, refresh, and connectivity decisions so renderer code stays stateless.

## Security

- Store tokens in the Windows credential store or another OS-backed secure store, never in plaintext files.
- Avoid logging tokens, pairing secrets, or full authenticated URLs.
- Keep any future HTTP clients in the main process unless there is a strong reason not to.

## Implementation style

- Use TypeScript throughout the desktop shell.
- Favor small modules with explicit responsibility over large service files.
- Add tests for protocol and state-transition logic before adding UI polish.