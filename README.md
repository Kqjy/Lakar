# Lakar

A hand-drawn whiteboard in the spirit of Excalidraw, with the cloud features built in: unlimited scenes and folders, synced to **your own server**, end-to-end encrypted. Draw anywhere, on any device, and the server never sees anything but ciphertext.

## Features

- Hand-drawn feel: rectangles, diamonds, ellipses, arrows, lines, freehand ink, and text with adjustable sloppiness, fill hatching, stroke styles, edges, and opacity
- Full editor: multi-select, move/resize/rotate, groups, lock, z-ordering, copy/paste, duplicate, eraser, undo/redo, infinite canvas with pan and zoom
- Multi-point lines and arrows (click to place points, Enter/double-click to finish), draggable points on selected lines
- Text with three font families (hand-drawn, normal, code), sizes, and alignment
- **Live collaboration**: share a canvas by link or behind a password, see everyone's cursors and selections, no account needed to join — and still end-to-end encrypted (see below)
- **The Satchel**: 138 ready-made hand-drawn shapes across nine packs — flowchart, boxes, arrows, marks, interface, systems, people, icons and charts — plus your own saved shapes, searchable, click or drag onto the canvas
- Light and dark themes, five canvas paper tones
- Export PNG (1–3×, clipboard supported), SVG, save/open `.lakar` files, import and export Excalidraw files
- Cloud sync: unlimited scenes and folders, autosave, offline-first with automatic retry, conflict copies instead of data loss
- Works fully offline as a guest with a local scratchpad; sign in to sync

## End-to-end encryption

- Your password never leaves the browser. PBKDF2 (600k iterations, SHA-256) derives master key material from it, then HKDF splits that into:
  - an **auth key** sent to the server in place of a password (the server scrypt-hashes it again at rest), and
  - a **key-encrypting key** that stays on your device and never touches the network.
- Your data is not encrypted with your password. A two-level hierarchy sits underneath:
  - an **Account Root Key** — random, generated once, stored only in wrapped form. Your password wraps it, and so does your recovery code.
  - one or more **data keys**, wrapped by the root key, which actually encrypt your scenes.
- Because the password only wraps the root key, **changing your password re-wraps one small blob** — nothing is re-encrypted, and your recovery code keeps working.
- Scene contents, scene titles, folder names and satchel shapes are encrypted with AES-256-GCM (fresh IV per save, deflate-compressed first) before upload, and each record is bound to its own slot with authenticated data — so the server cannot serve one record's ciphertext in another's place. The server stores only ciphertext, timestamps, and sizes.
- **Recovery code**: 120 bits, shown once at sign-up. It wraps the same root key your password does, so it can restore access and set a new password. Treat it like a password — anyone holding it has full access. Lose both it and your password and your scenes are unrecoverable; that is what zero knowledge costs.
- **Passkeys**: a passkey can wrap the root key too, using WebAuthn's `prf` extension. The authenticator returns a secret derived inside the device and never sends it to the server, so one fingerprint both signs you in and unlocks your scenes. Passwords still work — a passkey is always an addition, never the only way in.

Not every "passwordless" mechanism can do this. A key-encrypting key has to come from something the server never sees, which rules out OAuth/SSO, emailed codes and TOTP: the server knows or issues all three. Those can prove *who you are*; they cannot unlock anything. Your account is only as strong as its weakest unlock method, so Lakar only accepts ones that carry real, server-invisible entropy.

A passkey moves your key's protection from your memory to your device — and, if your passkeys sync, to your platform vendor's own encrypted store. That is still not something this server can read, but it is a different assumption than a password only you know. Use a device-bound authenticator if you would rather not make it.

## Live collaboration

Sharing a canvas opens a room on your server. The server relays opaque blobs and nothing else — it never learns the room key, the drawing, the participant names, or where anyone's cursor is.

- **Anyone with the link** — a random 256-bit key is generated in the browser and lives in the URL *fragment* (`#room=<id>,<key>`), which browsers never send to a server. Anyone with the whole link can decrypt; anyone with only the room id cannot.
- **Password protected** — no key in the link. Each participant derives the room key from the password with PBKDF2-SHA256 (320k iterations, salted with the room id). Send the password out of band.
- Both modes derive an AES-256-GCM content key and a separate **verifier** from the same material via HKDF. The verifier is what the server checks for admission, and it is stored only as a SHA-256 hash — it cannot be turned back into the key.
- Every message on the wire — element updates, cursor positions, participant names, the whole-scene handoff to a newcomer — is AES-GCM encrypted with the room key before it reaches the socket.
- Concurrent edits reconcile per element by `(version, versionNonce)`, so two people editing at once converge without a server-side merge. Deletions travel as tombstones.
- A late joiner pulls the scene from a peer. If nobody is left in the room, an encrypted snapshot on the server restores it — still ciphertext at rest. Rooms are pruned after 21 days of silence, and the host can end one for everyone at any time.
- Joining a shared canvas never touches your own scenes. When you leave, you choose whether to keep a copy.

## The Satchel

The Satchel (press <kbd>S</kbd>) is a drawer of ready-made pieces, each one built from the same elements you draw by hand — so anything you place is fully editable, recolourable and ungroupable.

