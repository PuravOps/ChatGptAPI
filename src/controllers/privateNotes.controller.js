const crypto = require("crypto")
const PrivateNoteVault = require("../models/PrivateNoteVault")

const normalizePhone = (value) => (typeof value === "string" ? value.trim() : "")

const getEncryptionKey = () => {
  const secret = process.env.PRIVATE_NOTES_SECRET || process.env.JWT_SECRET
  if (!secret) {
    throw new Error("PRIVATE_NOTES_SECRET or JWT_SECRET is required")
  }
  return crypto.createHash("sha256").update(secret).digest()
}

const encryptNotes = (notes) => {
  const iv = crypto.randomBytes(12)
  const key = getEncryptionKey()
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const plaintext = Buffer.from(JSON.stringify({ notes }), "utf8")
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  }
}

const decryptNotes = (vault) => {
  if (!vault?.authTag) return []

  const key = getEncryptionKey()
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(vault.iv, "base64"),
  )
  decipher.setAuthTag(Buffer.from(vault.authTag, "base64"))

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(vault.ciphertext, "base64")),
    decipher.final(),
  ])
  const parsed = JSON.parse(plaintext.toString("utf8"))
  return Array.isArray(parsed?.notes) ? parsed.notes : []
}

const sanitizeNotes = (body = {}) => {
  const notes = Array.isArray(body.notes) ? body.notes : null
  if (!notes) return null

  return notes.map((note) => ({
    id: typeof note?.id === "string" ? note.id.trim() : "",
    heading: typeof note?.heading === "string" ? note.heading.trim() : "",
    content: typeof note?.content === "string" ? note.content : "",
    createdAt: typeof note?.createdAt === "string" ? note.createdAt : new Date().toISOString(),
    updatedAt: typeof note?.updatedAt === "string" ? note.updatedAt : new Date().toISOString(),
    reminderAt: typeof note?.reminderAt === "string" ? note.reminderAt : null,
    reminderSnoozedUntil:
      typeof note?.reminderSnoozedUntil === "string" ? note.reminderSnoozedUntil : null,
    reminderLastNotifiedAt:
      typeof note?.reminderLastNotifiedAt === "string" ? note.reminderLastNotifiedAt : null,
  }))
}

const mapVaultResponse = (vault, notes) => ({
  ownerPhone: vault.ownerPhone,
  targetUserPhone: vault.targetUserPhone,
  notes,
  createdAt: vault.createdAt,
  updatedAt: vault.updatedAt,
})

exports.getVault = async (req, res) => {
  try {
    const ownerPhone = req.authUser?.phone
    const targetUserPhone = normalizePhone(req.params.targetUserPhone)

    if (!ownerPhone || !targetUserPhone) {
      return res.status(400).json({ message: "targetUserPhone is required" })
    }

    const vault = await PrivateNoteVault.findOne({ ownerPhone, targetUserPhone })
    if (!vault) {
      return res.status(404).json({ message: "Private notes vault not found" })
    }

    const notes = decryptNotes(vault)
    return res.json(mapVaultResponse(vault, notes))
  } catch (err) {
    return res.status(500).json({ message: err.message })
  }
}

exports.createVault = async (req, res) => {
  try {
    const ownerPhone = req.authUser?.phone
    const targetUserPhone = normalizePhone(req.params.targetUserPhone)
    const notes = sanitizeNotes(req.body)

    if (!ownerPhone || !targetUserPhone) {
      return res.status(400).json({ message: "targetUserPhone is required" })
    }
    if (!notes) {
      return res.status(400).json({ message: "notes array is required" })
    }

    const existing = await PrivateNoteVault.findOne({ ownerPhone, targetUserPhone }).lean()
    if (existing) {
      return res.status(409).json({ message: "Private notes vault already exists" })
    }

    const encrypted = encryptNotes(notes)
    const vault = await PrivateNoteVault.create({
      ownerPhone,
      targetUserPhone,
      ...encrypted,
    })

    return res.status(201).json(mapVaultResponse(vault, notes))
  } catch (err) {
    return res.status(500).json({ message: err.message })
  }
}

exports.updateVault = async (req, res) => {
  try {
    const ownerPhone = req.authUser?.phone
    const targetUserPhone = normalizePhone(req.params.targetUserPhone)
    const notes = sanitizeNotes(req.body)

    if (!ownerPhone || !targetUserPhone) {
      return res.status(400).json({ message: "targetUserPhone is required" })
    }
    if (!notes) {
      return res.status(400).json({ message: "notes array is required" })
    }

    const encrypted = encryptNotes(notes)
    const vault = await PrivateNoteVault.findOneAndUpdate(
      { ownerPhone, targetUserPhone },
      { $set: encrypted },
      { new: true },
    )

    if (!vault) {
      return res.status(404).json({ message: "Private notes vault not found" })
    }

    return res.json(mapVaultResponse(vault, notes))
  } catch (err) {
    return res.status(500).json({ message: err.message })
  }
}
