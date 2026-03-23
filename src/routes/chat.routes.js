const router = require("express").Router()
const Message = require("../models/Message")

const parseLimit = (value, fallback) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(200, Math.floor(n))
}

router.get("/unseen-counts/:receiver", async (req, res) => {
  const { receiver } = req.params

  try {
    const rows = await Message.aggregate([
      { $match: { receiver, seen: { $ne: true }, isDeleted: { $ne: true } } },
      { $group: { _id: "$sender", count: { $sum: 1 } } },
    ])

    res.json(rows.map((r) => ({ sender: r._id, count: r.count })))
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

router.post("/mark-seen", async (req, res) => {
  const { sender, receiver } = req.body || {}

  if (!sender || !receiver) {
    return res.status(400).json({ message: "sender and receiver are required" })
  }

  try {
    const seenAt = new Date()

    const result = await Message.updateMany(
      { sender, receiver, seen: { $ne: true }, isDeleted: { $ne: true } },
      { $set: { seen: true, seenAt } },
    )

    res.json({
      modifiedCount: result.modifiedCount ?? 0,
      seenAt: seenAt.toISOString(),
    })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// Get messages (supports pagination)
router.get("/:user1/:user2", async (req, res) => {
  const { user1, user2 } = req.params
  const limit = parseLimit(req.query.limit, 30)
  const before = req.query.before

  try {
    const query = {
      isDeleted: { $ne: true },
      $or: [
        { sender: user1, receiver: user2 },
        { sender: user2, receiver: user1 },
      ],
    }

    if (before) {
      const d = new Date(before)
      if (!Number.isNaN(d.getTime())) {
        query.createdAt = { $lt: d }
      }
    }

    // Fetch newest first, limit, then reverse so client gets ascending order
    const messages = await Message.find(query).sort({ createdAt: -1 }).limit(limit)
    res.json(messages.reverse())
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// List recent game messages (for debugging)
router.get("/games/recent", async (req, res) => {
  const limit = parseLimit(req.query.limit, 50)
  try {
    const rows = await Message.find({ $or: [{ gameId: { $exists: true } }, { _id: { $regex: /^t3-/ } }] })
      .sort({ createdAt: -1 })
      .limit(limit)

    res.json(rows)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// Test helper: create a game message (bypasses socket) for debugging
router.post("/games/create", async (req, res) => {
  const payload = req.body || {}
  const { gameId, sender, receiver, message } = payload

  if (!gameId || !sender || !receiver || !message) {
    return res.status(400).json({ message: "gameId, sender, receiver, and message are required" })
  }

  try {
    const now = new Date().toISOString()
    const doc = { gameId, sender, receiver, message, createdAt: now, updatedAt: now }
    const existing = await Message.findOne({ gameId })
    if (existing) {
      existing.message = message
      existing.updatedAt = now
      await existing.save()
      return res.json(existing)
    }

    const created = await Message.create(doc)
    return res.json(created)
  } catch (err) {
    return res.status(500).json({ message: err.message })
  }
})

// Apply a move to a game message (HTTP fallback for when sockets are unreliable)
router.post("/games/:gameId/move", async (req, res) => {
  const { gameId } = req.params
  const { index, playerId } = req.body || {}

  if (!gameId || typeof index !== 'number' || !playerId) {
    return res.status(400).json({ message: 'gameId, index, and playerId are required' })
  }

  try {
    const msg = await Message.findOne({ $or: [{ _id: gameId }, { gameId: gameId }] })
    if (!msg || !msg.message || typeof msg.message !== 'string') return res.status(404).json({ message: 'Game message not found' })

    const GAME_PREFIX = '__SLGAME__:'
    if (!msg.message.startsWith(GAME_PREFIX)) return res.status(400).json({ message: 'Not a game message' })

    const parsed = JSON.parse(msg.message.slice(GAME_PREFIX.length))
    if (!parsed || parsed.type !== 'tictactoe') return res.status(400).json({ message: 'Invalid game payload' })

    // validate player is part of game and turn
    const expectedPlayerId = parsed.currentTurn === 'sender' ? parsed.players.sender.id : parsed.players.receiver.id
    if (expectedPlayerId !== playerId) return res.status(403).json({ message: 'Not your turn' })

    const board = Array.isArray(parsed.board) ? parsed.board.slice() : Array(9).fill('')
    if (index < 0 || index > 8) return res.status(400).json({ message: 'Invalid index' })
    if (board[index] !== '') return res.status(400).json({ message: 'Cell already filled' })

    const symbol = parsed.currentTurn === 'sender' ? 'X' : 'O'
    board[index] = symbol
    const nextTurn = parsed.currentTurn === 'sender' ? 'receiver' : 'sender'
    const nextPayload = { ...parsed, board, currentTurn: nextTurn }
    const encoded = GAME_PREFIX + JSON.stringify(nextPayload)

    const now = new Date().toISOString()
    const updated = await Message.findOneAndUpdate(
      { $or: [{ _id: gameId }, { gameId: gameId }] },
      { $set: { message: encoded, updatedAt: now } },
      { new: true },
    )

    // emit to both players if io is available
    try {
      const io = req.app?.get('io')
      if (io) {
        const senderId = parsed.players?.sender?.id
        const receiverId = parsed.players?.receiver?.id
        io.to(senderId).emit('receiveMessage', updated)
        io.to(receiverId).emit('receiveMessage', updated)
        io.to(senderId).emit('game.updated', updated)
        io.to(receiverId).emit('game.updated', updated)
      }
    } catch (e) {
      console.error('Failed to emit game.updated from REST move', e)
    }

    return res.json(updated)
  } catch (err) {
    return res.status(500).json({ message: err.message })
  }
})

// Soft delete message
router.delete("/:id", async (req, res) => {
  const { id } = req.params

  try {
    const updated = await Message.findOneAndUpdate(
      { _id: id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true },
    )

    if (!updated) return res.status(404).json({ message: "Message not found" })

    res.json({ ok: true, message: updated })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// Update message text
router.put("/:id", async (req, res) => {
  const { id } = req.params
  const { message } = req.body || {}

  if (typeof message !== "string") {
    return res.status(400).json({ message: "message must be a string" })
  }

  const next = message.trim()
  if (!next) {
    return res.status(400).json({ message: "message cannot be empty" })
  }

  try {
    const updated = await Message.findOneAndUpdate(
      { _id: id, isDeleted: { $ne: true } },
      { $set: { message: next, editedAt: new Date() } },
      { new: true },
    )

    if (!updated) return res.status(404).json({ message: "Message not found" })

    res.json(updated)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})


// Add/replace reaction (one reaction per user)
router.post("/:id/reactions", async (req, res) => {
  const { id } = req.params
  const { emoji, userPhone } = req.body || {}

  if (typeof emoji !== "string" || !emoji.trim()) {
    return res.status(400).json({ message: "emoji is required" })
  }
  if (typeof userPhone !== "string" || !userPhone.trim()) {
    return res.status(400).json({ message: "userPhone is required" })
  }

  try {
    const msg = await Message.findById(id)
    if (!msg || msg.isDeleted) return res.status(404).json({ message: "Message not found" })

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

    // drop empty reactions
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

    // Optional: broadcast via io (if available)
    const io = req.app?.get("io")
    if (io) {
      if (prevEmoji && prevEmoji !== emoji) {
        io.to(msg.sender).emit("reactionRemoved", { messageId: id, emoji: prevEmoji, userPhone })
        io.to(msg.receiver).emit("reactionRemoved", { messageId: id, emoji: prevEmoji, userPhone })
      }
      io.to(msg.sender).emit("reactionAdded", { messageId: id, emoji, userPhone })
      io.to(msg.receiver).emit("reactionAdded", { messageId: id, emoji, userPhone })
    }

    return res.json(msg)
  } catch (error) {
    return res.status(500).json({ message: error.message })
  }
})

// Remove reaction
router.delete("/:id/reactions", async (req, res) => {
  const { id } = req.params
  const { emoji, userPhone } = req.body || {}

  if (typeof emoji !== "string" || !emoji.trim()) {
    return res.status(400).json({ message: "emoji is required" })
  }
  if (typeof userPhone !== "string" || !userPhone.trim()) {
    return res.status(400).json({ message: "userPhone is required" })
  }

  try {
    const msg = await Message.findById(id)
    if (!msg || msg.isDeleted) return res.status(404).json({ message: "Message not found" })

    const next = Array.isArray(msg.reactions)
      ? msg.reactions.map((r) => ({ emoji: r.emoji, users: Array.isArray(r.users) ? r.users.slice() : [] }))
      : []

    const idx = next.findIndex((r) => r.emoji === emoji)
    if (idx >= 0) {
      next[idx].users = (next[idx].users || []).filter((u) => u !== userPhone)
      if (!next[idx].users || next[idx].users.length === 0) next.splice(idx, 1)
      msg.reactions = next
      await msg.save()

      const io = req.app?.get("io")
      if (io) {
        io.to(msg.sender).emit("reactionRemoved", { messageId: id, emoji, userPhone })
        io.to(msg.receiver).emit("reactionRemoved", { messageId: id, emoji, userPhone })
      }
    }

    return res.json(msg)
  } catch (error) {
    return res.status(500).json({ message: error.message })
  }
})

module.exports = router


