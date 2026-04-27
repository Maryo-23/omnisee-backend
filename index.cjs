const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const db = new Database(path.join(__dirname, 'omnisee.db'));

app.use(cors());
app.use(express.json());

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    bio TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    media_url TEXT NOT NULL,
    media_type TEXT NOT NULL,
    caption TEXT DEFAULT '',
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  
  CREATE TABLE IF NOT EXISTS likes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    post_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (post_id) REFERENCES posts(id)
  );
`);

// Auth
app.post('/api/auth/register', (req, res) => {
  const { email, password, username, displayName } = req.body;
  const id = crypto.randomUUID();
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  
  try {
    db.prepare('INSERT INTO users (id, email, username, display_name, password_hash) VALUES (?, ?, ?, ?, ?)')
      .run(id, email, username, displayName, passwordHash);
    res.json({ success: true, user: { id, email, username, displayName } });
  } catch (e) {
    res.status(400).json({ error: 'User already exists' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND password_hash = ?').get(email, passwordHash);
  
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ success: true, user });
});

// Posts
app.get('/api/posts', (req, res) => {
  const posts = db.prepare(`
    SELECT p.*, u.username, u.display_name as displayName, u.avatar_url as avatarUrl 
    FROM posts p 
    JOIN users u ON p.user_id = u.id 
    ORDER BY p.created_at DESC 
    LIMIT 50
  `).all();
  res.json(posts);
});

app.post('/api/posts', (req, res) => {
  const { userId, mediaUrl, mediaType, caption } = req.body;
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO posts (id, user_id, media_url, media_type, caption) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, mediaUrl, mediaType, caption);
  res.json({ success: true, id });
});

app.post('/api/posts/:id/like', (req, res) => {
  const { userId } = req.body;
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO likes (id, user_id, post_id) VALUES (?, ?, ?)')
    .run(id, userId, req.params.id);
  db.prepare('UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Users
app.get('/api/users/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(user);
});

app.listen(PORT, () => {
  console.log(`OmniSee API running on port ${PORT}`);
});