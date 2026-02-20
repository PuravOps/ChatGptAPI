require('dotenv').config()
const http = require('http')
const app = require('./src/app')
const { Server } = require('socket.io')

const server = http.createServer(app)

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
})

require('./src/sockets/chat.socket')(io)

server.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`)
})
