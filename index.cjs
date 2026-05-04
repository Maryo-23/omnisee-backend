const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'https://omnisee-backend.onrender.com';
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// ---- SQLITE ----
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data.sqlite');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, username TEXT UNIQUE NOT NULL,
    display_name TEXT, bio TEXT, avatar_url TEXT, password_hash TEXT,
    customDomain TEXT, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY, user_id TEXT, media_url TEXT, media_type TEXT,
    caption TEXT, location TEXT, likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY, post_id TEXT, user_id TEXT, text TEXT,
    likes_count INTEGER DEFAULT 0, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS tours (
    id TEXT PRIMARY KEY, user_id TEXT, title TEXT, description TEXT,
    cover_url TEXT, status TEXT DEFAULT 'draft', price REAL DEFAULT 0, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS tour_scenes (
    id TEXT PRIMARY KEY, tour_id TEXT, title TEXT, panorama_url TEXT,
    initial_yaw REAL DEFAULT 0, initial_pitch REAL DEFAULT 0,
    initial_fov REAL DEFAULT 1.5708, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS tour_hotspots (
    id TEXT PRIMARY KEY, tour_id TEXT, scene_id TEXT, target_scene_id TEXT,
    yaw REAL, pitch REAL, text TEXT, created_at TEXT
  );
`);

const fallbackUsers = [
  { id: 'demo1', email: 'demo@demo.com', username: 'demo', display_name: 'Demo User', password_hash: 'any', bio: 'Hello!', avatar_url: '', customDomain: '', created_at: '2026-01-01' },
  { id: 'maryo', email: 'AndrewwerdnA7@protonmail.com', username: 'Maryo23', display_name: 'Maryo23', password_hash: 'any', bio: '', avatar_url: '', customDomain: '', created_at: '2026-01-01' }
];
const insertUser = db.prepare('INSERT OR IGNORE INTO users VALUES (?,?,?,?,?,?,?,?,?)');
fallbackUsers.forEach(u => insertUser.run(u.id, u.email, u.username, u.display_name, u.password_hash, u.bio, u.avatar_url, u.customDomain, u.created_at));

function rowToUser(r) { return r ? { id:r.id, email:r.email, username:r.username, display_name:r.display_name, bio:r.bio, avatar_url:r.avatar_url, customDomain:r.customDomain, created_at:r.created_at } : null; }
function rowToPost(r) { return r ? { id:r.id, user_id:r.user_id, media_url:r.media_url, media_type:r.media_type, caption:r.caption, location:r.location, likes_count:r.likes_count, comments_count:r.comments_count, created_at:r.created_at } : null; }
function rowToComment(r) { return r ? { id:r.id, post_id:r.post_id, user_id:r.user_id, text:r.text, likes_count:r.likes_count, created_at:r.created_at } : null; }
function rowToTour(r) { return r ? { id:r.id, user_id:r.user_id, title:r.title, description:r.description, cover_url:r.cover_url, status:r.status, price:r.price, created_at:r.created_at } : null; }
function rowToScene(r) { return r ? { id:r.id, tour_id:r.tour_id, title:r.title, panorama_url:r.panorama_url, initial_yaw:r.initial_yaw, initial_pitch:r.initial_pitch, initial_fov:r.initial_fov, created_at:r.created_at } : null; }
function rowToHotspot(r) { return r ? { id:r.id, tour_id:r.tour_id, scene_id:r.scene_id, target_scene_id:r.target_scene_id, yaw:r.yaw, pitch:r.pitch, text:r.text, created_at:r.created_at } : null; }

function ap(res, data) { res.set('Content-Type', 'application/activity+json'); res.json(data); }
function getActorUrl(username) { return `${HOST}/ap/users/${username}`; }

app.use(cors());
app.use(express.json({ type: ['application/json', 'application/activity+json'] }));
app.use('/uploads', cors(), express.static(UPLOAD_DIR));

// ---- USERS ----
app.get('/api/users', (req, res) => { res.json(db.prepare('SELECT * FROM users').all().map(rowToUser)); });

app.post('/api/register', (req, res) => {
  const { email, password, username, displayName } = req.body;
  if (db.prepare('SELECT * FROM users WHERE email = ?').get(email)) return res.status(400).json({ error: 'Email already exists' });
  if (db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username)) return res.status(400).json({ error: 'Username already exists' });
  if (username.toLowerCase() === 'maryo23') {
    if (email.toLowerCase() !== 'AndrewwerdnA7@protonmail.com'.toLowerCase()) return res.status(403).json({ error: 'Username reserved' });
  }
  const id = crypto.randomUUID();
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)').run(id, email, username, displayName||username, '', '', hash, '', new Date().toISOString());
  res.json({ success: true, user: rowToUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) });
});

app.post('/api/login', (req, res) => {
  const { email } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ success: true, user: rowToUser(user) });
});

app.post('/api/users/change-password', (req, res) => {
  const { email, oldPassword, newPassword } = req.body;
  const oldHash = crypto.createHash('sha256').update(oldPassword).digest('hex');
  const user = db.prepare('SELECT * FROM users WHERE email=? AND password_hash=?').get(email, oldHash);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(crypto.createHash('sha256').update(newPassword).digest('hex'), user.id);
  res.json({ success: true });
});

app.post('/api/users/update-profile', (req, res) => {
  const { userId, displayName, bio, avatarUrl, customDomain } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (displayName !== undefined) db.prepare('UPDATE users SET display_name=? WHERE id=?').run(displayName, userId);
  if (bio !== undefined) db.prepare('UPDATE users SET bio=? WHERE id=?').run(bio, userId);
  if (avatarUrl !== undefined) db.prepare('UPDATE users SET avatar_url=? WHERE id=?').run(avatarUrl, userId);
  if (customDomain !== undefined) {
    const clean = customDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    db.prepare('UPDATE users SET customDomain=? WHERE id=?').run(clean, userId);
  }
  res.json({ success: true, user: rowToUser(db.prepare('SELECT * FROM users WHERE id=?').get(userId)) });
});

app.get('/api/users/:id', (req, res) => { const u = rowToUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id)); if (!u) return res.status(404).json({ error: 'Not found' }); res.json(u); });
app.get('/api/users/by-username/:username', (req, res) => { const u = rowToUser(db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(req.params.username)); if (!u) return res.status(404).json({ error: 'Not found' }); res.json(u); });

// ---- POSTS ----
app.get('/api/posts', (req, res) => {
  const rows = db.prepare('SELECT * FROM posts ORDER BY created_at DESC').all();
  const posts = rows.map(p => {
    const u = rowToUser(db.prepare('SELECT * FROM users WHERE id=?').get(p.user_id));
    return { ...rowToPost(p), username: u?.username, displayName: u?.display_name, avatarUrl: u?.avatar_url };
  });
  res.json(posts);
});

app.post('/api/posts', upload.single('file'), (req, res) => {
  const { userId, caption, mediaType } = req.body;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  const id = crypto.randomUUID();
  const mediaUrl = `${HOST}/uploads/${req.file.filename}`;
  const type = mediaType || (req.file.mimetype.startsWith('video/') ? 'video' : 'photo');
  db.prepare('INSERT INTO posts (id,user_id,media_url,media_type,caption,likes_count,comments_count,created_at) VALUES (?,?,?,?,?,0,0,?)').run(id, userId, mediaUrl, type, caption||'', new Date().toISOString());
  res.json({ success: true, post: rowToPost(db.prepare('SELECT * FROM posts WHERE id=?').get(id)) });
});

app.delete('/api/posts/:id', (req, res) => {
  const post = rowToPost(db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id));
  if (!post) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM posts WHERE id=?').run(req.params.id);
  res.json({ success: true, deleted: post });
});

app.patch('/api/posts/:id', (req, res) => {
  const { caption, location } = req.body;
  const post = rowToPost(db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id));
  if (!post) return res.status(404).json({ error: 'Not found' });
  if (caption !== undefined) db.prepare('UPDATE posts SET caption=? WHERE id=?').run(caption, req.params.id);
  if (location !== undefined) db.prepare('UPDATE posts SET location=? WHERE id=?').run(location, req.params.id);
  res.json({ success: true, post: rowToPost(db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id)) });
});

app.post('/api/posts/:id/like', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE posts SET likes_count = likes_count + 1 WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ---- COMMENTS ----
app.get('/api/posts/:id/comments', (req, res) => {
  const rows = db.prepare('SELECT * FROM comments WHERE post_id=?').all(req.params.id);
  const comments = rows.map(c => {
    const u = rowToUser(db.prepare('SELECT * FROM users WHERE id=?').get(c.user_id));
    return { ...rowToComment(c), username: u?.username, displayName: u?.display_name, avatarUrl: u?.avatar_url };
  });
  res.json(comments);
});

app.post('/api/posts/:id/comments', (req, res) => {
  const { userId, text } = req.body;
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO comments (id,post_id,user_id,text,likes_count,created_at) VALUES (?,?,?,?,0,?)').run(id, req.params.id, userId, text, new Date().toISOString());
  db.prepare('UPDATE posts SET comments_count = comments_count + 1 WHERE id=?').run(req.params.id);
  const c = rowToComment(db.prepare('SELECT * FROM comments WHERE id=?').get(id));
  const u = rowToUser(db.prepare('SELECT * FROM users WHERE id=?').get(userId));
  res.json({ success: true, comment: { ...c, username: u?.username, displayName: u?.display_name, avatarUrl: u?.avatar_url } });
});

// ---- TOURS ----
app.post('/api/tours', upload.single('cover'), (req, res) => {
  const { userId, title, description } = req.body;
  const id = crypto.randomUUID();
  const coverUrl = req.file ? `${HOST}/uploads/${req.file.filename}` : '';
  db.prepare('INSERT INTO tours (id,user_id,title,description,cover_url,status,price,created_at) VALUES (?,?,?,?,?,?,0,?)').run(id, userId, title||'Untitled Tour', description||'', coverUrl, 'draft', new Date().toISOString());
  res.json({ success: true, tour: rowToTour(db.prepare('SELECT * FROM tours WHERE id=?').get(id)) });
});

app.get('/api/tours', (req, res) => {
  const rows = db.prepare('SELECT * FROM tours ORDER BY created_at DESC').all();
  const tours = rows.map(t => {
    const u = rowToUser(db.prepare('SELECT * FROM users WHERE id=?').get(t.user_id));
    const sceneCount = db.prepare('SELECT COUNT(*) as c FROM tour_scenes WHERE tour_id=?').get(t.tour_id).c;
    return { ...rowToTour(t), username: u?.username, displayName: u?.display_name, sceneCount };
  });
  res.json(tours);
});

app.get('/api/tours/:id', (req, res) => {
  const tour = rowToTour(db.prepare('SELECT * FROM tours WHERE id=?').get(req.params.id));
  if (!tour) return res.status(404).json({ error: 'Not found' });
  const scenes = db.prepare('SELECT * FROM tour_scenes WHERE tour_id=?').all(req.params.id).map(s => ({
    ...rowToScene(s),
    hotspots: db.prepare('SELECT * FROM tour_hotspots WHERE scene_id=?').all(s.id).map(rowToHotspot)
  }));
  res.json({ ...tour, scenes });
});

app.post('/api/tours/:id/scenes', upload.single('panorama'), (req, res) => {
  const { title } = req.body;
  const id = crypto.randomUUID();
  const panoramaUrl = req.file ? `${HOST}/uploads/${req.file.filename}` : '';
  db.prepare('INSERT INTO tour_scenes (id,tour_id,title,panorama_url,initial_yaw,initial_pitch,initial_fov,created_at) VALUES (?,?,?,?,0,0,1.5708,?)').run(id, req.params.id, title||'Scene', panoramaUrl, new Date().toISOString());
  res.json({ success: true, scene: rowToScene(db.prepare('SELECT * FROM tour_scenes WHERE id=?').get(id)) });
});

app.post('/api/tours/:id/hotspots', (req, res) => {
  const { sceneId, targetSceneId, yaw, pitch, text } = req.body;
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO tour_hotspots (id,tour_id,scene_id,target_scene_id,yaw,pitch,text,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, req.params.id, sceneId, targetSceneId, yaw||0, pitch||0, text||'', new Date().toISOString());
  res.json({ success: true, hotspot: rowToHotspot(db.prepare('SELECT * FROM tour_hotspots WHERE id=?').get(id)) });
});

app.delete('/api/tours/:id', (req, res) => {
  db.prepare('DELETE FROM tour_hotspots WHERE tour_id=?').run(req.params.id);
  db.prepare('DELETE FROM tour_scenes WHERE tour_id=?').run(req.params.id);
  db.prepare('DELETE FROM tours WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ---- STRIPE ----
let stripe = null;
try {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
} catch (e) { console.log('Stripe not configured'); }

app.post('/api/create-payment-intent', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured. Add STRIPE_SECRET_KEY env var.' });
  try {
    const { amount, currency = 'usd' } = req.body;
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency,
      automatic_payment_methods: { enabled: true }
    });
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- ACTIVITYPUB ----
app.get('/.well-known/host-meta', (req, res) => {
  res.set('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><XRD xmlns="http://docs.oasis-open.org/ns/xri/xsd-"><Link rel="lrdd" type="application/xrd+xml" template="${HOST}/.well-known/webfinger?resource={uri}"/></XRD>`);
});

