const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');
const HOST = process.env.HOST || 'https://omnisee-backend.onrender.com';

let db = { users: [], posts: [] };
if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

app.use(cors());
app.use(express.json({ type: ['application/json', 'application/activity+json'] }));

function ap(res, data) {
  res.set('Content-Type', 'application/activity+json');
  res.json(data);
}

function getActorUrl(username) {
  return `${HOST}/ap/users/${username}`;
}

function getOutboxUrl(username) {
  return `${HOST}/ap/users/${username}/outbox`;
}

function getInboxUrl(username) {
  return `${HOST}/ap/users/${username}/inbox`;
}

app.get('/.well-known/webfinger', (req, res) => {
  const resource = req.query.resource;
  if (!resource || !resource.startsWith('acct:')) return res.status(400).json({ error: 'Invalid resource' });
  
  const username = resource.replace('acct:', '').split('@')[0];
  const user = db.users.find(u => u.username === username);
  
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  res.json({
    subject: `acct:${username}@${new URL(HOST).hostname}`,
    links: [{ rel: 'self', type: 'application/activity+json', href: getActorUrl(username) }]
  });
});

app.get('/ap/users/:username', (req, res) => {
  const user = db.users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ error: 'Not found' });
  
  ap(res, {
    '@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'],
    id: getActorUrl(user.username),
    type: 'Person',
    preferredUsername: user.username,
    name: user.displayName || user.username,
    summary: user.bio || '',
    icon: user.avatar_url ? [{ type: 'Image', url: user.avatar_url }] : [],
    url: getActorUrl(user.username),
    outbox: getOutboxUrl(user.username),
    inbox: getInboxUrl(user.username),
    followers: `${HOST}/ap/users/${user.username}/followers`,
    following: `${HOST}/ap/users/${user.username}/following`,
    endpoints: { sharedInbox: `${HOST}/ap/inbox` },
    published: user.created_at
  });
});

app.get('/ap/users/:username/outbox', (req, res) => {
  const user = db.users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ error: 'Not found' });
  
  const posts = db.posts.filter(p => p.user_id === user.id).map(p => ({
    id: `${HOST}/ap/posts/${p.id}`,
    type: 'Create',
    actor: getActorUrl(user.username),
    object: {
      id: `${HOST}/ap/posts/${p.id}`,
      type: 'Note',
      content: p.caption || '',
      attributedTo: getActorUrl(user.username),
      published: p.created_at
    },
    published: p.created_at
  })).reverse();
  
  ap(res, {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: getOutboxUrl(user.username),
    type: 'OrderedCollection',
    totalItems: posts.length,
    orderedItems: posts
  });
});

app.post('/ap/users/:username/inbox', (req, res) => {
  const user = db.users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ error: 'Not found' });
  console.log('Inbox received:', req.body.type);
  res.status(202).json({ ok: true });
});

app.post('/ap/inbox', (req, res) => {
  console.log('Shared inbox received:', req.body.type);
  res.status(202).json({ ok: true });
});

app.post('/ap/users/:username/outbox', (req, res) => {
  const user = db.users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ error: 'Not found' });
  
  const activity = req.body;
  if (activity.type !== 'Create' || !activity.object) {
    return res.status(400).json({ error: 'Invalid activity' });
  }
  
  const note = activity.object;
  const id = crypto.randomUUID();
  const post = {
    id,
    user_id: user.id,
    media_url: note.attachment?.[0]?.url || '',
    media_type: note.attachment?.[0]?.type || 'note',
    caption: note.content || '',
    likes_count: 0,
    comments_count: 0,
    created_at: new Date().toISOString()
  };
  
  db.posts.push(post);
  saveDb();
  
  ap(res, {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${HOST}/ap/posts/${id}`,
    type: 'Create',
    actor: getActorUrl(user.username),
    object: { id: `${HOST}/ap/posts/${id}`, type: 'Note', content: post.caption, attributedTo: getActorUrl(user.username), published: post.created_at },
    published: post.created_at
  });
});

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

app.post('/api/users/change-password', (req, res) => {
  const { email, oldPassword, newPassword } = req.body;
  const oldHash = crypto.createHash('sha256').update(oldPassword).digest('hex');
  const user = db.users.find(u => u.email === email && u.password_hash === oldHash);
  
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  
  user.password_hash = crypto.createHash('sha256').update(newPassword).digest('hex');
  saveDb();
  res.json({ success: true });
});

app.post('/api/users/update-profile', (req, res) => {
  const { userId, displayName, bio, avatarUrl } = req.body;
  const user = db.users.find(u => u.id === userId);
  
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  if (displayName) user.display_name = displayName;
  if (bio !== undefined) user.bio = bio;
  if (avatarUrl !== undefined) user.avatar_url = avatarUrl;
  
  saveDb();
  res.json({ success: true, user });
});

app.listen(PORT, () => {
  console.log(`OmniSee API running on port ${PORT}`);
});