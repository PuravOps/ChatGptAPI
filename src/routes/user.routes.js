const router = require("express").Router()
const controller = require("../controllers/user.controller")

router.post("/register", controller.register)
router.post("/login", controller.login)
router.get("/", controller.getUsers)
router.put("/:id", controller.updateUser)
router.delete("/:id", controller.deleteUser)

module.exports = router
