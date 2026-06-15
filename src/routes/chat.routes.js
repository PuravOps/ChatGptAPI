const router = require("express").Router()
const Message = require("../models/Message")

const crypto = require("crypto")

const RICH_PREFIX = "__SLRICH__:"
const URL_REGEX = /https?:\/\/[^\s<>"'`]+/gi

const sha1 = (value) => crypto.createHash("sha1").update(value).digest("hex")

const signCloudinaryParams = (params, apiSecret) => {
  const keys = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort()
  const toSign = keys.map((k) => `${k}=${params[k]}`).join("&")
  return sha1(`${toSign}${apiSecret}`)
}

const parseRichMessage = (raw) => {
  if (typeof raw !== "string" || !raw.startsWith(RICH_PREFIX)) return null
  try {
    return JSON.parse(raw.slice(RICH_PREFIX.length))
  } catch {
    return null
  }
}

const normalizeCloudinaryDestroyType = (value, mimeType) => {
  if (value === "image" || value === "video" || value === "raw") return value
  const mt = (mimeType || "").toLowerCase()
  if (mt.startsWith("image/")) return "image"
  if (mt.startsWith("video/")) return "video"
  return "raw"
}

const destroyCloudinaryAsset = async ({ publicId, resourceType, mimeType }) => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Missing Cloudinary env vars")
  }

  const rt = normalizeCloudinaryDestroyType(resourceType, mimeType)
  const timestamp = Math.floor(Date.now() / 1000)
  const paramsToSign = { public_id: publicId, timestamp, invalidate: "true" }
  const signature = signCloudinaryParams(paramsToSign, apiSecret)

  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${rt}/destroy`
  const form = new FormData()
  form.append("public_id", publicId)
  form.append("api_key", apiKey)
  form.append("timestamp", String(timestamp))
  form.append("invalidate", "true")
  form.append("signature", signature)

  const resp = await fetch(endpoint, { method: "POST", body: form })
  let data = {}
  try {
    data = await resp.json()
  } catch {
    // ignore
  }

  if (!resp.ok) {
    throw new Error(data?.error?.message || `Cloudinary destroy failed (${resp.status})`)
  }

  const result = data?.result
  if (result && result !== "ok" && result !== "not found") {
    throw new Error(`Cloudinary destroy returned: ${result}`)
  }
  return { result }
}

const parseLimit = (value, fallback) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(200, Math.floor(n))
}

const cleanUrl = (url) => String(url || "").replace(/[),.!?;:]+$/g, "")

const isGifUrl = (value) => {
  const v = String(value || "").trim().toLowerCase()
  if (!v || !/^https?:\/\//.test(v)) return false
  return v.endsWith(".gif") || v.includes("giphy.com/") || v.includes("tenor.com/")
}

const isImageUrl = (value) => /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(String(value || "").split("?")[0] || "")
const isVideoUrl = (value) => /\.(mp4|webm|ogg|mov|m4v|avi|mkv)$/i.test(String(value || "").split("?")[0] || "")

const extractUrls = (value) => {
  if (!value) return []
  const matches = String(value).match(URL_REGEX) || []
  return matches.map(cleanUrl).filter(Boolean)
}

const makeLinkLabel = (url) => {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname === "/" ? "" : parsed.pathname
    return `${parsed.hostname}${path}`.slice(0, 120)
  } catch {
    return String(url).slice(0, 120)
  }
}

const getConversationQuery = (user1, user2) => ({
  isDeleted: { $ne: true },
  $or: [
    { sender: user1, receiver: user2 },
    { sender: user2, receiver: user1 },
  ],
})

const extractSharedContent = (messages) => {
  const media = []
  const files = []
  const links = []
  const seenMedia = new Set()
  const seenFiles = new Set()
  const seenLinks = new Set()

  const pushMedia = (item) => {
    const key = `${item.messageId}:${item.url}`
    if (seenMedia.has(key)) return
    seenMedia.add(key)
    media.push(item)
  }

  const pushFile = (item) => {
    const key = `${item.messageId}:${item.url}`
    if (seenFiles.has(key)) return
    seenFiles.add(key)
    files.push(item)
  }

  const pushLink = (item) => {
    const key = `${item.messageId}:${item.url}`
    if (seenLinks.has(key)) return
    seenLinks.add(key)
    links.push(item)
  }

  for (const message of messages) {
    const decoded = parseRichMessage(message.message)

    const classifyTextUrls = (value) => {
      const urls = extractUrls(value)
      urls.forEach((url, index) => {
        if (isGifUrl(url)) {
          pushMedia({
            id: `${message._id}:media:text-gif-${index}`,
            messageId: String(message._id),
            sender: message.sender,
            createdAt: message.createdAt,
            url,
            title: "GIF",
            mediaType: "gif",
            text: value?.trim() || undefined,
          })
          return
        }

        if (isImageUrl(url)) {
          pushMedia({
            id: `${message._id}:media:text-image-${index}`,
            messageId: String(message._id),
            sender: message.sender,
            createdAt: message.createdAt,
            url,
            title: "Image",
            mediaType: "image",
            text: value?.trim() || undefined,
          })
          return
        }

        if (isVideoUrl(url)) {
          pushMedia({
            id: `${message._id}:media:text-video-${index}`,
            messageId: String(message._id),
            sender: message.sender,
            createdAt: message.createdAt,
            url,
            title: "Video",
            mediaType: "video",
            text: value?.trim() || undefined,
          })
          return
        }

        pushLink({
          id: `${message._id}:link:${index}`,
          messageId: String(message._id),
          sender: message.sender,
          createdAt: message.createdAt,
          url,
          label: makeLinkLabel(url),
          text: value?.trim() || undefined,
        })
      })
    }

    if (!decoded) {
      classifyTextUrls(message.message)
      continue
    }

    classifyTextUrls(decoded.text)

    if (decoded.type === "gif" && decoded.gifUrl) {
      pushMedia({
        id: `${message._id}:media:gif`,
        messageId: String(message._id),
        sender: message.sender,
        createdAt: message.createdAt,
        url: decoded.gifUrl,
        title: decoded.text?.trim() || "GIF",
        mediaType: "gif",
        text: decoded.text?.trim() || undefined,
      })
      continue
    }

    if (decoded.type !== "file" || !decoded.fileUrl) continue

    const base = {
      messageId: String(message._id),
      sender: message.sender,
      createdAt: message.createdAt,
      url: decoded.fileUrl,
      mimeType: decoded.mimeType,
      text: decoded.text?.trim() || undefined,
    }

    if ((decoded.mimeType || "").startsWith("image/") || isImageUrl(decoded.fileUrl)) {
      pushMedia({
        id: `${message._id}:media:file-image`,
        title: decoded.fileName?.trim() || decoded.text?.trim() || "Image",
        mediaType: "image",
        ...base,
      })
      continue
    }

    if ((decoded.mimeType || "").startsWith("video/") || isVideoUrl(decoded.fileUrl)) {
      pushMedia({
        id: `${message._id}:media:file-video`,
        title: decoded.fileName?.trim() || decoded.text?.trim() || "Video",
        mediaType: "video",
        ...base,
      })
      continue
    }

    pushFile({
      id: `${message._id}:file:file`,
      fileName: decoded.fileName?.trim() || "Attachment",
      sizeBytes: decoded.sizeBytes,
      ...base,
    })
  }

  media.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  links.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return { media, files, links }
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

router.get("/:chatId/media", async (req, res) => {
  const { user1, user2 } = req.query || {}
  if (!user1 || !user2) {
    return res.status(400).json({ message: "user1 and user2 are required" })
  }

  try {
    const messages = await Message.find(getConversationQuery(String(user1), String(user2))).sort({ createdAt: -1 })
    const shared = extractSharedContent(messages)
    return res.json(shared.media)
  } catch (error) {
    return res.status(500).json({ message: error.message })
  }
})

router.get("/:chatId/files", async (req, res) => {
  const { user1, user2 } = req.query || {}
  if (!user1 || !user2) {
    return res.status(400).json({ message: "user1 and user2 are required" })
  }

  try {
    const messages = await Message.find(getConversationQuery(String(user1), String(user2))).sort({ createdAt: -1 })
    const shared = extractSharedContent(messages)
    return res.json(shared.files)
  } catch (error) {
    return res.status(500).json({ message: error.message })
  }
})

router.get("/:chatId/links", async (req, res) => {
  const { user1, user2 } = req.query || {}
  if (!user1 || !user2) {
    return res.status(400).json({ message: "user1 and user2 are required" })
  }

  try {
    const messages = await Message.find(getConversationQuery(String(user1), String(user2))).sort({ createdAt: -1 })
    const shared = extractSharedContent(messages)
    return res.json(shared.links)
  } catch (error) {
    return res.status(500).json({ message: error.message })
  }
})

router.get("/:chatId/pinned", async (req, res) => {
  const { user1, user2 } = req.query || {}
  if (!user1 || !user2) {
    return res.status(400).json({ message: "user1 and user2 are required" })
  }

  try {
    const messages = await Message.find({
      ...getConversationQuery(String(user1), String(user2)),
      pinned: true,
    })
      .sort({ pinnedAt: -1, createdAt: -1 })
      .limit(3)

    return res.json(messages)
  } catch (error) {
    return res.status(500).json({ message: error.message })
  }
})

// Get messages (supports pagination)
router.get("/:user1/:user2", async (req, res) => {
  const { user1, user2 } = req.params
  const limit = parseLimit(req.query.limit, 30)
  const before = req.query.before

  try {
    const query = getConversationQuery(user1, user2)

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

// Soft delete message (also deletes Cloudinary attachment for file messages)
router.delete("/:id", async (req, res) => {
  const { id } = req.params

  try {
    const msg = await Message.findById(id)
    if (!msg || msg.isDeleted) return res.status(404).json({ message: "Message not found" })

    // best-effort: delete Cloudinary asset if this is a file message
    const decoded = parseRichMessage(msg.message)
    if (decoded && decoded.v === 1 && decoded.type === "file") {
      const publicId = decoded.cloudinaryPublicId
      if (publicId) {
        try {
          await destroyCloudinaryAsset({
            publicId,
            resourceType: decoded.cloudinaryResourceType,
            mimeType: decoded.mimeType,
          })
        } catch (e) {
          console.warn("Cloudinary destroy failed", e?.message || e)
        }
      }
    }

    msg.isDeleted = true
    msg.deletedAt = new Date()
    await msg.save()

    res.json({ ok: true, message: msg })
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

// Pin/unpin a message for both users in the conversation.
router.post("/:id/pin", async (req, res) => {
  const { id } = req.params
  const { pinned, userPhone } = req.body || {}
  const nextPinned = Boolean(pinned)

  if (typeof userPhone !== "string" || !userPhone.trim()) {
    return res.status(400).json({ message: "userPhone is required" })
  }

  try {
    const msg = await Message.findById(id)
    if (!msg || msg.isDeleted) return res.status(404).json({ message: "Message not found" })

    const actor = userPhone.trim()
    if (actor !== msg.sender && actor !== msg.receiver) {
      return res.status(403).json({ message: "You can only pin messages from your own chats." })
    }

    if (nextPinned && !msg.pinned) {
      const pinnedCount = await Message.countDocuments({
        ...getConversationQuery(msg.sender, msg.receiver),
        pinned: true,
        _id: { $ne: msg._id },
      })

      if (pinnedCount >= 3) {
        return res.status(409).json({ message: "You can pin up to 3 messages in this chat." })
      }
    }

    msg.pinned = nextPinned
    msg.pinnedAt = nextPinned ? new Date() : null
    msg.pinnedBy = nextPinned ? actor : null
    await msg.save()

    const io = req.app?.get("io")
    if (io) {
      io.to(msg.sender).emit("messagePinned", { message: msg })
      io.to(msg.receiver).emit("messagePinned", { message: msg })
    }

    return res.json(msg)
  } catch (error) {
    return res.status(500).json({ message: error.message })
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



