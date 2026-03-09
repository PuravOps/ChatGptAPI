const Message = require("../models/Message")

module.exports = (io) => {
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id)

    socket.on("join", (userId) => {
      socket.join(userId)
    })

    socket.on("sendMessage", async (data) => {
      try {
        const { sender, receiver, message } = data || {}

        if (!sender || !receiver || !message) {
          socket.emit("messageError", { message: "Invalid message payload" })
          return
        }

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

    socket.on("markSeen", async (data) => {
      try {
        const { sender, receiver } = data || {}
        if (!sender || !receiver) return

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

    socket.on("disconnect", () => {
      console.log("User disconnected")
    })
  })
}
