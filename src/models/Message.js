const mongoose = require("mongoose")

const messageSchema = new mongoose.Schema(
  {
    // Optional string id for special messages (games, polls, etc.)
    gameId: { type: String, required: false, index: true },
    sender: { type: String, required: true }, // phone
    receiver: { type: String, required: true }, // phone
    message: { type: String, required: true },

    reactions: { type: [{ emoji: { type: String, required: true }, users: { type: [String], default: [] } }], default: [] },

    seen: { type: Boolean, default: false },
    seenAt: { type: Date, default: null },

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },

    editedAt: { type: Date, default: null },

    pinned: { type: Boolean, default: false },
    pinnedAt: { type: Date, default: null },
    pinnedBy: { type: String, default: null },
  },
  { timestamps: true },
)

messageSchema.index({ sender: 1, receiver: 1, createdAt: 1 })
messageSchema.index({ receiver: 1, seen: 1, createdAt: 1 })
messageSchema.index({ sender: 1, receiver: 1, pinned: 1, pinnedAt: -1 })

module.exports = mongoose.model("Message", messageSchema)

