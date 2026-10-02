// AASA Deliberations — client.
(() => {
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');

  const store = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
    set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} },
  };

  let token = store.get('aasa.token');
  let adminToken = store.get('aasa.adminToken');
  let S = null; // latest server view
  const ui = {
    openNotes: new Set(),
    showAdminLogin: false,
    drafts: {},
    picked: {}, // pollId -> option ids the user tapped before confirming
  };

  // ---------- utilities ----------

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const COLORS = ['#e8806e', '#6fae94', '#6d9fd6', '#f2b84b', '#b48ad6', '#e58fb5', '#5fb3b3', '#d99a6c'];
  const colorFor = (name) => COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
  const timeAgo = (ts) => {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return new Date(ts).toLocaleDateString();
  };
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 2600);
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Token': token, 'X-Admin-Token': adminToken },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  async function act(path, body, okMsg) {
    try {
      const out = await api(path, body);
      if (okMsg) toast(okMsg);
      await refresh();
      return out;
    } catch (e) {
      toast(e.message);
      return null;
    }
  }

  async function refresh() {
    try {
      S = await api('/api/state');
      // Forget tokens the server no longer recognises (e.g. after a reset).
      if (token && !S.me) { token = ''; store.set('aasa.token', ''); }
      if (adminToken && !S.isAdmin) { adminToken = ''; store.set('aasa.adminToken', ''); }
      render();
    } catch {
      /* will retry on next event */
    }
  }

  // ---------- derived data ----------

  const position = (pid) => S.positions.find((p) => p.id === pid);

  // Latest revealed "who should be X" result for a position.
  function latestResult(pid) {
    return S.polls.find((p) => p.positionId === pid && p.type === 'position' && p.revealed);
  }
  function roundNumber(poll) {
    const same = S.polls.filter((p) => p.positionId === poll.positionId && p.type === 'position');
    return same.length - same.indexOf(poll);
  }
  // Top vote-getters for a revealed position vote with `spots` openings.
  // `tie` means more people are tied for the last spot than there is room for.
  function standings(poll, spots) {
    const cands = poll.options
      .filter((o) => o.id !== 'abstain')
      .map((o) => ({ id: o.id, n: poll.tally[o.id] || 0 }))
      .sort((a, b) => b.n - a.n);
    const cutoff = cands[spots - 1] ? cands[spots - 1].n : 0;
    const leaders = cands.filter((c) => c.n > 0 && c.n >= cutoff).map((c) => c.id);
    return { leaders, tie: leaders.length > spots };
  }
  const spotsWord = (n) => `${n} ${n === 1 ? 'spot' : 'spots'}`;

  function latestRemoval(pid, cid) {
    return S.polls.find((p) => p.positionId === pid && p.type === 'remove' && p.candidateId === cid && p.revealed);
  }

  // ---------- views ----------

  function joinView() {
    return `
      <div class="join">
        <div class="big-logo">🗳️</div>
        <h1>AASA Deliberations</h1>
        <p class="lead">Anonymous voting for eboard. Nobody can see how you voted.</p>
        <div class="card">
          <form class="stack" data-form="join">
            <div>
              <label for="name">What's your name?</label>
              <input id="name" name="name" placeholder="e.g. Dylan Kim" autocomplete="name" maxlength="60" required autofocus>
            </div>
            <button class="primary" type="submit">Join the room</button>
          </form>
          <div class="hint">🔒 Your name is only used to make sure everyone votes once. Ballots are counted anonymously.</div>
          <div style="margin-top:16px;text-align:center">
            ${ui.showAdminLogin ? `
              <form class="row" data-form="admin">
                <input name="pin" type="password" placeholder="Admin PIN" required>
                <button class="sage" type="submit">Unlock</button>
              </form>` : `<button class="ghost small" data-action="show-admin">I'm running the meeting</button>`}
          </div>
        </div>
      </div>`;
  }

  function header() {
    return `
      <header class="top">
        <div class="brand">
          <div class="logo">🗳️</div>
          <div>
            <h1>AASA Deliberations</h1>
            <p>Anonymous eboard voting</p>
          </div>
        </div>
        <div class="top-actions">
          <span class="pill">👥 <strong>${S.memberCount}</strong> in the room</span>
          ${S.me ? `<span class="pill">Hi, <strong>${esc(S.me.name)}</strong></span>` : ''}
          ${S.isAdmin ? `<span class="pill" style="background:var(--sage-soft);color:#3f7d64;border-color:transparent">⭐ Admin</span>` : ''}
          ${!S.isAdmin ? `<button class="ghost small" data-action="show-admin-main">Admin</button>` : `<button class="ghost small" data-action="admin-logout">Exit admin</button>`}
        </div>
      </header>
      ${!S.isAdmin && ui.showAdminLogin ? `
        <div class="card" style="margin-bottom:16px">
          <form class="row" data-form="admin">
            <input name="pin" type="password" placeholder="Admin PIN" required autofocus>
            <button class="sage" type="submit">Unlock</button>
            <button class="ghost" type="button" data-action="hide-admin">Cancel</button>
          </form>
        </div>` : ''}
      ${!S.me ? `
        <div class="card" style="margin-bottom:16px">
          <form class="row" data-form="join">
            <input name="name" placeholder="Join with your name to vote" maxlength="60" required>
            <button class="primary" type="submit">Join</button>
          </form>
        </div>` : ''}`;
  }

  function activeVoteView() {
    const poll = S.polls.find((p) => p.status === 'open');
    if (!poll) {
      return `
        <div class="card" style="text-align:center;padding:28px">
          <div style="font-size:32px">☕</div>
          <div style="font-weight:700;margin-top:4px">No vote is open right now</div>
          <div class="muted small-text">${S.isAdmin ? 'Start one from any position below.' : 'Hang tight — this page updates by itself when a vote starts.'}</div>
        </div>`;
    }
    const pct = poll.eligibleCount ? Math.min(100, Math.round((poll.votedCount / poll.eligibleCount) * 100)) : 0;
    const picked = ui.picked[poll.id] || [];
    const max = poll.maxPicks || 1;
    let body;
    if (!S.me) {
      body = `<div class="hidden-count">Join with your name above to cast a vote.</div>`;
    } else if (poll.hasVoted) {
      body = `<div class="voted-msg">✅ Your vote is in! It's anonymous — nobody can see what you picked.</div>`;
    } else {
      body = `
        <div class="options">
          ${poll.options.map((o) => `
            <button class="option ${o.id === 'abstain' ? 'abstain' : ''} ${picked.includes(o.id) ? 'selected' : ''}" data-action="pick" data-poll="${poll.id}" data-option="${o.id}" data-max="${max}">
              ${o.id === 'abstain' ? '🤷' : picked.includes(o.id) ? '💗' : '○'} ${esc(o.label)}
            </button>`).join('')}
        </div>
        <button class="primary" data-action="vote" data-poll="${poll.id}" ${picked.length ? '' : 'disabled'}>Submit my vote${max > 1 && picked.length && !picked.includes('abstain') ? ` (${picked.length} of ${max})` : ''}</button>
        <span class="muted small-text" style="margin-left:8px">You can't change it after submitting.</span>`;
    }
    return `
      <div class="card vote-card">
        <span class="eyebrow"><span class="dot"></span> Voting now</span>
        <h3>${esc(poll.title)}</h3>
        ${max > 1 ? `<div class="muted small-text">There are ${spotsWord(max)} open — you can vote for up to ${max} people.</div>` : ''}
        ${body}
        <div style="margin-top:16px">
          <div class="vote-meta">
            <span class="muted small-text"><strong style="color:var(--ink)">${poll.votedCount}</strong> of ${poll.eligibleCount} have voted · results stay hidden until revealed</span>
            ${S.isAdmin ? `
              <div class="admin-bar">
                <button class="small" data-action="close-poll" data-poll="${poll.id}">Close voting</button>
                <button class="small sage" data-action="reveal-poll" data-poll="${poll.id}">Close &amp; reveal count</button>
              </div>` : ''}
          </div>
          <div class="progress"><div style="width:${pct}%"></div></div>
        </div>
        ${S.isAdmin ? absentVoteForm(poll) : ''}
      </div>`;
  }

  function absentVoteForm(poll) {
    const names = poll.proxyVoters || [];
    return `
      <div class="absent">
        <div class="absent-head">
          <strong>🙋 Votes for people who aren't here</strong>
          <span class="muted small-text">Only admins see this. Their choice is counted anonymously.</span>
        </div>
        <form class="absent-form" data-form="absent" data-poll="${poll.id}">
          <input name="voterName" placeholder="Their name" maxlength="60" data-draft="absent:name:${poll.id}" value="${esc(ui.drafts[`absent:name:${poll.id}`] || '')}">
          ${(poll.maxPicks || 1) > 1 ? `
            <div class="absent-picks">
              ${poll.options.map((o) => `<label class="check"><input type="checkbox" name="optionIds" value="${o.id}"> ${esc(o.label)}</label>`).join('')}
            </div>` : `
            <select name="optionId" required>
              <option value="">Their vote…</option>
              ${poll.options.map((o) => `<option value="${o.id}">${esc(o.label)}</option>`).join('')}
            </select>`}
          <button class="small sage" type="submit">Add their vote</button>
        </form>
        ${names.length ? `<div class="member-list">${names.map((n) => `<span class="chip">✓ ${esc(n)}</span>`).join('')}</div>` : ''}
      </div>`;
  }

  function candidateView(pos, c, result, hasOpenPoll) {
    const locked = pos.lockedIds.includes(c.id);
    const full = pos.lockedIds.length >= pos.openings;
    const count = result && result.tally[c.id] !== undefined ? result.tally[c.id] : null;
    const leaders = result ? standings(result, result.maxPicks || 1).leaders : [];
    const removal = latestRemoval(pos.id, c.id);
    const open = ui.openNotes.has(c.id);
    const draftKey = `note:${c.id}`;

    let badge;
    if (count === null) badge = `<span class="votes-badge none">${result ? 'not in vote' : 'no votes yet'}</span>`;
    else badge = `<span class="votes-badge ${count === 0 ? 'none' : leaders.includes(c.id) ? 'lead' : ''}" title="Round ${roundNumber(result)} result">${count} <span style="font-weight:600">${count === 1 ? 'vote' : 'votes'}</span></span>`;

    return `
      <div class="cand ${locked ? 'locked' : ''} ${c.removed ? 'removed' : ''}">
        <div class="cand-top">
          <div class="avatar" style="background:${colorFor(c.name)}">${esc(initials(c.name))}</div>
          <div class="cand-name">${esc(c.name)}</div>
          ${badge}
        </div>
        <div class="cand-sub">
          ${locked ? `<span class="chip gold">👑 Locked in</span>` : ''}
          ${c.removed ? `<span class="chip red">Removed</span>` : ''}
          ${removal ? `<span class="chip ${removal.tally.yes > removal.tally.no ? 'red' : ''}">Removal vote: ${removal.tally.yes} yes · ${removal.tally.no} no${removal.tally.abstain ? ` · ${removal.tally.abstain} abstain` : ''}</span>` : ''}
          <button class="tiny ghost" data-action="toggle-notes" data-cand="${c.id}">📝 ${c.notes.length ? plural(c.notes.length, 'note') : 'Add note'} ${open ? '▴' : '▾'}</button>
        </div>
        ${S.isAdmin ? `
          <div class="cand-actions">
            ${!c.removed && !locked && !full ? `<button class="tiny sage" data-action="lock" data-pos="${pos.id}" data-cand="${c.id}">👑 Lock in</button>` : ''}
            ${locked ? `<button class="tiny" data-action="unlock" data-pos="${pos.id}" data-cand="${c.id}">Unlock</button>` : ''}
            ${!c.removed ? `<button class="tiny" data-action="remove-vote" data-pos="${pos.id}" data-cand="${c.id}" ${hasOpenPoll ? 'disabled' : ''}>🗳️ Vote to remove</button>` : ''}
            ${!c.removed ? `<button class="tiny danger" data-action="remove" data-pos="${pos.id}" data-cand="${c.id}">Remove</button>`
                          : `<button class="tiny" data-action="restore" data-pos="${pos.id}" data-cand="${c.id}">Restore</button>`}
            <button class="tiny ghost" data-action="delete-cand" data-pos="${pos.id}" data-cand="${c.id}" title="Delete applicant entirely">🗑️</button>
          </div>` : ''}
        ${open ? `
          <div class="notes">
            ${c.notes.map((n) => `
              <div class="note">
                <div class="note-meta">
                  <span><strong>${esc(n.author)}</strong> · ${timeAgo(n.at)}</span>
                  ${S.isAdmin || (S.me && n.authorId === S.me.id) ? `<button class="tiny ghost" data-action="delete-note" data-pos="${pos.id}" data-cand="${c.id}" data-note="${n.id}">✕</button>` : ''}
                </div>
                <div class="note-text">${esc(n.text)}</div>
              </div>`).join('') || `<div class="muted small-text">No notes yet.</div>`}
            ${S.me || S.isAdmin ? `
              <form class="note-form" data-form="note" data-pos="${pos.id}" data-cand="${c.id}">
                <textarea name="text" rows="1" placeholder="Add a note about ${esc(c.name)}…" data-draft="${draftKey}" maxlength="1000">${esc(ui.drafts[draftKey] || '')}</textarea>
                <button class="small primary" type="submit">Add</button>
              </form>` : ''}
          </div>` : ''}
      </div>`;
  }

  function positionView(pos) {
    const result = latestResult(pos.id);
    const hasOpenPoll = S.polls.some((p) => p.status === 'open');
    const winners = pos.lockedIds.map((cid) => pos.candidates.find((c) => c.id === cid)).filter(Boolean);
    const active = pos.candidates.filter((c) => !c.removed);
    const sorted = [...active, ...pos.candidates.filter((c) => c.removed)];
    const draftKey = `cand:${pos.id}`;
    return `
      <div class="card">
        <div class="position-head">
          <div>
            <span class="position-tag">Position</span>
            <h3>${esc(pos.name)}</h3>
            <div class="muted small-text">${plural(active.length, 'applicant')}${!S.isAdmin && pos.openings > 1 ? ` · ${spotsWord(pos.openings)}` : ''}${result ? ` · showing round ${roundNumber(result)} votes` : ''}</div>
            ${S.isAdmin ? `
              <div class="spots">
                <span class="muted small-text">Spots</span>
                <button class="tiny" data-action="openings" data-pos="${pos.id}" data-n="${pos.openings - 1}" ${pos.openings <= 1 ? 'disabled' : ''} aria-label="Fewer spots">−</button>
                <strong>${pos.openings}</strong>
                <button class="tiny" data-action="openings" data-pos="${pos.id}" data-n="${pos.openings + 1}" ${pos.openings >= 10 ? 'disabled' : ''} aria-label="More spots">+</button>
              </div>` : ''}
          </div>
          ${S.isAdmin ? `
            <div class="row" style="flex-wrap:wrap;justify-content:flex-end">
              <button class="small primary" data-action="start-vote" data-pos="${pos.id}" ${hasOpenPoll || !active.length || winners.length >= pos.openings ? 'disabled' : ''} title="${winners.length >= pos.openings ? 'All spots are filled' : ''}">Start vote</button>
              <button class="small ghost" data-action="rename-pos" data-pos="${pos.id}" title="Rename">✏️</button>
              <button class="small ghost" data-action="delete-pos" data-pos="${pos.id}" title="Delete position">🗑️</button>
            </div>` : ''}
        </div>
        ${winners.length ? `
          <div class="winner">
            <span class="crown">👑</span>
            <div>
              <div class="label">Locked in${pos.openings > 1 ? ` · ${winners.length} of ${pos.openings} spots` : ''}</div>
              <div class="name">${winners.map((w) => esc(w.name)).join(', ')}</div>
            </div>
          </div>` : ''}
        <div class="cands">
          ${sorted.map((c) => candidateView(pos, c, result, hasOpenPoll)).join('') || `<div class="empty small-text">No applicants yet.</div>`}
        </div>
        ${S.isAdmin ? `
          <form class="row add-cand" data-form="cand" data-pos="${pos.id}">
            <input name="name" placeholder="Add an applicant" maxlength="60" data-draft="${draftKey}" value="${esc(ui.drafts[draftKey] || '')}">
            <button class="small" type="submit">Add</button>
          </form>` : ''}
      </div>`;
  }

  function resultView(poll) {
    const pos = position(poll.positionId);
    const total = Object.values(poll.tally || {}).reduce((a, b) => a + b, 0);
    const spots = poll.maxPicks || 1;
    const st = poll.revealed && poll.type === 'position' ? standings(poll, spots) : { leaders: [], tie: false };
    const max = poll.revealed ? Math.max(0, ...poll.options.filter((o) => o.id !== 'abstain').map((o) => poll.tally[o.id])) : 0;
    const isWin = (o, n) => (poll.type === 'position' ? st.leaders.includes(o.id) : o.id !== 'abstain' && n === max && n > 0);
    const cand = poll.type === 'remove' && pos ? pos.candidates.find((c) => c.id === poll.candidateId) : null;
    const removalPassed = poll.revealed && poll.type === 'remove' && poll.tally.yes > poll.tally.no;
    return `
      <div class="card result">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div>
            <h4>${esc(poll.title)}</h4>
            <div class="muted small-text">${poll.type === 'position' ? `Round ${roundNumber(poll)} · ` : ''}${poll.votedCount} of ${poll.eligibleCount} voted${poll.proxyVoters && poll.proxyVoters.length ? ` (incl. ${poll.proxyVoters.length} absent)` : ''} · ${timeAgo(poll.createdAt)}</div>
          </div>
          ${S.isAdmin ? `<button class="tiny ghost" data-action="delete-poll" data-poll="${poll.id}" title="Delete this vote">🗑️</button>` : ''}
        </div>
        ${poll.revealed ? poll.options.map((o) => {
          const n = poll.tally[o.id] || 0;
          const w = total ? Math.round((n / total) * 100) : 0;
          return `
            <div class="bar-row ${isWin(o, n) ? 'win' : ''}">
              <span class="lbl" title="${esc(o.label)}">${esc(o.label)}</span>
              <div class="bar"><div style="width:${w}%"></div></div>
              <span class="n">${n}</span>
            </div>`;
        }).join('') : `
          <div class="hidden-count">🙈 Count is hidden.
            ${S.isAdmin ? `<button class="small sage" data-action="reveal-poll" data-poll="${poll.id}" style="margin-left:auto">Reveal count</button>` : 'Waiting for an admin to reveal it.'}
          </div>`}
        ${poll.revealed && poll.type === 'remove' ? `
          <div class="muted small-text" style="margin-top:6px">${removalPassed ? 'Majority voted to remove.' : 'Majority did not vote to remove.'}</div>
          ${S.isAdmin && removalPassed && cand && !cand.removed ? `<button class="small danger" style="margin-top:8px" data-action="remove" data-pos="${pos.id}" data-cand="${cand.id}">Remove ${esc(cand.name)}</button>` : ''}` : ''}
        ${poll.revealed && poll.type === 'position' && S.isAdmin && pos && max > 0 ? (() => {
          if (st.tie) return `<div class="muted small-text" style="margin-top:6px">It's a tie${spots > 1 ? ' for the last spot' : ''} — consider another round, or lock people in by hand.</div>`;
          const top = st.leaders
            .map((cid) => pos.candidates.find((c) => c.id === cid))
            .filter((c) => c && !c.removed && !pos.lockedIds.includes(c.id));
          if (!top.length || pos.lockedIds.length + top.length > pos.openings) return '';
          return `<button class="small sage" style="margin-top:8px" data-action="lock-many" data-pos="${pos.id}" data-cands="${top.map((c) => c.id).join(',')}">👑 Lock in ${esc(top.map((c) => c.name).join(' & '))}</button>`;
        })() : ''}
      </div>`;
  }

  function adminPanel() {
    const link = location.origin;
    return `
      <div class="section-title"><h2>⭐ Admin tools</h2></div>
      <div class="admin-grid">
        <div class="card">
          <strong>Invite people</strong>
          <p class="muted small-text" style="margin:4px 0 10px">Send this link in the group chat. Everyone joins with their name.</p>
          <div class="row">
            <input class="share-link" value="${esc(link)}" readonly>
            <button class="small primary" data-action="copy-link">Copy</button>
          </div>
        </div>
        <div class="card">
          <strong>In the room (${S.members.length})</strong>
          <div class="member-list">
            ${S.members.map((m) => `<span class="member">${esc(m.name)} <button data-action="kick" data-member="${m.id}" title="Remove from room">✕</button></span>`).join('') || `<span class="muted small-text">Nobody has joined yet.</span>`}
          </div>
        </div>
        <div class="card add-position">
          <strong>Add a position</strong>
          <form class="row" data-form="position">
            <input name="name" placeholder="e.g. Treasurer" maxlength="60" data-draft="position" value="${esc(ui.drafts.position || '')}">
            <button class="small primary" type="submit">Add</button>
          </form>
          <button class="small danger" data-action="reset" style="justify-self:start">Start fresh (clear everything)</button>
        </div>
      </div>`;
  }

  function mainView() {
    const past = S.polls.filter((p) => p.status !== 'open');
    return `
      <div class="wrap">
        ${header()}
        ${activeVoteView()}
        <div class="section-title"><h2>Positions</h2><span class="muted small-text">Tap 📝 under a name to see or add notes</span></div>
        <div class="positions">
          ${S.positions.map(positionView).join('') || `<div class="card empty">No positions yet.${S.isAdmin ? ' Add one in Admin tools below.' : ''}</div>`}
        </div>
        ${past.length ? `
          <div class="section-title"><h2>Vote results</h2></div>
          <div class="results">${past.map(resultView).join('')}</div>` : ''}
        ${S.isAdmin ? adminPanel() : ''}
      </div>`;
  }

  // ---------- render (keeps focus and drafts across live updates) ----------

  function render() {
    if (!S) return;
    const ae = document.activeElement;
    const focusKey = ae && ae.dataset ? ae.dataset.draft : null;
    const sel = focusKey ? [ae.selectionStart, ae.selectionEnd] : null;

    app.innerHTML = !S.me && !S.isAdmin ? joinView() : mainView();

    if (focusKey) {
      const el = app.querySelector(`[data-draft="${CSS.escape(focusKey)}"]`);
      if (el) {
        el.focus();
        try { el.setSelectionRange(sel[0], sel[1]); } catch {}
      }
    }
  }

  // ---------- events ----------

  app.addEventListener('input', (e) => {
    const k = e.target.dataset.draft;
    if (k) ui.drafts[k] = e.target.value;
  });

  // Enter submits a note; Shift+Enter adds a new line.
  app.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && e.target.matches('.note-form textarea')) {
      e.preventDefault();
      e.target.form.requestSubmit();
    }
  });

  app.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const kind = f.dataset.form;
    const val = (name) => (f.elements[name] ? f.elements[name].value.trim() : '');

    if (kind === 'join') {
      const out = await act('/api/join', { name: val('name') });
      if (out) {
        token = out.token;
        store.set('aasa.token', token);
        await refresh();
        toast(`Welcome, ${S.me ? S.me.name : 'friend'}! 👋`);
      }
    } else if (kind === 'admin') {
      const out = await act('/api/admin/login', { pin: val('pin') });
      if (out) {
        adminToken = out.adminToken;
        store.set('aasa.adminToken', adminToken);
        ui.showAdminLogin = false;
        await refresh();
        toast('Admin tools unlocked ⭐');
      }
    } else if (kind === 'absent') {
      const voterName = val('voterName');
      const optionIds = f.elements.optionIds
        ? [...f.querySelectorAll('input[name=optionIds]:checked')].map((x) => x.value)
        : [val('optionId')].filter(Boolean);
      if (!voterName) return toast("Enter the absent person's name");
      if (!optionIds.length) return toast('Pick their vote');
      const key = `absent:name:${f.dataset.poll}`;
      if (await act('/api/polls/proxy', { pollId: f.dataset.poll, voterName, optionIds }, `Added ${voterName}'s vote`)) {
        delete ui.drafts[key];
        render();
      }
    } else if (kind === 'note') {
      const text = val('text');
      if (!text) return;
      const key = `note:${f.dataset.cand}`;
      if (await act('/api/notes', { positionId: f.dataset.pos, candidateId: f.dataset.cand, text })) {
        delete ui.drafts[key];
        render();
      }
    } else if (kind === 'cand') {
      const name = val('name');
      if (!name) return;
      if (await act('/api/candidates', { positionId: f.dataset.pos, name })) {
        delete ui.drafts[`cand:${f.dataset.pos}`];
        render();
        const el = app.querySelector(`[data-draft="cand:${f.dataset.pos}"]`);
        if (el) el.focus();
      }
    } else if (kind === 'position') {
      const name = val('name');
      if (!name) return;
      if (await act('/api/positions', { name }, `Added ${name}`)) {
        delete ui.drafts.position;
        render();
      }
    }
  });

  app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const { action, pos, cand, poll, note, member, option } = b.dataset;
    const p = pos && position(pos);
    const c = p && cand && p.candidates.find((x) => x.id === cand);

    switch (action) {
      case 'show-admin':
      case 'show-admin-main':
        ui.showAdminLogin = true; render(); break;
      case 'hide-admin':
        ui.showAdminLogin = false; render(); break;
      case 'admin-logout':
        adminToken = ''; store.set('aasa.adminToken', ''); await refresh(); break;
      case 'toggle-notes':
        ui.openNotes.has(cand) ? ui.openNotes.delete(cand) : ui.openNotes.add(cand);
        render(); break;
      case 'pick': {
        const max = Number(b.dataset.max) || 1;
        let cur = (ui.picked[poll] || []).filter((x) => x !== 'abstain');
        if (option === 'abstain' || max === 1) cur = (ui.picked[poll] || []).includes(option) ? [] : [option];
        else if (cur.includes(option)) cur = cur.filter((x) => x !== option);
        else if (cur.length >= max) { toast(`You can pick up to ${max} — tap one to unselect it first`); break; }
        else cur.push(option);
        ui.picked[poll] = cur;
        render();
        break;
      }
      case 'vote':
        if (ui.picked[poll] && ui.picked[poll].length && await act('/api/polls/vote', { pollId: poll, optionIds: ui.picked[poll] }, 'Vote submitted 🎉')) {
          delete ui.picked[poll];
        }
        break;
      case 'start-vote':
        await act('/api/polls', { positionId: pos, type: 'position' }, 'Vote started'); break;
      case 'remove-vote':
        await act('/api/polls', { positionId: pos, candidateId: cand, type: 'remove' }, 'Removal vote started'); break;
      case 'close-poll':
        await act('/api/polls/close', { pollId: poll }, 'Voting closed — count still hidden'); break;
      case 'reveal-poll':
        await act('/api/polls/reveal', { pollId: poll }, 'Count revealed'); break;
      case 'delete-poll':
        if (confirm('Delete this vote and its results?')) await act('/api/polls/delete', { pollId: poll }); break;
      case 'lock':
        await act('/api/lock', { positionId: pos, candidateIds: [cand] }, `👑 ${c ? c.name : 'Applicant'} locked in for ${p ? p.name : ''}`); break;
      case 'lock-many':
        await act('/api/lock', { positionId: pos, candidateIds: b.dataset.cands.split(',') }, `👑 Locked in for ${p ? p.name : ''}`); break;
      case 'unlock':
        await act('/api/lock', { positionId: pos, unlockId: cand }); break;
      case 'openings':
        await act('/api/positions/openings', { positionId: pos, openings: Number(b.dataset.n) }); break;
      case 'remove':
        if (confirm(`Remove ${c ? c.name : 'this applicant'} from ${p ? p.name : 'this position'}?`)) {
          await act('/api/candidates/remove', { positionId: pos, candidateId: cand, removed: true }, 'Removed');
        }
        break;
      case 'restore':
        await act('/api/candidates/remove', { positionId: pos, candidateId: cand, removed: false }, 'Restored'); break;
      case 'delete-cand':
        if (confirm(`Delete ${c ? c.name : 'this applicant'} and all their notes? This can't be undone.`)) {
          await act('/api/candidates/delete', { positionId: pos, candidateId: cand });
        }
        break;
      case 'rename-pos': {
        const name = prompt('Rename position', p ? p.name : '');
        if (name && name.trim()) await act('/api/positions/rename', { positionId: pos, name });
        break;
      }
      case 'delete-pos':
        if (confirm(`Delete the ${p ? p.name : ''} position and everyone under it?`)) await act('/api/positions/delete', { positionId: pos });
        break;
      case 'delete-note':
        await act('/api/notes/delete', { positionId: pos, candidateId: cand, noteId: note }); break;
      case 'kick':
        if (confirm('Remove this person from the room? They can rejoin with the link.')) await act('/api/members/delete', { memberId: member });
        break;
      case 'copy-link':
        try { await navigator.clipboard.writeText(location.origin); toast('Link copied — paste it in the GC!'); }
        catch { toast('Copy the link from the box'); }
        break;
      case 'reset': {
        const typed = prompt('This clears all positions, applicants, notes, votes and members.\nType RESET to confirm.');
        if (typed === 'RESET') await act('/api/reset', { confirm: 'RESET' }, 'Everything cleared');
        break;
      }
    }
  });

  // ---------- live updates ----------

  function connect() {
    const es = new EventSource('/api/events');
    es.addEventListener('update', refresh);
    es.onerror = () => {
      es.close();
      setTimeout(connect, 2000);
    };
  }

  refresh();
  connect();
  // Keep "x minutes ago" fresh and recover if the stream silently drops.
  setInterval(refresh, 30000);
})();
