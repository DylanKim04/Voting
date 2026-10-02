// AASA Deliberations — anonymous voting server.
// Zero dependencies: Node's built-in http server, Server-Sent Events for live
// updates, and a JSON file for persistence.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || 'aasa';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- state ----------

const id = () => crypto.randomBytes(6).toString('hex');
const token = () => crypto.randomBytes(24).toString('hex');

function seedState() {
  const pos = (name, names) => ({
    id: id(),
    name,
    lockedCandidateId: null,
    candidates: names.map((n) => ({ id: id(), name: n, removed: false, notes: [] })),
  });
  return {
    members: [],
    adminTokens: [],
    positions: [
      pos('Co-Pub', ['Thomas Ok', 'Capri', 'Fayina']),
      pos('PR', ['Michelle', 'Gilbert', 'Mehreen']),
      pos('Photo', ['Jeysac Pech', 'Matthew', 'Jules', 'David']),
    ],
    polls: [],
  };
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return seedState();
  }
}

let state = load();
let saveTimer = null;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  }, 50);
}

// ---------- live updates ----------

const clients = new Set();

function broadcast() {
  save();
  for (const res of clients) res.write('event: update\ndata: {}\n\n');
}

setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 25000);

// ---------- helpers ----------

const findMember = (t) => state.members.find((m) => m.token === t);
const isAdmin = (t) => !!t && state.adminTokens.includes(t);
const findPosition = (pid) => state.positions.find((p) => p.id === pid);
const findCandidate = (pos, cid) => pos && pos.candidates.find((c) => c.id === cid);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};
const need = (cond, status, message) => cond || fail(status, message);
const cleanText = (s, max) => String(s || '').trim().slice(0, max);

// What a given viewer is allowed to see. Ballots are never stored per person:
// a poll keeps a list of who has voted (to stop double voting) and a separate
// anonymous tally, so nobody — not even admins — can link a voter to a choice.
// Tallies stay hidden from everyone until an admin reveals them.
function viewFor(t, at) {
  const me = findMember(t);
  const admin = isAdmin(at);
  return {
    me: me ? { id: me.id, name: me.name } : null,
    isAdmin: admin,
    memberCount: state.members.length,
    members: admin ? state.members.map((m) => ({ id: m.id, name: m.name })) : undefined,
    positions: state.positions,
    polls: state.polls.map((p) => ({
      id: p.id,
      type: p.type,
      positionId: p.positionId,
      candidateId: p.candidateId,
      title: p.title,
      options: p.options,
      status: p.status,
      revealed: p.revealed,
      createdAt: p.createdAt,
      votedCount: p.voters.length + (p.proxyVoters || []).length,
      eligibleCount: p.status === 'open' ? state.members.length + (p.proxyVoters || []).length : p.eligibleCount,
      // Names only (never their choice), so the admin can see who's been added.
      proxyVoters: p.proxyVoters || [],
      hasVoted: me ? p.voters.includes(me.id) : false,
      tally: p.revealed ? p.tally : null,
    })),
  };
}

// ---------- API ----------

