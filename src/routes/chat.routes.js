const router = require("express").Router()
const Message = require("../models/Message")

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
