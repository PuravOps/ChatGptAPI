const router = require("express").Router()

const FALLBACK_QUOTES = [
  { quote: "Love grows in the small moments we choose each other.", author: "Mira Vale", category: "love" },
  { quote: "સાથે ચાલવાની મજા ત્યારે આવે, જ્યારે રસ્તો નહીં પણ સાથ ખાસ હોય.", author: "Kavya Mehta", category: "couple" },
  { quote: "કામ નાનું કે મોટું નથી હોતું, મનથી કરેલું કામ જ સફળતા બનાવે છે.", author: "Dhruv Shah", category: "work" },
  { quote: "સફળતા એ રોજની નાની હિંમતનો મોટો જવાબ છે.", author: "Riya Desai", category: "success" },
  { quote: "સપના ત્યારે સાચા થાય, જ્યારે પ્રયત્નો બહાના કરતાં મોટા બને.", author: "Aarav Trivedi", category: "achievement" },
  { quote: "આજે થોડું હસો, કાલે રસ્તો પોતે હળવો લાગશે.", author: "Nisha Vyas", category: "positivity" },
  { quote: "A soft heart can still carry a strong life.", author: "Elias Rowan", category: "life" },
  { quote: "Some people feel like home, even from far away.", author: "Nora Ellery", category: "love" },
  { quote: "What is meant for your peace will not keep breaking you.", author: "Iris Wren", category: "inside" },
  { quote: "Life becomes lighter when you stop fighting every season.", author: "Theo Marlowe", category: "life" },
  { quote: "A little joy today can change the shape of the whole day.", author: "Lena Hart", category: "happy" },
]

const CATEGORIES = new Set([
  "love",
  "couple",
  "work",
  "success",
  "achievement",
  "positivity",
  "life",
  "happy",
  "inside",
])

const LANGUAGES = new Map([
  ["english", "English"],
  ["en", "English"],
  ["gujarati", "Gujarati"],
  ["gu", "Gujarati"],
])

const getQuoteForDate = (dateKey) => {
  const seed = [...dateKey].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return FALLBACK_QUOTES[seed % FALLBACK_QUOTES.length]
}

const getIstDateKey = () => {
  const shifted = new Date(Date.now() + 330 * 60 * 1000)
  return shifted.toISOString().slice(0, 10)
}

const extractJsonObject = (value) => {
  const start = value.indexOf("{")
  const end = value.lastIndexOf("}")
  if (start < 0 || end <= start) return null

  try {
    return JSON.parse(value.slice(start, end + 1))
  } catch {
    return null
  }
}

const normalizeAiQuote = (candidate, fallback) => {
  const quote = typeof candidate?.quote === "string" ? candidate.quote.trim() : ""
  const author = typeof candidate?.author === "string" ? candidate.author.trim() : ""
  const category = typeof candidate?.category === "string" ? candidate.category.trim().toLowerCase() : ""

  if (!quote) return fallback

  return {
    quote: quote.slice(0, 220),
    author: author ? author.slice(0, 80) : fallback.author,
    category: CATEGORIES.has(category) ? category : fallback.category,
  }
}

const normalizeCategory = (value) => {
  const category = typeof value === "string" ? value.trim().toLowerCase() : ""
  return CATEGORIES.has(category) ? category : null
}

const normalizeLanguage = (value) => {
  const language = typeof value === "string" ? value.trim().toLowerCase() : ""
  return LANGUAGES.get(language) || null
}

const getGeminiQuote = async (dateKey, fallback, options = {}) => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (!apiKey) return null

  const requestedCategory = normalizeCategory(options.category)
  const requestedLanguage = normalizeLanguage(options.language)
  const model = process.env.GEMINI_QUOTE_MODEL || "gemini-3.5-flash-lite"
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const prompt = [
    "Generate one short original daily chat quote for a private chat app.",
    "Tone: warm, emotional, simple, not cheesy.",
    requestedCategory
      ? `Category must be exactly: ${requestedCategory}.`
      : "Topics/categories allowed: love, couple, work, success, achievement, positivity, life, happy, inside.",
    requestedLanguage
      ? `Language must be ${requestedLanguage}. Gujarati must be written in Gujarati script.`
      : "Language: choose either Gujarati or English. Use both languages across different days. Gujarati must be written in Gujarati script.",
    "Return only JSON with keys quote, author, category.",
    "Author must be one realistic fictional human name from this list: Mira Vale, Elias Rowan, Nora Ellery, Iris Wren, Theo Marlowe, Lena Hart, Kavya Mehta, Dhruv Shah, Riya Desai, Aarav Trivedi, Nisha Vyas.",
    "Do not use famous author names unless the quote is an exact public-domain quote.",
    "Quote must be under 160 characters.",
    `Date key: ${dateKey}.`,
  ].join(" ")

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.9,
        responseMimeType: "application/json",
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Gemini quote request failed with ${response.status}`)
  }

  const data = await response.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (typeof text !== "string") return null

  const normalized = normalizeAiQuote(extractJsonObject(text), fallback)
  return requestedCategory ? { ...normalized, category: requestedCategory } : normalized
}

router.get("/", async (req, res) => {
  const dateKey = typeof req.query.dateKey === "string" && req.query.dateKey.trim()
    ? req.query.dateKey.trim()
    : getIstDateKey()
  const fallback = getQuoteForDate(dateKey)
  const category = normalizeCategory(req.query.category)
  const language = normalizeLanguage(req.query.language)

  try {
    const aiQuote = await getGeminiQuote(dateKey, fallback, { category, language })
    return res.json({
      ...(aiQuote || fallback),
      dateKey,
      source: aiQuote ? "gemini" : "fallback",
    })
  } catch (error) {
    console.error("Gemini daily quote fallback:", error.message)
    return res.json({
      ...fallback,
      dateKey,
      source: "fallback",
    })
  }
})

module.exports = router
