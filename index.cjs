const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

let db = { users: [], posts: [] };
if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

app.use(cors());
app.use(express.json());

app.post('/api/register', (req, res) => {
  const { email, password, username, displayName } = req.body;
  
  if (db.users.find(u => u.email === email)) {
    return res.status(400).json({ error: 'Email already exists' });
  }
  if (db.users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'Username already exists' });
  }
  
  const id = crypto.randomUUID();
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  
  const user = { id, email, username, displayName: displayName || username, bio: '', avatar_url: '', password_hash: passwordHash, created_at: new Date().toISOString() };
  db.users.push(user);
  saveDb();
  
  res.json({ success: true, user: { id, email, username, displayName: user.displayName } });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  const user = db.users.find(u => u.email === email && u.password_hash === passwordHash);
  
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ success: true, user });
});

app.get('/api/posts', (req, res) => {
  const posts = db.posts.map(p => {
    const user = db.users.find(u => u.id === p.user_id);
    return { ...p, username: user?.username, displayName: user?.display_name, avatarUrl: user?.avatar_url };
  }).reverse();
  res.json(posts);
});

app.post('/api/posts', (req, res) => {
  const { userId, mediaUrl, mediaType, caption } = req.body;
  const id = crypto.randomUUID();
  const post = { id, user_id: userId, media_url: mediaUrl, media_type: mediaType, caption, likes_count: 0, comments_count: 0, created_at: new Date().toISOString() };
  db.posts.push(post);
  saveDb();
  res.json({ success: true, id });
});

app.post('/api/posts/:id/like', (req, res) => {
  const { userId } = req.body;
  const post = db.posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  post.likes_count = (post.likes_count || 0) + 1;
  saveDb();
  res.json({ success: true });
});

app.get('/api/users/:id', (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(user);
});

app.listen(PORT, () => {
  console.log(`OmniSee API running on port ${PORT}`);
});