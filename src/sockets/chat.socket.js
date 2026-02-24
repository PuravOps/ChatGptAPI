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
          { sender, receiver, seen: { $ne: true } },
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

    socket.on("disconnect", () => {
      console.log("User disconnected")
    })
  })
}
