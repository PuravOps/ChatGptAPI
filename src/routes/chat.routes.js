const router = require("express").Router()
const Message = require("../models/Message")

router.get("/unseen-counts/:receiver", async (req, res) => {
  const { receiver } = req.params

  try {
    const rows = await Message.aggregate([
      { $match: { receiver, seen: { $ne: true } } },
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
      { sender, receiver, seen: { $ne: true } },
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

router.get("/:user1/:user2", async (req, res) => {
  const { user1, user2 } = req.params

  try {
    const messages = await Message.find({
      $or: [
        { sender: user1, receiver: user2 },
        { sender: user2, receiver: user1 },
      ],
    }).sort({ createdAt: 1 })

    res.json(messages)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

module.exports = router