app.get('/.well-known/webfinger', (req, res) => {
  const resource = req.query.resource;
  if (!resource) return res.status(400).json({ error: 'Missing resource' });
  let handle = resource.replace('acct:', '');
  let domain = 'omnisee.app';
  if (handle.includes('@')) { const p = handle.split('@'); handle = p[0]; domain = p[1]; }
  const user = rowToUser(db.prepare('SELECT * FROM users WHERE username=?').get(handle));
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ subject: `acct:${handle}@${user.customDomain || domain}`, links: [{ rel: 'self', type: 'application/activity+json', href: `${HOST}/ap/users/${handle}` }] });
});

app.get('/ap/users/:username', (req, res) => {
  const user = rowToUser(db.prepare('SELECT * FROM users WHERE username=?').get(req.params.username));
  if (!user) return res.status(404).json({ error: 'User not found' });
  ap(res, { '@context': 'https://www.w3.org/ns/activitystreams', id: getActorUrl(user.username), type: 'Person', preferredUsername: user.username, name: user.display_name, summary: user.bio, icon: user.avatar_url ? [{ type: 'Image', url: user.avatar_url }] : [], inbox: `${getActorUrl(user.username)}/inbox`, outbox: `${getActorUrl(user.username)}/outbox`, followers: `${getActorUrl(user.username)}/followers`, following: `${getActorUrl(user.username)}/following` });
});