- Nine built-in packs: Flowchart, Boxes, Arrows, Marks, Interface, Systems, People, Icons and Charts.
- Search across every pack by name or intent ("db", "wireframe", "retry", "milestone").
- Click a tile to drop it at the centre of the view, or drag it exactly where you want it.
- Select anything on the canvas and choose **Add to satchel** (or the panel's *Add selection*) to keep it. Your own shapes sit under **Mine**, and are encrypted before syncing like everything else.
- Export your shapes to a `.lakarsatchel` file and import them anywhere.

## Run it locally (development)

```bash
npm install
npm run dev:server   # API on http://localhost:5191
npm run dev          # app on http://localhost:5190 (proxies /api)
```

Requires Node.js 22.13+ (the server uses the built-in `node:sqlite`).

## Deploy on your server

### Docker (recommended)

```bash
docker compose up -d --build
```

The app and API are served on port 5191, with all state in the `lakar-data` volume. Put your reverse proxy (Caddy, nginx, Traefik) in front of it with HTTPS — the app requires a secure context for WebCrypto (localhost works without TLS). Live collaboration needs the proxy to pass WebSocket upgrades through to `/ws`; Caddy's `reverse_proxy` does this by default.

Caddy example:

```
draw.example.com {
    reverse_proxy localhost:5191
}
```

### Bare Node

```bash
npm install
npm run build
node server/index.js        # serves client/dist and the API on :5191
```

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5191` | HTTP port |
| `DATA_DIR` | `./data` | SQLite database + token secret location |
| `TOKEN_SECRET` | auto-generated | HMAC secret for session tokens |
| `TRUST_PROXY` | off | set `1` behind a reverse proxy so rate limiting sees real IPs |
| `LAKAR_ORIGIN` | from request | the exact origin passkeys are bound to, e.g. `https://draw.example.com` |
| `LAKAR_RP_ID` | host of origin | WebAuthn relying-party id; defaults to the origin's hostname |
| `LAKAR_INVITES` | off | set `required` to close sign-ups behind invite codes |
| `LAKAR_QUOTA_MB` | unlimited | per-account cap on stored scene data, in whole megabytes |

Back up the `DATA_DIR` folder; it contains everything (encrypted).

### Restricting sign-ups

Out of the box, anyone who can reach the server can create an account. Set `LAKAR_INVITES=required` and sign-up asks for a code that you hand out yourself:

```bash
npm run invite                 # one single-use code, no expiry
npm run invite -- --days 30    # ...that stops working after 30 days
npm run invite -- --list       # every code, when it was made, who used it
```

Under Docker, run it inside the container so it writes to the same volume:

```bash
docker compose exec lakar npm run invite --prefix server
```

Codes look like `LKR-3P7K-9WQD-XM2T-HJ4V` and are stored only as a SHA-256 hash, so a stolen database hands out no invitations. Give someone `https://draw.example.com/#invite=LKR-3P7K-9WQD-XM2T-HJ4V` and the sign-up form opens with the code already in place; the code can also be pasted into the invite field by hand. Each one is good for exactly one account — a sign-up that fails for any other reason leaves it unspent.

`LAKAR_QUOTA_MB` limits how much encrypted scene data one account may keep on the server. Past the limit a sync is refused, the browser holds onto the scene and says so, and deleting scenes frees the space again. Published pages and satchel shapes have their own fixed limits and are not counted against it.

## Architecture

```
client/  React 19 + TypeScript + Vite
         canvas renderer (rough.js + perfect-freehand), zustand store,
         WebCrypto E2EE, IndexedDB offline cache, sync manager,
         collab/ (room crypto, presence, per-element reconciliation),
         satchel/ (shape builder + authored packs, preview renderer)
server/  Node + Express 5 + ws + node:sqlite
         auth (scrypt + HMAC tokens), scenes/folders/satchel CRUD storing
         opaque ciphertext, optimistic concurrency (409 on conflict),
         a WebSocket relay for rooms that only forwards ciphertext,
         rate limiting, static hosting of the built client
```

Scene sync uses per-scene version numbers. If two devices edit the same scene, the later push gets a 409 and the losing edits are preserved as a "(conflict copy)" scene rather than overwritten.

## Notes

- Exported SVGs reference the Kalam font by name; install it locally or open them where the font is available for identical text rendering.
- Accounts created before the key hierarchy existed are migrated in place on the next sign-in. The old password-derived key is adopted as data key epoch 0 so nothing is re-encrypted, and a fresh epoch 1 takes over new writes immediately. One consequence is worth knowing: records still at epoch 0 remain decryptable by anyone who learns the *old* password, and changing your password does not by itself rewrite them. Re-encrypting them under a fresh key is not implemented yet.
- Per-scene keys and sharing a scene with another account are not implemented. The key hierarchy is designed so they can be added without another migration.
- Passkeys need an authenticator that supports the WebAuthn `prf` extension. Ones that don't are refused at setup with an explanation rather than registered as a passkey that cannot unlock anything.
- Passkey attestation is not requested or verified, so the server learns nothing about which authenticator you use — and equally cannot tell a hardware key from a software one. Registration instead requires a live signature proving the credential holds its own private key.
- The WebAuthn signature counter is read but not enforced. Enforcing it would detect a cloned hardware key, but synced passkeys routinely report zero or non-monotonic counters, and the false lockouts would cost more than the detection is worth here.
- Behind a reverse proxy, set `LAKAR_ORIGIN` (e.g. `https://draw.example.com`) so passkey assertions are checked against the right origin instead of one inferred from forwarded headers.
- The server serves the app's JavaScript, which is the ceiling on any in-browser E2EE: a malicious server could ship a build that leaks your key. Self-hosting is what makes that acceptable — you are the server.

## License

Apache License 2.0 — see [LICENSE](LICENSE). Use, modify and redistribute it, including commercially; the licence carries an explicit patent grant and asks that you keep the notice and state your changes.

Lakar is an independent implementation, not a fork of any existing whiteboard. It reads and writes `.excalidraw` files so you can bring existing drawings with you; no Excalidraw code is used, and Excalidraw is not affiliated with this project.

Nothing here has been independently audited. The cryptography is documented above precisely so it can be checked — please read it sceptically, and report anything you find.
