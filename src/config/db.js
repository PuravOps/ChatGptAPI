// const mongoose = require('mongoose')

// mongoose.connect(process.env.MONGO_URI)
//   .then(() => console.log('MongoDB Connected'))
//   .catch(err => console.error(err))
const mongoose = require("mongoose")

const MONGO_URI = process.env.MONGO_URI

if (!MONGO_URI) {
  throw new Error("MONGO_URI missing")
}

let cached = global.mongoose || { conn: null, promise: null }
global.mongoose = cached

async function connectDB() {
  if (cached.conn) return cached.conn

  if (!cached.promise) {
    mongoose.set("bufferCommands", false)

    cached.promise = mongoose.connect(MONGO_URI, {
      maxPoolSize: 10,
    })
  }

  cached.conn = await cached.promise
  return cached.conn
}

module.exports = connectDB