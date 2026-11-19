import { useEffect, useMemo, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabaseClient.js'
import { demoAuth, demoEntries } from './demoStore.js'
import { CATALOG, REGIONS } from './data/catalog.js'

// ---------- helpers ----------
const today = () => new Date().toISOString().slice(0, 10)
const fmtRating = (r) => (r ? Number(r).toFixed(1).replace(/\.0$/, '') : '—')
const PHOTO_BUCKET = 'entry-photos'
const newPhotoName = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`) + '.jpg'

// Shrink a picked photo to max 1200px on its long side, JPEG ~0.82.
// Returns { blob, dataUrl } — blob for Supabase Storage, dataUrl for demo mode.
// Falls back to the original file if the browser can't decode it (e.g. some HEIC cases).
async function processImage(file) {
  try {
    const url = URL.createObjectURL(file)
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = url
    })
    const scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    URL.revokeObjectURL(url)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (!blob) throw new Error('compress failed')
    return { blob, dataUrl: canvas.toDataURL('image/jpeg', 0.82) }
  } catch {
    return { blob: file, dataUrl: null }
  }
}

function Stars({ value, onChange }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value || 0
  return (
    <div className="stars" role="radiogroup" aria-label="Rating, half stars">
      {[1, 2, 3, 4, 5].map((star) => {
        const fill = Math.max(0, Math.min(1, shown - (star - 1)))
        return (
          <span key={star} className="star-wrap" aria-hidden="false">
            <span className="star-bg">★</span>
            <span className="star-fill" style={{ width: `${fill * 100}%` }}>★</span>
            {[0.5, 1].map((half) => (
              <button
                key={half}
                type="button"
                className="star-half"
                style={{ left: half === 0.5 ? 0 : '50%' }}
                aria-label={`${star - 1 + half} stars`}
                onMouseEnter={() => setHover(star - 1 + half)}
                onMouseLeave={() => setHover(0)}
                onClick={() => onChange && onChange(star - 1 + half)}
              />
            ))}
          </span>
        )
      })}
      <span className="rating-num">{value ? `${fmtRating(value)} / 5` : 'Tap to rate'}</span>
    </div>
  )
}

function StarsStatic({ value }) {
  return <span className="stars-static">{'★'.repeat(Math.round(value || 0))}<span className="dim">{'★'.repeat(5 - Math.round(value || 0))}</span> {fmtRating(value)}</span>
}

// ---------- auth ----------
function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError(''); setNotice(''); setBusy(true)
    try {
      if (!isSupabaseConfigured) {
        const user = mode === 'signup' ? demoAuth.signUp(email, password) : demoAuth.signIn(email, password)
        onAuthed(user)
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (data.session) onAuthed({ id: data.user.id, email: data.user.email })
        else setNotice('Check your email to confirm your account, then sign in. (For a private beta you can turn off email confirmation in Supabase Auth settings.)')
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        onAuthed({ id: data.user.id, email: data.user.email })
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally { setBusy(false) }
  }

  return (
    <div className="auth-card">
      <h2>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h2>
      <p className="muted">Log, rate and remember every show you've seen.</p>
      {!isSupabaseConfigured && (
        <p className="demo-banner">Demo mode — data stays on this device until Supabase is connected. Demo accounts are not secure; don't reuse a real password.</p>
      )}
      <form onSubmit={submit}>
        <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
        <label>Password<input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} /></label>
        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'signup' ? 'Sign up' : 'Sign in'}</button>
      </form>
      <button className="link" onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(''); setNotice('') }}>
        {mode === 'signup' ? 'Already have an account? Sign in' : "New here? Create an account"}
      </button>
    </div>
  )
}

// ---------- log / edit form ----------
const emptyForm = { production_title: '', production_region: '', venue: '', city: '', date_seen: today(), rating: 0, seat: '', review: '' }

function EntryForm({ initial, existingPhotoSrc, onSave, onCancel }) {
  const [form, setForm] = useState(initial || emptyForm)
  const [query, setQuery] = useState('')
  const [region, setRegion] = useState('All')
  const [manual, setManual] = useState(Boolean(initial && !CATALOG.some((c) => c.title === initial.production_title)))
  const [photo, setPhoto] = useState(null) // { blob, dataUrl } — newly picked photo
  const [photoPreview, setPhotoPreview] = useState(existingPhotoSrc || null)
  const [photoRemoved, setPhotoRemoved] = useState(false)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function pickPhoto(e) {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const processed = await processImage(file)
    setPhoto(processed)
    setPhotoRemoved(false)
    setPhotoPreview(processed.dataUrl || URL.createObjectURL(processed.blob))
  }

  function removePhoto() {
    setPhoto(null)
    setPhotoPreview(null)
    setPhotoRemoved(true)
  }

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return CATALOG.filter((c) => (region === 'All' || c.region === region) && (!q || c.title.toLowerCase().includes(q))).slice(0, 12)
  }, [query, region])

  function pick(c) {
    setForm((f) => ({ ...f, production_title: c.title, production_region: c.region, venue: c.venue.startsWith('Touring') ? '' : c.venue, city: c.city === 'Touring (US)' ? '' : c.city }))
    setManual(false)
  }

  async function submit(e) {
    e.preventDefault()
    if (!form.production_title.trim()) return alert('Pick a show or add one manually.')
    if (!form.rating) return alert('Add a rating (tap the stars).')
    setSaving(true)
    try {
      await onSave(
        { ...form, rating: Number(form.rating) },
        { blob: photo ? photo.blob : null, dataUrl: photo ? photo.dataUrl : null, remove: photoRemoved }
      )
    } finally { setSaving(false) }
  }

  return (
    <form className="entry-form" onSubmit={submit}>
      {!manual ? (
        <>
          <label>Find a show
            <input placeholder="Search the catalog — try Hadestown" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="chips">{REGIONS.map((r) => <button type="button" key={r} className={region === r ? 'chip active' : 'chip'} onClick={() => setRegion(r)}>{r}</button>)}</div>
          <div className="catalog-list">
            {matches.map((c) => (
              <button type="button" key={c.title + c.region} className={form.production_title === c.title && form.production_region === c.region ? 'catalog-item selected' : 'catalog-item'} onClick={() => pick(c)}>
                <strong>{c.title}</strong><span>{c.region} · {c.city}</span>
              </button>
            ))}
            {matches.length === 0 && <p className="muted">No match in the catalog.</p>}
          </div>
          <button type="button" className="link" onClick={() => setManual(true)}>Not listed? Add a show manually</button>
        </>
      ) : (
        <>
          <label>Show title<input required value={form.production_title} onChange={(e) => set('production_title', e.target.value)} placeholder="e.g. A Christmas Carol" /></label>
          <label>Production / region<input value={form.production_region} onChange={(e) => set('production_region', e.target.value)} placeholder="e.g. Regional, School, Community" /></label>
          <button type="button" className="link" onClick={() => setManual(false)}>Back to catalog search</button>
        </>
      )}
      {form.production_title && <p className="picked">Selected: <strong>{form.production_title}</strong>{form.production_region ? ` — ${form.production_region}` : ''}</p>}
      <div className="grid2">
        <label>Date seen<input type="date" required value={form.date_seen} onChange={(e) => set('date_seen', e.target.value)} /></label>
        <label>Seat<input value={form.seat} onChange={(e) => set('seat', e.target.value)} placeholder="e.g. Orchestra, Row K" /></label>
      </div>
      <div className="grid2">
        <label>Venue<input value={form.venue} onChange={(e) => set('venue', e.target.value)} placeholder="Theatre name" /></label>
        <label>City<input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="City" /></label>
      </div>
      <label>Your rating</label>
      <Stars value={form.rating} onChange={(v) => set('rating', v)} />
      <label>One-line review<input value={form.review} onChange={(e) => set('review', e.target.value)} placeholder="One line you'll remember" maxLength={140} /></label>
      <label>Photo (optional) — Playbill, ticket, or the view from your seat
        <input type="file" accept="image/*" onChange={pickPhoto} />
      </label>
      {photoPreview && (
        <div className="photo-preview">
          <img src={photoPreview} alt="Selected entry" />
          <button type="button" className="ghost small" onClick={removePhoto}>Remove photo</button>
        </div>
      )}
      <div className="row">
        <button className="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save entry'}</button>
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  )
}

// ---------- wrapped ----------
function drawWrapped(canvas, stats, scopeLabel) {
  const ctx = canvas.getContext('2d')
  canvas.width = 1080; canvas.height = 1350
  ctx.fillStyle = '#12101d'; ctx.fillRect(0, 0, 1080, 1350)
  ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 6; ctx.strokeRect(36, 36, 1008, 1278)
  ctx.fillStyle = '#d4af37'; ctx.font = 'bold 64px Georgia, serif'; ctx.textAlign = 'center'
  ctx.fillText('STANDING O', 540, 150)
  ctx.fillStyle = '#f5efe0'; ctx.font = '34px Georgia, serif'
  ctx.fillText(`My ${scopeLabel} in Theatre`, 540, 215)
  ctx.font = 'bold 150px Georgia, serif'; ctx.fillText(String(stats.total), 540, 420)
  ctx.font = '30px Georgia, serif'; ctx.fillText('shows logged', 540, 475)
  ctx.font = '36px Georgia, serif'
  ctx.fillText(`Average rating  ${stats.avg ? stats.avg.toFixed(1) + ' / 5' : '—'}`, 540, 580)
  ctx.fillText(`Venues  ${stats.venues}   ·   Cities  ${stats.cities}`, 540, 645)
  ctx.fillStyle = '#d4af37'; ctx.font = 'bold 38px Georgia, serif'; ctx.fillText('TOP SHOWS', 540, 770)
  ctx.fillStyle = '#f5efe0'; ctx.font = '34px Georgia, serif'
  stats.topShows.slice(0, 5).forEach((s, i) => ctx.fillText(`${s.production_title} — ${fmtRating(s.rating)}★`, 540, 835 + i * 58))
  if (stats.topVenue) { ctx.fillStyle = '#d4af37'; ctx.font = 'bold 32px Georgia, serif'; ctx.fillText(`Most-visited: ${stats.topVenue}`, 540, 1180) }
  ctx.fillStyle = '#9a94a8'; ctx.font = '26px Georgia, serif'; ctx.fillText('Standing O — Letterboxd for live theatre', 540, 1260)
}

function Wrapped({ entries }) {
  const years = useMemo(() => [...new Set(entries.map((e) => e.date_seen.slice(0, 4)))].sort().reverse(), [entries])
  const [scope, setScope] = useState('all')
  const scoped = scope === 'all' ? entries : entries.filter((e) => e.date_seen.startsWith(scope))
  const stats = useMemo(() => computeStats(scoped), [scoped])
  const label = scope === 'all' ? 'All-Time' : scope
  function download() {
    const canvas = document.createElement('canvas')
    drawWrapped(canvas, stats, label)
    const a = document.createElement('a')
    a.download = `standing-o-wrapped-${label.toLowerCase()}.png`
    a.href = canvas.toDataURL('image/png')
    a.click()
  }
  return (
    <div>
      <div className="chips">
        <button className={scope === 'all' ? 'chip active' : 'chip'} onClick={() => setScope('all')}>All time</button>
        {years.map((y) => <button key={y} className={scope === y ? 'chip active' : 'chip'} onClick={() => setScope(y)}>{y}</button>)}
      </div>
      <div className="wrapped-card">
        <div className="wrapped-inner">
          <h3>STANDING O</h3>
          <p>My {label} in Theatre</p>
          <div className="wrapped-total">{stats.total}</div>
          <p>shows logged</p>
          <p>Average rating {stats.avg ? stats.avg.toFixed(1) + ' / 5' : '—'}</p>
          <p>Venues {stats.venues} · Cities {stats.cities}</p>
          <h4>Top shows</h4>
          {stats.topShows.slice(0, 5).map((s) => <p key={s.id}>{s.production_title} — {fmtRating(s.rating)}★</p>)}
          {stats.topVenue && <p className="gold">Most-visited: {stats.topVenue}</p>}
        </div>
      </div>
      <button className="primary" onClick={download} disabled={scoped.length === 0}>Download PNG</button>
    </div>
  )
}

function computeStats(entries) {
  const total = entries.length
  const avg = total ? entries.reduce((s, e) => s + Number(e.rating || 0), 0) / total : 0
  const thisYear = entries.filter((e) => e.date_seen.startsWith(String(new Date().getFullYear()))).length
  const venues = new Set(entries.map((e) => e.venue).filter(Boolean)).size
  const cities = new Set(entries.map((e) => e.city).filter(Boolean)).size
  const topShows = [...entries].sort((a, b) => Number(b.rating) - Number(a.rating)).slice(0, 5)
  const count = (key) => { const m = {}; entries.forEach((e) => { if (e[key]) m[e[key]] = (m[e[key]] || 0) + 1 }); const top = Object.entries(m).sort((a, b) => b[1] - a[1])[0]; return top ? `${top[0]} (${top[1]})` : '' }
  return { total, avg, thisYear, venues, cities, topShows, topVenue: count('venue'), topCity: count('city') }
}

// ---------- main app ----------
export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState([])
  const [tab, setTab] = useState('diary')
  const [diaryQuery, setDiaryQuery] = useState('')
  const [editing, setEditing] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    async function init() {
      if (isSupabaseConfigured) {
        const { data } = await supabase.auth.getSession()
        if (data.session) setUser({ id: data.session.user.id, email: data.session.user.email })
        supabase.auth.onAuthStateChange((_e, session) => setUser(session ? { id: session.user.id, email: session.user.email } : null))
      } else {
        const u = demoAuth.getSessionUser()
        if (u) setUser({ id: u.id, email: u.email })
      }
      setLoading(false)
    }
    init()
  }, [])

  async function loadEntries(uid) {
    if (!uid) return
    setError('')
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase.from('diary_entries').select('*').order('date_seen', { ascending: false })
        if (error) throw error
        setEntries(data || [])
      } else setEntries(demoEntries.list(uid))
    } catch (err) { setError(err.message) }
  }
  useEffect(() => { if (user) loadEntries(user.id); else setEntries([]) }, [user])

  const [photoUrls, setPhotoUrls] = useState({})

  // Resolve private storage paths to short-lived signed URLs for display.
  useEffect(() => {
    if (!isSupabaseConfigured || entries.length === 0) return
    const paths = [...new Set(entries.map((e) => e.photo_path).filter(Boolean))]
    if (paths.length === 0) { setPhotoUrls({}); return }
    let cancelled = false
    supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 60 * 60 * 6).then(({ data }) => {
      if (cancelled || !data) return
      const map = {}
      data.forEach((d) => { if (d.path && d.signedUrl) map[d.path] = d.signedUrl })
      setPhotoUrls(map)
    })
    return () => { cancelled = true }
  }, [entries])

  const photoSrcFor = (e) => (isSupabaseConfigured ? (e.photo_path ? photoUrls[e.photo_path] : null) : (e.photo_data || null))

  async function saveEntry(entry, photo) {
    try {
      if (isSupabaseConfigured) {
        let photoPath = editing ? (editing.photo_path || null) : null
        if (photo && photo.remove && photoPath) {
          await supabase.storage.from(PHOTO_BUCKET).remove([photoPath])
          photoPath = null
        }
        if (photo && photo.blob) {
          const path = `${user.id}/${newPhotoName()}`
          const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, photo.blob, { contentType: 'image/jpeg', upsert: false })
          if (upErr) throw upErr
          if (photoPath) await supabase.storage.from(PHOTO_BUCKET).remove([photoPath])
          photoPath = path
        }
        const row = { ...entry, photo_path: photoPath }
        if (editing) {
          const { error } = await supabase.from('diary_entries').update({ ...row, updated_at: new Date().toISOString() }).eq('id', editing.id)
          if (error) throw error
          setEditing(null)
        } else {
          const { error } = await supabase.from('diary_entries').insert({ ...row, user_id: user.id })
          if (error) throw error
        }
      } else {
        let photoData = editing ? (editing.photo_data || null) : null
        if (photo && photo.remove) photoData = null
        if (photo && photo.dataUrl) photoData = photo.dataUrl
        const row = { ...entry, photo_data: photoData }
        if (editing) { demoEntries.update(user.id, editing.id, row); setEditing(null) }
        else demoEntries.insert(user.id, row)
      }
      await loadEntries(user.id)
      setTab('diary')
    } catch (err) { setError(err.message) }
  }

  async function removeEntry(entry) {
    try {
      if (isSupabaseConfigured) {
        const { error } = await supabase.from('diary_entries').delete().eq('id', entry.id)
        if (error) throw error
        if (entry.photo_path) await supabase.storage.from(PHOTO_BUCKET).remove([entry.photo_path])
      } else demoEntries.remove(user.id, entry.id)
      setConfirmDelete(null)
      await loadEntries(user.id)
    } catch (err) { setError(err.message) }
  }

  async function signOut() {
    if (isSupabaseConfigured) await supabase.auth.signOut()
    else demoAuth.signOut()
    setUser(null)
  }

  const stats = useMemo(() => computeStats(entries), [entries])
  const diaryShown = entries.filter((e) => `${e.production_title} ${e.venue} ${e.city} ${e.review}`.toLowerCase().includes(diaryQuery.toLowerCase()))

  return (
    <div className="app">
      <header className="marquee">
        <div className="bulbs">✦ ✦ ✦</div>
        <h1>Standing O</h1>
        <p>Letterboxd for live theatre</p>
      </header>
      {!isSupabaseConfigured && <p className="demo-banner top">Demo mode — data stays on this device until Supabase is connected.</p>}
      {loading ? <p className="center">Loading…</p> : !user ? <AuthScreen onAuthed={setUser} /> : (
        <main>
          <div className="userbar"><span>{user.email}</span><button className="ghost small" onClick={signOut}>Sign out</button></div>
          <nav className="tabs">
            {[['diary', 'Diary'], ['log', 'Log a show'], ['stats', 'Stats'], ['wrapped', 'Wrapped']].map(([k, label]) => (
              <button key={k} className={tab === k ? 'tab active' : 'tab'} onClick={() => { setTab(k); setEditing(null) }}>{label}</button>
            ))}
          </nav>
          {error && <p className="error">{error}</p>}
          {tab === 'diary' && (
            <section>
              <input placeholder="Search your diary" value={diaryQuery} onChange={(e) => setDiaryQuery(e.target.value)} />
              {editing ? <EntryForm initial={editing} existingPhotoSrc={photoSrcFor(editing)} onSave={saveEntry} onCancel={() => setEditing(null)} /> : null}
              {!editing && diaryShown.length === 0 && <p className="muted center">No entries yet. Tap “Log a show” to add your first.</p>}
              {!editing && diaryShown.map((e) => (
                <article key={e.id} className="card">
                  <div className="card-head"><h3>{e.production_title}</h3><StarsStatic value={Number(e.rating)} /></div>
                  {photoSrcFor(e) && <img className="entry-photo" src={photoSrcFor(e)} alt={`Photo from ${e.production_title}`} loading="lazy" />}
                  <p className="muted">{e.date_seen} · {e.production_region || ''}{e.venue ? ` · ${e.venue}` : ''}{e.city ? `, ${e.city}` : ''}{e.seat ? ` · Seat: ${e.seat}` : ''}</p>
                  {e.review && <p>“{e.review}”</p>}
                  <div className="row">
                    <button className="ghost small" onClick={() => setEditing(e)}>Edit</button>
                    {confirmDelete === e.id
                      ? <><span>Delete this entry?</span><button className="danger small" onClick={() => removeEntry(e)}>Confirm delete</button><button className="ghost small" onClick={() => setConfirmDelete(null)}>Keep</button></>
                      : <button className="ghost small" onClick={() => setConfirmDelete(e.id)}>Delete</button>}
                  </div>
                </article>
              ))}
            </section>
          )}
          {tab === 'log' && <section><EntryForm onSave={saveEntry} /></section>}
          {tab === 'stats' && (
            <section className="stats-grid">
              <div className="stat"><strong>{stats.total}</strong><span>Total shows</span></div>
              <div className="stat"><strong>{stats.avg ? stats.avg.toFixed(1) : '—'}</strong><span>Average rating</span></div>
              <div className="stat"><strong>{stats.thisYear}</strong><span>Shows this year</span></div>
              <div className="stat"><strong>{stats.venues}</strong><span>Distinct venues</span></div>
              <div className="stat"><strong>{stats.cities}</strong><span>Distinct cities</span></div>
              <div className="stat wide"><strong>Top-rated</strong>{stats.topShows.length ? stats.topShows.map((s) => <p key={s.id}>{s.production_title} — {fmtRating(s.rating)}★</p>) : <p className="muted">Nothing logged yet.</p>}</div>
            </section>
          )}
          {tab === 'wrapped' && <section><Wrapped entries={entries} /></section>}
        </main>
      )}
      <footer>
        <p>Standing O — log, rate and remember every show you've seen.</p>
        <p className="muted">Theatre Diary was the working name for this project.</p>
        <p className="muted">Catalog: {CATALOG.length} productions · No poster art is used.</p>
      </footer>
    </div>
  )
}
