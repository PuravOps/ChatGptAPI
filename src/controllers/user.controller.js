const User = require("../models/User")
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")

const mapPublicUser = (user) => {
  if (!user) return user

  const plain = typeof user.toObject === "function" ? user.toObject() : user
  const { password, ...rest } = plain
  return rest
}

// Register
exports.register = async (req, res) => {
  try {
    const { name, phone, password } = req.body

    const existing = await User.findOne({ phone })
    if (existing) {
      return res.status(400).json({ message: "Phone already exists" })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const user = await User.create({
      name,
      phone,
      password: hashedPassword,
    })

    res.status(201).json(mapPublicUser(user))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// Login
exports.login = async (req, res) => {
  try {
    const { phone, password } = req.body

    const user = await User.findOne({ phone })
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" })
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" })
    }

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    )

    res.json({ token, user: mapPublicUser(user) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// Get All Users
exports.getUsers = async (req, res) => {
  const users = await User.find().select("-password")
  res.json(users)
}

exports.getUserPresence = async (req, res) => {
  try {
    const { phone } = req.params
    const viewer = typeof req.query.viewer === "string" ? req.query.viewer.trim() : ""

    if (!phone) {
      return res.status(400).json({ message: "phone is required" })
    }

    const user = await User.findOne({ phone }).select("phone lastActiveAt")
    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    const presenceStore = req.app.get("presenceStore")
    const snapshot = presenceStore?.getPresenceForViewer?.(phone, viewer || null)

    return res.json({
      phone: user.phone,
      status: snapshot?.status || "offline",
      lastActiveAt: snapshot?.lastActiveAt || user.lastActiveAt || null,
      isTyping: Boolean(snapshot?.isTyping),
    })
  } catch (err) {
    return res.status(500).json({ message: err.message })
  }
}

// Update User
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params
    const { name, phone, password } = req.body

    const existingUser = await User.findById(id)
    if (!existingUser) {
      return res.status(404).json({ message: "User not found" })
    }

    const update = {}

    if (typeof name === "string") {
      const trimmedName = name.trim()
      if (!trimmedName) {
        return res.status(400).json({ message: "Name is required" })
      }
      update.name = trimmedName
    }

    if (typeof phone === "string") {
      const trimmedPhone = phone.trim()
      if (!trimmedPhone) {
        return res.status(400).json({ message: "Phone is required" })
      }

      const duplicate = await User.findOne({
        phone: trimmedPhone,
        _id: { $ne: id },
      })
      if (duplicate) {
        return res.status(400).json({ message: "Phone already exists" })
      }

      update.phone = trimmedPhone
    }

    if (typeof password === "string" && password.trim()) {
      update.password = await bcrypt.hash(password.trim(), 10)
    }

    const user = await User.findByIdAndUpdate(
      id,
      update,
      { new: true, runValidators: true }
    )

    return res.json(mapPublicUser(user))
  } catch (err) {
    return res.status(500).json({ message: err.message })
  }
}

// Delete User
exports.deleteUser = async (req, res) => {
  await User.findByIdAndDelete(req.params.id)
  res.json({ message: "User deleted" })
}
