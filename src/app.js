// const express = require('express')
// const cors = require('cors')
// require('./config/db')

// const app = express()

// app.use(cors())
// app.use(express.json())

// app.use('/api/chat', require('./routes/chat.routes'))
// app.use("/api/users", require("./routes/user.routes"))

// module.exports = app
const express = require("express")
const cors = require("cors")
const connectDB = require("./config/db")

const app = express()

app.use(cors())
app.use(express.json())

// 🔥 DB middleware (runs before routes)
app.use(async (req, res, next) => {
  await connectDB()
  next()
})

app.use("/api/chat", require("./routes/chat.routes"))
app.use("/api/users", require("./routes/user.routes"))

module.exports = app