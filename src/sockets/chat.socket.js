const Message = require("../models/Message")
const mongoose = require("mongoose")

// Helper to find a message by either DB _id (if valid ObjectId) or by string gameId
const findMessageByIdOrGameId = async (id) => {
  if (!id) return null
  if (mongoose.Types.ObjectId.isValid(id)) {
    return await Message.findOne({ $or: [{ _id: id }, { gameId: id }] })
  }
  return await Message.findOne({ gameId: id })
}

// Helper to findOneAndUpdate by id or gameId
const findOneAndUpdateByIdOrGameId = async (id, update, opts) => {
  if (!id) return null
  if (mongoose.Types.ObjectId.isValid(id)) {
    return await Message.findOneAndUpdate({ $or: [{ _id: id }, { gameId: id }] }, update, opts)
  }
  return await Message.findOneAndUpdate({ gameId: id }, update, opts)
}

const roomIdsForUser = (value) => {
  const raw = String(value || "").trim()
  if (!raw) return []

  const ids = new Set([raw])
  const compact = raw.replace(/[^\d+]/g, "")
  if (compact) ids.add(compact)

  const digits = compact.replace(/\D/g, "")
  if (digits) {
    ids.add(digits)
    ids.add(`+${digits}`)
  }

  return Array.from(ids)
}

const emitToUserRooms = (io, userId, eventName, payload) => {
  for (const roomId of roomIdsForUser(userId)) {
    io.to(roomId).emit(eventName, payload)
  }
}

