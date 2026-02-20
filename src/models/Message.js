const mongoose = require("mongoose")

const messageSchema = new mongoose.Schema(
  {
    sender: { type: String, required: true }, // phone
    receiver: { type: String, required: true }, // phone
    message: { type: String, required: true },
  },
  { timestamps: true },
)

messageSchema.index({ sender: 1, receiver: 1, createdAt: 1 })

module.exports = mongoose.model("Message", messageSchema)
