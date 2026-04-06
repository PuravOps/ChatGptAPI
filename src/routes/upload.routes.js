const express = require("express")
const crypto = require("crypto")

const router = express.Router()

const sha1 = (value) => crypto.createHash("sha1").update(value).digest("hex")

const signCloudinaryParams = (params, apiSecret) => {
  const keys = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort()
  const toSign = keys.map((k) => `${k}=${params[k]}`).join("&")
  return sha1(`${toSign}${apiSecret}`)
}

const pickResourceType = (mimeType) => {
  const mt = (mimeType || "").toLowerCase()
  if (mt.startsWith("image/")) return "image"
  if (mt.startsWith("video/")) return "video"
  if (mt === "application/pdf") return "raw"
  return "auto"
}

router.post(
  "/",
  express.raw({
    type: ["image/*", "video/*", "application/pdf", "application/octet-stream"],
    limit: "50mb",
  }),
  async (req, res) => {
    try {
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME
      const apiKey = process.env.CLOUDINARY_API_KEY
      const apiSecret = process.env.CLOUDINARY_API_SECRET
      const folder = process.env.CLOUDINARY_FOLDER

      if (!cloudName || !apiKey || !apiSecret) {
        return res.status(500).json({ message: "Missing Cloudinary env vars" })
      }

      const mimeTypeHeader = (req.headers["content-type"] || "").toString()
      const mimeType = mimeTypeHeader.split(";")[0].trim() || undefined

      const nameHeader = req.get("x-file-name")
      let fileName = nameHeader || undefined
      if (fileName) {
        try {
          fileName = decodeURIComponent(fileName)
        } catch {
          // keep as-is
        }
      }

      const buf = req.body
      if (!Buffer.isBuffer(buf) || buf.length === 0) {
        return res.status(400).json({ message: "Empty file body" })
      }

      const timestamp = Math.floor(Date.now() / 1000)
      const paramsToSign = { timestamp, folder: folder || undefined }
      const signature = signCloudinaryParams(paramsToSign, apiSecret)

      const resourceType = pickResourceType(mimeType)
      const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/upload`

      const form = new FormData()
      const blob = new Blob([buf], { type: mimeType || "application/octet-stream" })
      form.append("file", blob, fileName || "upload")
      form.append("api_key", apiKey)
      form.append("timestamp", String(timestamp))
      if (folder) form.append("folder", folder)
      form.append("signature", signature)

      const resp = await fetch(endpoint, { method: "POST", body: form })
      const data = await resp.json()

      if (!resp.ok) {
        return res.status(resp.status).json({
          message: data?.error?.message || "Cloudinary upload failed",
          error: data?.error || undefined,
        })
      }

      const url = data.secure_url || data.url
      if (!url) return res.status(500).json({ message: "Cloudinary did not return a URL" })

      const ext = data.format ? `.${data.format}` : ""
      const outName = data.original_filename ? `${data.original_filename}${ext}` : fileName

      return res.json({
        url,
        bytes: data.bytes,
        fileName: outName,
        mimeType,
        resourceType: data.resource_type,
        publicId: data.public_id,
      })
    } catch (error) {
      console.error("upload failed", error)
      return res.status(500).json({ message: "Upload failed" })
    }
  },
)

module.exports = router
