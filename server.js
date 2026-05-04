require('dotenv').config()
const http = require('http')
const app = require('./src/app')
const { Server } = require('socket.io')
const { createPresenceStore } = require('./src/presence/store')

const server = http.createServer(app)

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
})


// make io available to express routes
app.set('io', io)
const presenceStore = createPresenceStore(io)
app.set('presenceStore', presenceStore)
require('./src/sockets/chat.socket')(io, presenceStore)

server.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`)
})
