const mongoose = require("mongoose")

const privateNoteVaultSchema = new mongoose.Schema(
  {
    ownerPhone: { type: String, required: true, trim: true },
    targetUserPhone: { type: String, required: true, trim: true },
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
  },
  { timestamps: true },
)

privateNoteVaultSchema.index({ ownerPhone: 1, targetUserPhone: 1 }, { unique: true })

module.exports = mongoose.model("PrivateNoteVault", privateNoteVaultSchema)
