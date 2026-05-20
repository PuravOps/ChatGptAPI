const jwt = require("jsonwebtoken")
const User = require("../models/User")

const requireAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || ""
    const [scheme, token] = header.split(" ")

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({ message: "Authorization token is required" })
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(payload.id).select("phone")

    if (!user) {
      return res.status(401).json({ message: "Invalid token" })
    }

    req.authUser = { id: String(user._id), phone: user.phone }
    next()
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" })
  }
}

module.exports = { requireAuth }
