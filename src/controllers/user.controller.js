const User = require("../models/User")
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")

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

    res.status(201).json(user)
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

    res.json({ token, user })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// Get All Users
exports.getUsers = async (req, res) => {
  const users = await User.find().select("-password")
  res.json(users)
}

// Update User
exports.updateUser = async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true }
  )
  res.json(user)
}

// Delete User
exports.deleteUser = async (req, res) => {
  await User.findByIdAndDelete(req.params.id)
  res.json({ message: "User deleted" })
}
