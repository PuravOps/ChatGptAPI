const User = require("../models/User")

const TYPING_TIMEOUT_MS = 4000
const PERSIST_THROTTLE_MS = 15000

const normalizePhone = (value) => (typeof value === "string" ? value.trim() : "")

const createPresenceStore = (io) => {
  const users = new Map()
  const socketToUser = new Map()

  const ensureUser = (userPhone) => {
    const phone = normalizePhone(userPhone)
    if (!phone) return null

    let entry = users.get(phone)
    if (!entry) {
      entry = {
        userPhone: phone,
        socketIds: new Set(),
        status: "offline",
        lastActiveAt: null,
        lastPersistedAt: 0,
        isChatActive: false,
        activeThreadPhone: null,
        typingTargetPhone: null,
        typingExpiresAt: null,
      }
      users.set(phone, entry)
    }

    return entry
  }

  const cleanupUserIfIdle = (entry) => {
    if (!entry) return
    if (entry.socketIds.size > 0) return
    if (entry.typingTargetPhone) return
    users.delete(entry.userPhone)
  }

  const emitTypingUpdate = (userPhone, targetUserPhone, isTyping) => {
    const actor = normalizePhone(userPhone)
    const target = normalizePhone(targetUserPhone)
    if (!actor || !target) return

    io.to(target).emit("typing:update", {
      userPhone: actor,
      targetUserPhone: target,
      isTyping,
    })
  }

  const emitPresenceToViewers = (targetUserPhone) => {
    const target = normalizePhone(targetUserPhone)
    if (!target) return

    const snapshot = api.getPresenceForViewer(target, null)
    if (!snapshot) return

    for (const [viewerPhone, entry] of users.entries()) {
      if (entry.activeThreadPhone !== target) continue
      io.to(viewerPhone).emit("presence:update", {
        userPhone: target,
        status: snapshot.status,
        lastActiveAt: snapshot.lastActiveAt,
      })
    }
  }

  const persistLastActive = async (entry, { force = false } = {}) => {
    if (!entry?.lastActiveAt) return
    const now = Date.now()
    if (!force && now - entry.lastPersistedAt < PERSIST_THROTTLE_MS) return

    entry.lastPersistedAt = now
    try {
      await User.updateOne(
        { phone: entry.userPhone },
        { $set: { lastActiveAt: new Date(entry.lastActiveAt) } },
      )
    } catch (err) {
      console.error("presence persistLastActive error:", err)
    }
  }

  const markInactive = (entry, { persist = true, emit = true } = {}) => {
    if (!entry) return

    const prevStatus = entry.status
    if (!entry.lastActiveAt) {
      entry.lastActiveAt = Date.now()
    }
    entry.status = "offline"

    if (persist) {
      void persistLastActive(entry, { force: true })
    }

    if (emit && prevStatus !== "offline") {
      emitPresenceToViewers(entry.userPhone)
    }
  }

  const setTyping = (entry, targetUserPhone, isTyping) => {
    if (!entry) return

    const nextTarget = isTyping ? normalizePhone(targetUserPhone) : null
    const prevTarget = entry.typingTargetPhone
    const now = Date.now()

    if (!nextTarget) {
      entry.typingTargetPhone = null
      entry.typingExpiresAt = null
      if (prevTarget) emitTypingUpdate(entry.userPhone, prevTarget, false)
      return
    }

    entry.typingTargetPhone = nextTarget
    entry.typingExpiresAt = now + TYPING_TIMEOUT_MS

    if (prevTarget && prevTarget !== nextTarget) {
      emitTypingUpdate(entry.userPhone, prevTarget, false)
    }

    emitTypingUpdate(entry.userPhone, nextTarget, true)
  }

  const clearTypingIfExpired = (entry, now = Date.now()) => {
    if (!entry?.typingTargetPhone || !entry.typingExpiresAt) return false
    if (entry.typingExpiresAt > now) return false
    setTyping(entry, null, false)
    return true
  }

  const markActive = (entry) => {
    if (!entry) return

    const prevStatus = entry.status
    entry.lastActiveAt = Date.now()
    entry.status = "online"
    void persistLastActive(entry)

    if (prevStatus !== "online") {
      emitPresenceToViewers(entry.userPhone)
    }
  }

  const api = {
    join(userPhone, socketId) {
      const entry = ensureUser(userPhone)
      if (!entry) return
      entry.socketIds.add(socketId)
      socketToUser.set(socketId, entry.userPhone)
      if (!entry.lastActiveAt) {
        entry.lastActiveAt = Date.now()
        void persistLastActive(entry)
      }
    },

    setActiveThread(userPhone, activeThreadPhone, isChatActive = true) {
      const entry = ensureUser(userPhone)
      if (!entry) return

      const nextIsChatActive = Boolean(isChatActive)
      const nextThread = normalizePhone(activeThreadPhone) || null
      if (entry.activeThreadPhone === nextThread && entry.isChatActive === nextIsChatActive) return

      if (entry.typingTargetPhone && entry.typingTargetPhone !== nextThread) {
        setTyping(entry, null, false)
      }

      entry.isChatActive = nextIsChatActive
      entry.activeThreadPhone = nextThread

      if (!entry.isChatActive) {
        markInactive(entry)
        return
      }

      markActive(entry)
      emitPresenceToViewers(entry.userPhone)

      const snapshot = api.getPresenceForViewer(nextThread, entry.userPhone)
      if (snapshot) {
        io.to(entry.userPhone).emit("presence:update", {
          userPhone: nextThread,
          status: snapshot.status,
          lastActiveAt: snapshot.lastActiveAt,
        })
        io.to(entry.userPhone).emit("typing:update", {
          userPhone: nextThread,
          targetUserPhone: entry.userPhone,
          isTyping: snapshot.isTyping,
        })
      }
    },

    heartbeat(userPhone, activeThreadPhone, isChatActive = true) {
      const entry = ensureUser(userPhone)
      if (!entry) return
      if (activeThreadPhone !== undefined) {
        api.setActiveThread(entry.userPhone, activeThreadPhone, isChatActive)
      }
      if (!entry.isChatActive) return
      markActive(entry)
    },

    startTyping(userPhone, targetUserPhone) {
      const entry = ensureUser(userPhone)
      if (!entry) return
      markActive(entry)
      setTyping(entry, targetUserPhone, true)
    },

    stopTyping(userPhone, targetUserPhone) {
      const entry = ensureUser(userPhone)
      if (!entry) return
      if (targetUserPhone && normalizePhone(targetUserPhone) !== entry.typingTargetPhone) return
      setTyping(entry, null, false)
    },

    disconnectSocket(socketId) {
      const userPhone = socketToUser.get(socketId)
      if (!userPhone) return

      socketToUser.delete(socketId)
      const entry = users.get(userPhone)
      if (!entry) return

      entry.socketIds.delete(socketId)
      if (entry.socketIds.size > 0) return

      if (entry.typingTargetPhone) {
        setTyping(entry, null, false)
      }

      entry.isChatActive = false
      entry.activeThreadPhone = null
      markInactive(entry)
      cleanupUserIfIdle(entry)
    },

    getPresenceForViewer(targetUserPhone, viewerPhone) {
      const target = normalizePhone(targetUserPhone)
      if (!target) return null

      const entry = users.get(target)
      const now = Date.now()
      const isTyping = Boolean(
        entry &&
          normalizePhone(viewerPhone) &&
          entry.typingTargetPhone === normalizePhone(viewerPhone) &&
          entry.typingExpiresAt &&
          entry.typingExpiresAt > now,
      )

      if (!entry || entry.socketIds.size === 0) {
        return {
          userPhone: target,
          status: "offline",
          lastActiveAt: entry?.lastActiveAt ? new Date(entry.lastActiveAt).toISOString() : null,
          isTyping: false,
        }
      }

      clearTypingIfExpired(entry, now)

      return {
        userPhone: target,
        status: entry.status,
        lastActiveAt: entry.lastActiveAt ? new Date(entry.lastActiveAt).toISOString() : null,
        isTyping,
      }
    },

    sweep() {
      const now = Date.now()

      for (const entry of users.values()) {
        if (clearTypingIfExpired(entry, now)) {
          cleanupUserIfIdle(entry)
        }
      }
    },
  }

  setInterval(() => {
    api.sweep()
  }, 15000).unref?.()

  return api
}

module.exports = {
  TYPING_TIMEOUT_MS,
  createPresenceStore,
}
