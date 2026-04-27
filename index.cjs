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

// ActivityPub JSON helper
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

// WebFinger endpoint
app.get('/.well-known/webfinger', (req, res) => {
  const resource = req.query.resource;
  if (!resource || !resource.startsWith('acct:')) return res.status(400).json({ error: 'Invalid resource' });
  
  const username = resource.replace('acct:', '').split('@')[0];
  const user = db.users.find(u => u.username === username);
  
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  res.json({
    subject: `acct:${username}@${new URL(HOST).hostname}`,
    links: [
      {
        rel: 'self',
        type: 'application/activity+json',
        href: getActorUrl(username)
      }
    ]
  });
});

// Actor endpoint
app.get('/ap/users/:username', (req, res) => {
  const user = db.users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ error: 'Not found' });
  
  ap(res, {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1'
    ],
    id: getActorUrl(user.username),
    type: 'Person',
    preferredUsername: user.username,
    name: user.displayName || user.username,
    summary: user.bio || '',
    icon: user.avatar_url ? [{ type: 'Image', url: user.avatar_url }] : [],
    url: `${HOST}/ap/users/${user.username}`,
    outbox: getOutboxUrl(user.username),
    inbox: getInboxUrl(user.username),
    followers: `${HOST}/ap/users/${user.username}/followers`,
    following: `${HOST}/ap/users/${user.username}/following`,
    publicKey: {
      id: `${getActorUrl(user.username)}#main-key`,
      owner: getActorUrl(user.username),
      publicKeyPem: user.publicKeyPem || '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Z3VS5JJcds3xfn/ygWyF8L2U8V0Q0pA0L3P1vBkKJB6L8zNnBkg8pBk7KPBfP/ygWyF8L2U8V0Q0pA0\n-----END PUBLIC KEY-----\n'
    },
    endpoints: {
      sharedInbox: `${HOST}/ap/inbox`
    },
    published: user.created_at
  });
});

// Outbox endpoint
app.get('/ap/users/:username/outbox', (req, res) => {
  const user = db.users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ error: 'Not found' });
  
  const userPosts = db.posts.filter(p => p.user_id === user.id).map(p => ({
    id: `${HOST}/ap/posts/${p.id}`,
    type: 'Create',
    actor: getActorUrl(user.username),
    object: {
      id: `${HOST}/ap/posts/${p.id}`,
      type: 'Note',
      content: p.caption || '',
      attributedTo: getActorUrl(user.username),
      published: p.created_at,
      url: `${HOST}/ap/posts/${p.id}`
    },
    published: p.created_at
  })).reverse();
  
  ap(res, {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: getOutboxUrl(user.username),
    type: 'OrderedCollection',
    totalItems: userPosts.length,
    orderedItems: userPosts
  });
});

// Inbox endpoint
app.post('/ap/users/:username/inbox', (req, res) => {
  const user = db.users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ error: 'Not found' });
  
  console.log('Received Activity:', req.body.type);
  res.status(202).json({ ok: true 