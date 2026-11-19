// DEMO MODE ONLY — localStorage-backed accounts and entries.
// This is NOT secure and must never be used as real auth. It exists so the
// app can be previewed before Supabase is connected. Passwords are lightly
// obfuscated (not hashed securely) — demo data only, on this device only.

const USERS_KEY = 'standingo_demo_users'
const SESSION_KEY = 'standingo_demo_session'
const entriesKey = (userId) => `standingo_demo_entries_${userId}`

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    return v ? JSON.parse(v) : fallback
  } catch {
    return fallback
  }
}
function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}
function obfuscate(pw) {
  // Demo-only obfuscation, NOT security.
  return btoa(`standingo-demo::${pw}`)
}
export function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export const demoAuth = {
  getSessionUser() {
    const id = read(SESSION_KEY, null)
    if (!id) return null
    const users = read(USERS_KEY, [])
    return users.find((u) => u.id === id) || null
  },
  signUp(email, password) {
    const users = read(USERS_KEY, [])
    if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      throw new Error('An account with that email already exists on this device (demo mode).')
    }
    const user = { id: uid(), email, password: obfuscate(password), created_at: new Date().toISOString() }
    users.push(user)
    write(USERS_KEY, users)
    write(SESSION_KEY, user.id)
    return { id: user.id, email: user.email }
  },
  signIn(email, password) {
    const users = read(USERS_KEY, [])
    const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase())
    if (!user || user.password !== obfuscate(password)) {
      throw new Error('No demo account matched that email and password on this device.')
    }
    write(SESSION_KEY, user.id)
    return { id: user.id, email: user.email }
  },
  signOut() {
    localStorage.removeItem(SESSION_KEY)
  },
}

export const demoEntries = {
  list(userId) {
    return read(entriesKey(userId), []).sort((a, b) => (a.date_seen < b.date_seen ? 1 : -1))
  },
  insert(userId, entry) {
    const all = read(entriesKey(userId), [])
    const row = { ...entry, id: uid(), user_id: userId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    all.push(row)
    write(entriesKey(userId), all)
    return row
  },
  update(userId, id, entry) {
    const all = read(entriesKey(userId), [])
    const next = all.map((r) => (r.id === id ? { ...r, ...entry, updated_at: new Date().toISOString() } : r))
    write(entriesKey(userId), next)
    return next.find((r) => r.id === id)
  },
  remove(userId, id) {
    const all = read(entriesKey(userId), [])
    write(entriesKey(userId), all.filter((r) => r.id !== id))
  },
}
