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
        })

        io.to(receiver).emit("receiveMessage", newMessage)
        io.to(sender).emit("receiveMessage", newMessage)
      } catch (err) {
        console.error("sendMessage error:", err)
        socket.emit("messageError", { message: "Failed to send message" })
      }
    })

    socket.on("disconnect", () => {
      console.log("User disconnected")
    })
  })
}