app.get('/ap/posts/:id', (req, res) => {
  const post = rowToPost(db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id));
  if (!post) return res.status(404).json({ error: 'Not found' });
  const user = rowToUser(db.prepare('SELECT * FROM users WHERE id=?').get(post.user_id));
  ap(res, { '@context': 'https://www.w3.org/ns/activitystreams', id: `${HOST}/ap/posts/${post.id}`, type: 'Note', content: post.caption, attributedTo: getActorUrl(user.username), published: post.created_at });
});

app.get('/ap/users/:username/outbox', (req, res) => {
  const user = rowToUser(db.prepare('SELECT * FROM users WHERE username=?').get(req.params.username));
  if (!user) return res.status(404).json({ error: 'Not found' });
  const posts = db.prepare('SELECT * FROM posts WHERE user_id=? ORDER BY created_at DESC').all(user.id).map(p => rowToPost(p));
  ap(res, { '@context': 'https://www.w3.org/ns/activitystreams', id: `${getActorUrl(user.username)}/outbox`, type: 'OrderedCollection', totalItems: posts.length, orderedItems: posts.map(p => ({ id: `${HOST}/ap/posts/${p.id}`, type: 'Note', content: p.caption, attributedTo: getActorUrl(user.username), published: p.created_at })) });
});

app.get('/ap/users/:username/inbox', (req, res) => { ap(res, { '@context': 'https://www.w3.org/ns/activitystreams', id: `${getActorUrl(req.params.username)}/inbox`, type: 'OrderedCollection', totalItems: 0, orderedItems: [] }); });
app.get('/ap/users/:username/followers', (req, res) => { ap(res, { '@context': 'https://www.w3.org/ns/activitystreams', id: `${getActorUrl(req.params.username)}/followers`, type: 'OrderedCollection', totalItems: 0, orderedItems: [] }); });
app.get('/ap/users/:username/following', (req, res) => { ap(res, { '@context': 'https://www.w3.org/ns/activitystreams', id: `${getActorUrl(req.params.username)}/following`, type: 'OrderedCollection', totalItems: 0, orderedItems: [] }); });

app.listen(PORT, () => { console.log(`OmniSee API on port ${PORT}`); });
