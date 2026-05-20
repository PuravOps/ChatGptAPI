const router = require("express").Router()
const controller = require("../controllers/privateNotes.controller")
const { requireAuth } = require("../middleware/auth")

router.use(requireAuth)

router.get("/:targetUserPhone", controller.getVault)
router.post("/:targetUserPhone", controller.createVault)
router.put("/:targetUserPhone", controller.updateVault)

module.exports = router
