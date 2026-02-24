const mongoose = require("mongoose")

const messageSchema = new mongoose.Schema(
  {
    sender: { type: String, required: true }, // phone
    receiver: { type: String, required: true }, // phone
    message: { type: String, required: true },
    seen: { type: Boolean, default: false },
    seenAt: { type: Date, default: null },
  },
  { timestamps: true },
)

messageSchema.index({ sender: 1, receiver: 1, createdAt: 1 })
messageSchema.index({ receiver: 1, seen: 1, createdAt: 1 })

module.exports = mongoose.model("Message", messageSchema)
