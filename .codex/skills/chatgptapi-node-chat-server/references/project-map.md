# Project Map

## Scope

This workspace contains the Node.js backend for a chat application that pairs with the Softlaunch React frontend. It exposes REST APIs, socket.io events, MongoDB persistence, JWT login, and Cloudinary-backed file uploads.

## Stack

- Node.js with CommonJS modules
- Express 5
- Mongoose
- `socket.io`
- `jsonwebtoken`
- `bcryptjs`
- `cors`
- `dotenv`

## Important Files

- `server.js`: creates the HTTP server, attaches socket.io, and mounts chat socket handlers
- `src/app.js`: configures Express middleware, health check, uploads route, DB middleware, and route mounting
- `src/config/db.js`: lazy cached Mongoose connection using `global.mongoose`
- `src/routes/chat.routes.js`: chat REST APIs, reactions, seen state, game HTTP helpers, soft delete, and Cloudinary cleanup
- `src/routes/upload.routes.js`: raw-body upload endpoint that forwards to Cloudinary
- `src/routes/user.routes.js`: user/auth routes
- `src/controllers/user.controller.js`: register/login/user CRUD logic
- `src/models/Message.js`: chat persistence schema
- `src/models/User.js`: user schema
- `src/sockets/chat.socket.js`: realtime chat, reactions, seen state, message broadcasts, and game state updates

## Boot Flow

1. `server.js` loads env vars and builds an HTTP server from `src/app.js`
2. socket.io is attached with permissive CORS
3. `io` is stored on the Express app via `app.set("io", io)`
4. `src/sockets/chat.socket.js` registers socket event handlers
5. Express handles `/api/*` routes

## Middleware and Routing

From `src/app.js`:

- `cors()`
- `express.json()`
- `GET /api/ping` health check that does not require DB
- `POST /api/uploads` mounted before DB middleware
- async DB-connect middleware runs before `/api/chat` and `/api/users`
- `/api/chat`
- `/api/users`

This means uploads and ping are intentionally available even when Mongo is not used for that request path.

## Environment Variables

Observed env requirements:

- `PORT`
- `MONGO_URI`
- `JWT_SECRET`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_FOLDER` optional

`src/config/db.js` throws during module load if `MONGO_URI` is missing.

## Data Models

### User

Fields:

- `name`
- `phone` unique
- `password`

### Message

Fields:

- `gameId` optional indexed string
- `sender`
- `receiver`
- `message` string payload
- `reactions` as `{ emoji, users[] }[]`
- `seen`
- `seenAt`
- `isDeleted`
- `deletedAt`
- `editedAt`
- timestamps

Important indexes:

- `{ sender, receiver, createdAt }`
- `{ receiver, seen, createdAt }`

## REST Contract

Mounted under `/api`.

### Health

- `GET /ping`

### Uploads

- `POST /uploads`

Consumes raw request bodies for images, videos, PDFs, or octet streams, then uploads them to Cloudinary.

### Users

- `POST /users/register`
- `POST /users/login`
- `GET /users`
- `PUT /users/:id`
- `DELETE /users/:id`

### Chat

- `GET /chat/unseen-counts/:receiver`
- `POST /chat/mark-seen`
- `GET /chat/:user1/:user2`
- `GET /chat/games/recent`
- `POST /chat/games/create`
- `POST /chat/games/:gameId/move`
- `DELETE /chat/:id`
- `PUT /chat/:id`
- `POST /chat/:id/reactions`
- `DELETE /chat/:id/reactions`

## Socket Contract

Client emits:

- `join`
- `sendMessage`
- `game.move`
- `game.rematch`
- `addReaction`
- `removeReaction`
- `markSeen`
- `deleteMessage`
- `updateMessage`

Server emits:

- `receiveMessage`
- `messageError`
- `messagesSeen`
- `messageDeleted`
- `messageUpdated`
- `reactionAdded`
- `reactionRemoved`
- `game.created`
- `game.updated`

## Message Encoding

This backend stores rich and game content in the plain `message` string field.

Known prefixes:

- `__SLRICH__:` for JSON-rich text/GIF/file messages
- `__SLGAME__:` for tic-tac-toe payloads

Preserve plain string compatibility. The frontend depends on decoding these prefixes client-side.

## Notable Behavior

- Game flows are authoritative on the server and may upsert by `gameId`.
- REST and socket handlers duplicate some state transitions such as reactions, seen state, delete, and message updates.
- Soft delete marks `isDeleted` instead of removing rows.
- Deleting a rich file message attempts best-effort Cloudinary cleanup.
- Login returns `{ token, user }`, while register returns the created user record.
- User list strips passwords, but register currently returns the created document directly.

## Frontend Coupling

This backend is tightly coupled to the Softlaunch frontend:

- `VITE_API_URI` points at these REST endpoints
- `VITE_SOCKET_URI` points at this socket server
- frontend upload code expects `POST /api/uploads`
- frontend chat code expects the exact reaction, seen, edit, delete, and game event names used here

Before changing endpoint names, response shapes, or event payloads, inspect the frontend callers.
