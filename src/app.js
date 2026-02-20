const express = require('express')
const cors = require('cors')
require('./config/db')

const app = express()

app.use(cors())
app.use(express.json())

app.use('/api/chat', require('./routes/chat.routes'))
app.use("/api/users", require("./routes/user.routes"))

module.exports = app