const routes = {
  'POST /api/join': (body) => {
    const name = cleanText(body.name, 60);
    need(name, 400, 'Please enter your name.');
    const m = { id: id(), name, token: token(), joinedAt: Date.now() };
    state.members.push(m);
    return { token: m.token };
  },

  'POST /api/admin/login': (body) => {
    need(String(body.pin || '') === ADMIN_PIN, 403, 'That PIN is not correct.');
    const at = token();
    state.adminTokens.push(at);
    return { adminToken: at };
  },

  'POST /api/positions': (body) => {
    const name = cleanText(body.name, 60);
    need(name, 400, 'Position needs a name.');
    state.positions.push({ id: id(), name, lockedCandidateId: null, candidates: [] });
  },

  'POST /api/positions/rename': (body) => {
    const pos = need(findPosition(body.positionId), 404, 'Position not found.');
    const name = cleanText(body.name, 60);
    need(name, 400, 'Position needs a name.');
    pos.name = name;
  },

  'POST /api/positions/delete': (body) => {
    state.positions = state.positions.filter((p) => p.id !== body.positionId);
  },

  'POST /api/candidates': (body) => {
    const pos = need(findPosition(body.positionId), 404, 'Position not found.');
    const name = cleanText(body.name, 60);
    need(name, 400, 'Applicant needs a name.');
    pos.candidates.push({ id: id(), name, removed: false, notes: [] });
  },

  'POST /api/candidates/remove': (body) => {
    const pos = need(findPosition(body.positionId), 404, 'Position not found.');
    const c = need(findCandidate(pos, body.candidateId), 404, 'Applicant not found.');
    c.removed = !!body.removed;
    if (c.removed && pos.lockedCandidateId === c.id) pos.lockedCandidateId = null;
  },

  'POST /api/candidates/delete': (body) => {
    const pos = need(findPosition(body.positionId), 404, 'Position not found.');
    pos.candidates = pos.candidates.filter((c) => c.id !== body.candidateId);
    if (pos.lockedCandidateId === body.candidateId) pos.lockedCandidateId = null;
  },

  'POST /api/lock': (body) => {
    const pos = need(findPosition(body.positionId), 404, 'Position not found.');
    if (body.candidateId) {
      const c = need(findCandidate(pos, body.candidateId), 404, 'Applicant not found.');
      need(!c.removed, 400, 'That applicant has been removed.');
      pos.lockedCandidateId = c.id;
    } else {
      pos.lockedCandidateId = null;
    }
  },

  'POST /api/notes': (body, t) => {
    const me = findMember(t);
    const pos = need(findPosition(body.positionId), 404, 'Position not found.');
    const c = need(findCandidate(pos, body.candidateId), 404, 'Applicant not found.');
    const text = cleanText(body.text, 1000);
    need(text, 400, 'Note is empty.');
    c.notes.push({
      id: id(),
      text,
      author: me ? me.name : 'Admin',
      authorId: me ? me.id : null,
      at: Date.now(),
    });
  },

  'POST /api/notes/delete': (body, t, at) => {
    const me = findMember(t);
    const pos = need(findPosition(body.positionId), 404, 'Position not found.');
    const c = need(findCandidate(pos, body.candidateId), 404, 'Applicant not found.');
    const note = need(c.notes.find((n) => n.id === body.noteId), 404, 'Note not found.');
    need(isAdmin(at) || (me && note.authorId === me.id), 403, 'You can only delete your own notes.');
    c.notes = c.notes.filter((n) => n !== note);
  },

  'POST /api/polls': (body) => {
    const pos = need(findPosition(body.positionId), 404, 'Position not found.');
    need(!state.polls.some((p) => p.status === 'open'), 400, 'Close the current vote first.');
    let poll;
    if (body.type === 'remove') {
      const c = need(findCandidate(pos, body.candidateId), 404, 'Applicant not found.');
      poll = {
        type: 'remove',
        candidateId: c.id,
        title: `Remove ${c.name} from ${pos.name}?`,
        options: [
          { id: 'yes', label: `Yes, remove ${c.name}` },
          { id: 'no', label: `No, keep ${c.name}` },
          { id: 'abstain', label: 'Abstain' },
        ],
      };
    } else {
      const active = pos.candidates.filter((c) => !c.removed);
      need(active.length > 0, 400, 'Add some applicants first.');
      poll = {
        type: 'position',
        candidateId: null,
        title: `Who should be ${pos.name}?`,
        options: [
          ...active.map((c) => ({ id: c.id, label: c.name })),
          { id: 'abstain', label: 'Abstain' },
        ],
      };
    }
    state.polls.unshift({
      ...poll,
      id: id(),
      positionId: pos.id,
      status: 'open',
      revealed: false,
      createdAt: Date.now(),
      eligibleCount: state.members.length,
      voters: [],
      proxyVoters: [],
      tally: Object.fromEntries(poll.options.map((o) => [o.id, 0])),
    });
  },

  'POST /api/polls/vote': (body, t) => {
    const me = need(findMember(t), 401, 'Join with your name before voting.');
    const poll = need(state.polls.find((p) => p.id === body.pollId), 404, 'Vote not found.');
    need(poll.status === 'open', 400, 'This vote is closed.');
    need(!poll.voters.includes(me.id), 400, 'You already voted.');
    need(Object.hasOwn(poll.tally, body.optionId), 400, 'Pick one of the options.');
    poll.voters.push(me.id);
    poll.tally[body.optionId] += 1;
    // Shuffle the voter list so its order can't be matched to tally changes.
    poll.voters.sort(() => Math.random() - 0.5);
  },

  // Admin casts a vote on behalf of someone who isn't present. Only their name
  // is recorded (to prevent counting them twice); their choice goes into the
  // same anonymous tally as everyone else's.
  'POST /api/polls/proxy': (body) => {
    const poll = need(state.polls.find((p) => p.id === body.pollId), 404, 'Vote not found.');
    need(poll.status === 'open', 400, 'This vote is closed.');
    const name = cleanText(body.voterName, 60);
    need(name, 400, "Enter the absent person's name.");
    const key = name.toLowerCase();
    poll.proxyVoters = poll.proxyVoters || [];
    need(!poll.proxyVoters.some((n) => n.toLowerCase() === key), 400, `${name} already has a vote counted.`);
    need(
      !state.members.some((m) => m.name.toLowerCase() === key),
      400,
      `${name} is in the room — they can vote for themselves.`
    );
    need(Object.hasOwn(poll.tally, body.optionId), 400, 'Pick one of the options.');
    poll.proxyVoters.push(name);
    poll.tally[body.optionId] += 1;
  },

  'POST /api/polls/close': (body) => {
    const poll = need(state.polls.find((p) => p.id === body.pollId), 404, 'Vote not found.');
    if (poll.status === 'open') poll.eligibleCount = state.members.length + (poll.proxyVoters || []).length;
    poll.status = 'closed';
  },

  'POST /api/polls/reveal': (body) => {
    const poll = need(state.polls.find((p) => p.id === body.pollId), 404, 'Vote not found.');
    if (poll.status === 'open') poll.eligibleCount = state.members.length + (poll.proxyVoters || []).length;
    poll.status = 'closed';
    poll.revealed = true;
  },

  'POST /api/polls/delete': (body) => {
    state.polls = state.polls.filter((p) => p.id !== body.pollId);
  },

  'POST /api/members/delete': (body) => {
    state.members = state.members.filter((m) => m.id !== body.memberId);
  },

  'POST /api/reset': (body) => {
    need(body.confirm === 'RESET', 400, 'Type RESET to confirm.');
    const admins = state.adminTokens;
    state = { members: [], adminTokens: admins, positions: [], polls: [] };
  },
};

