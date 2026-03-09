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

module.exports = router
