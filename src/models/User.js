const mongoose = require("mongoose")

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    themePreference: {
      type: String,
      enum: ["current", "google-chat"],
      default: "current",
    },
    lastActiveAt: { type: Date, default: null },
  },
  { timestamps: true }
)

module.exports = mongoose.model("User", userSchema)