// Routes anyone who has joined may call; everything else is admin-only.
const MEMBER_ROUTES = new Set(['POST /api/notes', 'POST /api/notes/delete', 'POST /api/polls/vote']);
const PUBLIC_ROUTES = new Set(['POST /api/join', 'POST /api/admin/login']);

// ---------- http ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 100_000) reject(new HttpError(413, 'Too much data.'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new HttpError(400, 'Bad request.'));
      }
    });
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 404, { error: 'Not found' });
  fs.readFile(file, (err, buf) => {
    if (err) {
      // Single-page app: unknown paths fall back to the main page.
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const t = req.headers['x-token'] || url.searchParams.get('token') || '';
  const at = req.headers['x-admin-token'] || '';

  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('event: update\ndata: {}\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    return sendJson(res, 200, viewFor(t, at));
  }

  const key = `${req.method} ${url.pathname}`;
  const handler = routes[key];
  if (handler) {
    try {
      const body = await readBody(req);
      if (!PUBLIC_ROUTES.has(key)) {
        if (MEMBER_ROUTES.has(key)) need(findMember(t) || isAdmin(at), 401, 'Join with your name first.');
        else need(isAdmin(at), 403, 'Only admins can do that.');
      }
      const out = handler(body, t, at) || {};
      broadcast();
      return sendJson(res, 200, { ok: true, ...out });
    } catch (e) {
      return sendJson(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong.' });
    }
  }

  if (req.method === 'GET') return serveStatic(req, res, url.pathname);
  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`AASA voting is running at http://localhost:${PORT}`);
  if (!process.env.ADMIN_PIN) console.log(`Admin PIN is "${ADMIN_PIN}" — set ADMIN_PIN to change it.`);
});
