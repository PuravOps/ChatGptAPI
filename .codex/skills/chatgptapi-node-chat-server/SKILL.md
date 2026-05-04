---
name: chatgptapi-node-chat-server
description: Work inside the ChatGptAPI Node.js backend for the Softlaunch chat product. Use when Codex needs to modify or debug this Express, MongoDB, and socket.io server, including auth, users, chat persistence, reactions, seen state, rich message storage, game messages, uploads, Cloudinary integration, or frontend/backend contract mismatches with the React client.
---

# ChatGptAPI Node Chat Server

Inspect the current workspace before changing behavior. Treat this repository as the backend contract for a React chat client, not as a generic Express starter.

## Start Here

Read these files first when the task is broad:

- `server.js` for HTTP + socket.io bootstrap
- `src/app.js` for middleware and route mounting
- `src/config/db.js` for Mongo connection behavior
- `src/routes/chat.routes.js` for most chat HTTP behavior
- `src/routes/upload.routes.js` for Cloudinary uploads
- `src/routes/user.routes.js` and `src/controllers/user.controller.js` for auth and users
- `src/sockets/chat.socket.js` for realtime contract
- `src/models/Message.js` and `src/models/User.js` for persistence shape

Load [references/project-map.md](references/project-map.md) when you need the architecture map, routes, socket events, env vars, or frontend coupling summary.

## Working Rules

Preserve the existing stack unless the user asks for a larger refactor:

- CommonJS modules
- Express 5
- Mongoose
- `socket.io`
- JWT auth for login
- Cloudinary direct server uploads via signed requests

When editing:

- Keep route behavior inside `src/routes/*` unless extracting shared helpers removes duplication cleanly.
- Keep socket event names aligned with the React client contract.
- Preserve the message prefixes `__SLRICH__:` and `__SLGAME__:` unless a coordinated migration is requested.
- Remember that this backend stores message payloads as strings, including encoded rich/game payloads.
- Be careful with duplicated logic between `src/routes/chat.routes.js` and `src/sockets/chat.socket.js`; fixes often need to be mirrored across both code paths.

## Backend-Specific Risks

Check these before making changes:

1. `src/app.js` connects to Mongo lazily through middleware after `/api/ping` and `/api/uploads`.
2. Socket handlers and REST handlers both mutate message state.
3. Game messages may be addressed by either Mongo `_id` or string `gameId`.
4. Uploads depend on Cloudinary env vars and native `fetch`/`FormData` support in Node.
5. Some user routes lack auth middleware; do not assume protected APIs unless code proves it.

## Common Task Patterns

For auth or user work:

- Check `src/controllers/user.controller.js`
- Check `src/models/User.js`
- Verify whether the React client expects password-less user payloads or token-bearing responses

For chat persistence or REST behavior:

- Start in `src/routes/chat.routes.js`
- Check `src/models/Message.js`
- Preserve soft-delete, seen-state, and reaction semantics

For realtime issues:

- Start in `src/sockets/chat.socket.js`
- Compare emitted/listened event names with the frontend socket service
- Verify whether the same state transition also exists in REST

For uploads or attachment cleanup:

- Check `src/routes/upload.routes.js`
- Check Cloudinary destroy/upload handling in `src/routes/chat.routes.js`
- Preserve best-effort cleanup behavior for deleted file messages

## Frontend Coupling

Assume this backend serves the Softlaunch React app unless the user states otherwise.

Before renaming endpoints, payload fields, or socket events, inspect the frontend call sites. This backend is tightly coupled to:

- `/api/chat`, `/api/users`, `/api/uploads`, `/api/ping`
- socket events such as `join`, `sendMessage`, `receiveMessage`, `messagesSeen`, `messageDeleted`, `messageUpdated`, `reactionAdded`, `reactionRemoved`, `game.created`, and `game.updated`
- encoded message payloads used by the React chat UI

## Validation

This repo does not currently expose useful npm scripts beyond the placeholder `test`.

After edits:

- run the smallest relevant Node command you can justify
- if behavior changed across REST and sockets, verify both paths
- call out when validation is limited by missing scripts, missing env vars, or external services such as MongoDB/Cloudinary