module.exports = (io, presenceStore) => {
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id)

    socket.on("join", (userId) => {
      for (const roomId of roomIdsForUser(userId)) {
        socket.join(roomId)
      }
      presenceStore?.join(userId, socket.id)
    })

    socket.on("presence:heartbeat", (data) => {
      const { userPhone, activeThreadPhone, isChatActive } = data || {}
      if (!userPhone) return
      presenceStore?.heartbeat(userPhone, activeThreadPhone, isChatActive)
    })

    socket.on("presence:thread", (data) => {
      const { userPhone, activeThreadPhone, isChatActive } = data || {}
      if (!userPhone) return
      presenceStore?.setActiveThread(userPhone, activeThreadPhone, isChatActive)
    })

    socket.on("typing:start", (data) => {
      const { userPhone, targetUserPhone } = data || {}
      if (!userPhone || !targetUserPhone) return
      presenceStore?.startTyping(userPhone, targetUserPhone)
    })

    socket.on("typing:stop", (data) => {
      const { userPhone, targetUserPhone } = data || {}
      if (!userPhone) return
      presenceStore?.stopTyping(userPhone, targetUserPhone)
    })

    socket.on("sendMessage", async (data) => {
      try {
        const { sender, receiver, message } = data || {}

        if (!sender || !receiver || !message) {
          socket.emit("messageError", { message: "Invalid message payload" })
          return
        }

        presenceStore?.heartbeat(sender, receiver)
        presenceStore?.stopTyping(sender, receiver)

        // Special handling for inline game messages (server owns game state)
        const GAME_PREFIX = "__SLGAME__:"
        if (typeof message === "string" && message.startsWith(GAME_PREFIX)) {
          try {
            const json = message.slice(GAME_PREFIX.length)
            const parsed = JSON.parse(json)
            // basic validation
            if (!parsed || parsed.v !== 1 || parsed.type !== "tictactoe" || !parsed.gameId) {
              socket.emit("messageError", { message: "Malformed game payload" })
              return
            }

            const gameId = parsed.gameId
            const now = new Date().toISOString()

            // Upsert the game message using a separate `gameId` string field so
            // we avoid casting problems with ObjectId. This keeps a single shared
            // message instance per game while allowing `gameId` to be an arbitrary string.
            const doc = {
              gameId: gameId,
              sender: parsed.players?.sender?.id ?? sender,
              receiver: parsed.players?.receiver?.id ?? receiver,
              message,
              seen: false,
              seenAt: null,
              isDeleted: false,
              deletedAt: null,
              editedAt: null,
              updatedAt: now,
            }

            // Persist: create a message row for this game if missing, otherwise update
            let saved = await Message.findOne({ gameId })
            if (!saved) {
              try {
                saved = await Message.create({ ...doc })
                console.log(`Game message created in DB for ${gameId} -> _id=${saved._id}`)
              } catch (createErr) {
                // race/fallback: upsert
                saved = await Message.findOneAndUpdate(
                  { gameId },
                  { $set: doc, $setOnInsert: { createdAt: now } },
                  { new: true, upsert: true, setDefaultsOnInsert: true },
                )
                console.log(`Game message upsert fallback for ${gameId} -> _id=${saved._id}`)
              }
            } else {
              saved.message = message
              saved.updatedAt = now
              await saved.save()
              console.log(`Game message updated in DB for ${gameId} -> _id=${saved._id}`)
            }

            // Broadcast the single shared message instance to both players (use rooms by user id)
            const senderId = parsed.players?.sender?.id ?? sender
            const receiverId = parsed.players?.receiver?.id ?? receiver
            console.log(`Game upserted ${gameId} -> saved._id=${saved._id} saved.gameId=${saved.gameId}; broadcasting to ${senderId} and ${receiverId}`)
            io.to(senderId).emit("receiveMessage", saved)
            console.log(`Emitted receiveMessage to ${senderId} for game ${gameId}`)
            io.to(receiverId).emit("receiveMessage", saved)
            console.log(`Emitted receiveMessage to ${receiverId} for game ${gameId}`)
            // Also emit a game-specific event so clients can update UI immediately
            io.to(senderId).emit("game.created", saved)
            io.to(receiverId).emit("game.created", saved)
            return
          } catch (err) {
            console.error("Failed to handle game message", err)
            socket.emit("messageError", { message: "Failed to process game message" })
            return
          }
        }

        // Regular message flow
        const newMessage = await Message.create({
          sender,
          receiver,
          message,
          seen: false,
          seenAt: null,
          isDeleted: false,
          deletedAt: null,
          editedAt: null,
        })

        io.to(receiver).emit("receiveMessage", newMessage)
        io.to(sender).emit("receiveMessage", newMessage)
      } catch (err) {
        console.error("sendMessage error:", err)
        socket.emit("messageError", { message: "Failed to send message" })
      }
    })

    // Authoritative game move: server validates and applies single-cell moves
    socket.on("game.move", async (data) => {
      try {
        const { gameId, index, playerId } = data || {}
        console.log(`socket ${socket.id} received game.move`, { gameId, index, playerId })
        if (!gameId || typeof index !== "number" || !playerId) return
        presenceStore?.heartbeat(playerId)

        // Find by either ObjectId _id or string gameId (safe against cast errors)
        const msg = await findMessageByIdOrGameId(gameId)
        if (!msg) return
        if (!msg.message || typeof msg.message !== "string") return

        const GAME_PREFIX = "__SLGAME__:"
        if (!msg.message.startsWith(GAME_PREFIX)) return

        const parsed = JSON.parse(msg.message.slice(GAME_PREFIX.length))
        if (!parsed || parsed.type !== "tictactoe") return

        // ensure player is part of game
        const isSender = parsed.players?.sender?.id === playerId
        const isReceiver = parsed.players?.receiver?.id === playerId
        if (!isSender && !isReceiver) return

        // map currentTurn and symbol
        const symbol = parsed.currentTurn === "sender" ? "X" : "O"
        const expectedPlayerId = parsed.currentTurn === "sender" ? parsed.players.sender.id : parsed.players.receiver.id
        if (expectedPlayerId !== playerId) return // not this player's turn

        // apply move if valid
        const board = Array.isArray(parsed.board) ? parsed.board.slice() : Array(9).fill("")
        if (index < 0 || index > 8) return
        if (board[index] !== "") return

        board[index] = symbol
        const nextTurn = parsed.currentTurn === "sender" ? "receiver" : "sender"
        const nextPayload = { ...parsed, board, currentTurn: nextTurn }
        const encoded = GAME_PREFIX + JSON.stringify(nextPayload)

        const now = new Date().toISOString()
        const updated = await findOneAndUpdateByIdOrGameId(
          gameId,
          { $set: { message: encoded, updatedAt: now } },
          { new: true },
        )

        // Broadcast updated game message to both players
        console.log(`Game move applied for ${gameId} -> updated._id=${updated?._id} updated.gameId=${updated?.gameId}`)
        io.to(parsed.players.sender.id).emit("receiveMessage", updated)
        console.log(`Emitted receiveMessage to ${parsed.players.sender.id} for move on ${gameId}`)
        io.to(parsed.players.receiver.id).emit("receiveMessage", updated)
        console.log(`Emitted receiveMessage to ${parsed.players.receiver.id} for move on ${gameId}`)
        // also send a game-specific update event
        io.to(parsed.players.sender.id).emit("game.updated", updated)
        io.to(parsed.players.receiver.id).emit("game.updated", updated)
      } catch (err) {
        console.error("game.move error:", err)
      }
    })

    // Authoritative rematch: reset board and new gameId
    socket.on("game.rematch", async (data) => {
      try {
        const { gameId, requesterId } = data || {}
        if (!gameId || !requesterId) return
        presenceStore?.heartbeat(requesterId)
        const msg = await findMessageByIdOrGameId(gameId)
        if (!msg) return
        if (!msg.message || !msg.message.startsWith("__SLGAME__:")) return
        const parsed = JSON.parse(msg.message.slice("__SLGAME__:".length))
        if (!parsed) return

        // create new game instance (keep same players) but new gameId so clients can reference
        const newGameId = `t3-${Date.now()}`
        const reset = { ...parsed, gameId: newGameId, board: ["", "", "", "", "", "", "", "", ""], currentTurn: "sender", v: 1 }
        const encoded = "__SLGAME__:" + JSON.stringify(reset)
        const now = new Date().toISOString()

        // Upsert with new id
        // Create/upsert new message row referenced by `gameId` string
        const saved = await Message.findOneAndUpdate(
          { gameId: newGameId },
          { $set: { gameId: newGameId, sender: parsed.players?.sender?.id ?? requesterId, receiver: parsed.players.receiver.id, message: encoded, updatedAt: now } },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        )

        // Broadcast new game message
        console.log(`Rematch created ${newGameId} -> saved._id=${saved._id} saved.gameId=${saved.gameId}; broadcasting to ${parsed.players.sender.id} and ${parsed.players.receiver.id}`)
        io.to(parsed.players.sender.id).emit("receiveMessage", saved)
        console.log(`Emitted receiveMessage to ${parsed.players.sender.id} for rematch ${newGameId}`)
        io.to(parsed.players.receiver.id).emit("receiveMessage", saved)
        console.log(`Emitted receiveMessage to ${parsed.players.receiver.id} for rematch ${newGameId}`)
        io.to(parsed.players.sender.id).emit("game.updated", saved)
        io.to(parsed.players.receiver.id).emit("game.updated", saved)
      } catch (err) {
        console.error("game.rematch error:", err)
      }
    })


    // Reactions: one reaction per user per message (WhatsApp-like)
    socket.on("addReaction", async (data) => {
      try {
        const { messageId, emoji, userPhone } = data || {}
        if (!messageId || !emoji || !userPhone) return
        presenceStore?.heartbeat(userPhone)

        const msg = await Message.findById(messageId)
        if (!msg || msg.isDeleted) return

        const next = Array.isArray(msg.reactions)
          ? msg.reactions.map((r) => ({ emoji: r.emoji, users: Array.isArray(r.users) ? r.users.slice() : [] }))
          : []

        let prevEmoji = null
        for (const r of next) {
          if (Array.isArray(r.users) && r.users.includes(userPhone)) {
            prevEmoji = r.emoji
          }
          r.users = (Array.isArray(r.users) ? r.users : []).filter((u) => u !== userPhone)
        }

        for (let i = next.length - 1; i >= 0; i -= 1) {
          if (!next[i].users || next[i].users.length === 0) next.splice(i, 1)
        }

        const idx = next.findIndex((r) => r.emoji === emoji)
        if (idx >= 0) {
          next[idx].users = Array.from(new Set([...(next[idx].users || []), userPhone]))
        } else {
          next.push({ emoji, users: [userPhone] })
        }

        msg.reactions = next
        await msg.save()

        if (prevEmoji && prevEmoji !== emoji) {
          io.to(msg.sender).emit("reactionRemoved", { messageId, emoji: prevEmoji, userPhone })
          io.to(msg.receiver).emit("reactionRemoved", { messageId, emoji: prevEmoji, userPhone })
        }
        io.to(msg.sender).emit("reactionAdded", { messageId, emoji, userPhone })
        io.to(msg.receiver).emit("reactionAdded", { messageId, emoji, userPhone })
      } catch (err) {
        console.error("addReaction error:", err)
      }
    })

    socket.on("removeReaction", async (data) => {
      try {
        const { messageId, emoji, userPhone } = data || {}
        if (!messageId || !emoji || !userPhone) return
        presenceStore?.heartbeat(userPhone)

        const msg = await Message.findById(messageId)
        if (!msg || msg.isDeleted) return

        const next = Array.isArray(msg.reactions)
          ? msg.reactions.map((r) => ({ emoji: r.emoji, users: Array.isArray(r.users) ? r.users.slice() : [] }))
          : []

        const idx = next.findIndex((r) => r.emoji === emoji)
        if (idx < 0) return

        next[idx].users = (next[idx].users || []).filter((u) => u !== userPhone)
        if (!next[idx].users || next[idx].users.length === 0) next.splice(idx, 1)

        msg.reactions = next
        await msg.save()

        io.to(msg.sender).emit("reactionRemoved", { messageId, emoji, userPhone })
        io.to(msg.receiver).emit("reactionRemoved", { messageId, emoji, userPhone })
      } catch (err) {
        console.error("removeReaction error:", err)
      }
    })

    socket.on("markSeen", async (data) => {
      try {
        const { sender, receiver } = data || {}
        if (!sender || !receiver) return
        presenceStore?.heartbeat(receiver, sender)

        const seenAt = new Date()
        const result = await Message.updateMany(
          { sender, receiver, seen: { $ne: true }, isDeleted: { $ne: true } },
          { $set: { seen: true, seenAt } },
        )

        io.to(sender).emit("messagesSeen", {
          sender,
          receiver,
          seenAt: seenAt.toISOString(),
          modifiedCount: result.modifiedCount ?? 0,
        })
      } catch (err) {
        console.error("markSeen error:", err)
      }
    })

    // Broadcast-only delete: REST API performs the soft delete; this notifies both users.
    socket.on("deleteMessage", async (data) => {
      try {
        const { messageId } = data || {}
        if (!messageId) return

        const msg = await Message.findById(messageId)
        if (!msg) return

        // If a client uses socket-only delete, still soft-delete here.
        if (!msg.isDeleted) {
          await Message.updateOne(
            { _id: messageId },
            { $set: { isDeleted: true, deletedAt: new Date() } },
          )
        }

        io.to(msg.sender).emit("messageDeleted", { messageId })
        io.to(msg.receiver).emit("messageDeleted", { messageId })
      } catch (err) {
        console.error("deleteMessage error:", err)
      }
    })

    // Broadcast-only update: REST API updates message text; this notifies both users.
    socket.on("updateMessage", async (data) => {
      try {
        const { messageId } = data || {}
        if (!messageId) return

        const msg = await Message.findById(messageId)
        if (!msg || msg.isDeleted) return

        io.to(msg.sender).emit("messageUpdated", { message: msg })
        io.to(msg.receiver).emit("messageUpdated", { message: msg })
      } catch (err) {
        console.error("updateMessage error:", err)
      }
    })

    // Broadcast-only pin update: REST API updates pin state; this notifies both users.
    socket.on("pinMessage", async (data) => {
      try {
        const { messageId } = data || {}
        if (!messageId) return

        const msg = await Message.findById(messageId)
        if (!msg || msg.isDeleted) return

        io.to(msg.sender).emit("messagePinned", { message: msg })
        io.to(msg.receiver).emit("messagePinned", { message: msg })
      } catch (err) {
        console.error("pinMessage error:", err)
      }
    })

    socket.on("chatEffect", (data) => {
      try {
        const { sender, receiver, effect, eventId } = data || {}
        if (!sender || !receiver) return
        if (!["confetti", "punch", "love"].includes(effect)) return

        presenceStore?.heartbeat(sender, receiver)

        const payload = {
          sender,
          receiver,
          effect,
          eventId: eventId ? String(eventId) : undefined,
          createdAt: new Date().toISOString(),
        }

        console.log("chatEffect broadcast", { sender, receiver, effect, eventId: payload.eventId })
        emitToUserRooms(io, sender, "chatEffect", payload)
        emitToUserRooms(io, receiver, "chatEffect", payload)
      } catch (err) {
        console.error("chatEffect error:", err)
      }
    })

    socket.on("disconnect", () => {
      presenceStore?.disconnectSocket(socket.id)
      console.log("User disconnected")
    })
  })
}


