// Lantern Ledger: accounts, friends and shared story universes through Firebase.
// Runs only when firebase-config.js holds a config; otherwise the app stays on-device.
if (window.FIREBASE_CONFIG) (function () {
  let AUTH = null, FS = null, FRIENDS = [], UNSUBS = [], KNOWN = new Set(), AUTHMODE = 'in';
  const PROF = {}, IDX = {}, FT = {}, FC = {};

  /* ---------- styles for the sign-in screen and friends ---------- */
  const css = document.createElement('style');
  css.textContent = `
  .auth{position:fixed;inset:0;z-index:60;background:var(--bg);overflow-y:auto;display:grid;place-items:center;padding:calc(24px + env(safe-area-inset-top,0px)) 16px calc(24px + env(safe-area-inset-bottom,0px))}
  .auth-card{width:100%;max-width:400px;display:grid;gap:16px}
  .auth-brand{display:flex;align-items:center;gap:12px}
  .auth-brand img{width:52px;height:52px;border-radius:14px}
  .auth-brand .brand{font-size:1.7rem}
  .seg{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
  .seg button{font:inherit;padding:8px;border:0;border-radius:7px;background:none;color:var(--muted);cursor:pointer}
  .seg button[aria-pressed="true"]{background:var(--moss);color:var(--surface)}
  #auth-form{display:grid;gap:14px}
  .err{color:var(--danger)}
  .frow{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line)}
  .frow:first-of-type{border-top:0}
  .frow .who{flex:1;min-width:140px}
  .acct{display:grid;gap:8px;padding:12px 14px;border-top:1px solid var(--line)}
  .acct-row{display:flex;align-items:center;gap:10px;min-width:0}
  .acct-row span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`;
  document.head.appendChild(css);

  /* ---------- helpers ---------- */
  const FV = () => firebase.firestore.FieldValue;
  const hash = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  function initialsAvatar(name, id) {
    const c = COLORS[hash(id) % COLORS.length];
    const i = (name || '?').trim().split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase() || '?';
    return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="${c}"/><text x="32" y="41" font-family="Georgia,serif" font-size="26" fill="#fff" text-anchor="middle">${esc(i)}</text></svg>`);
  }
  async function loadProfiles(ids) {
    const miss = [...new Set(ids)].filter(id => id && id !== 'local' && !(id in PROF));
    await Promise.all(miss.map(async id => {
      PROF[id] = {};
      try { const s = await FS.doc('users/' + id).get(); PROF[id] = s.exists ? s.data() : {}; } catch (e) {}
    }));
  }
  const U_FB = {
    async profiles(ids) {
      ids = [].concat(ids); await loadProfiles(ids);
      const o = {};
      ids.forEach(id => { const p = PROF[id] || {}; o[id] = { id, name: p.name || '', handle: p.handle || '', avatarUrl: initialsAvatar(p.name, id), isMe: id === ME.id }; });
      return o;
    }
  };
  const handleOf = id => PROF[id] && PROF[id].handle ? '@' + PROF[id].handle : '';
  function fbErr(e) {
    status();
    const code = e && e.code || '';
    if (code === 'permission-denied') toast("You don't have permission to change that.");
    else if (code === 'unavailable') toast("You're offline. Changes will sync when you reconnect.");
    else toast('A change did not save. Check your connection and try again.');
  }

  /* ---------- writes (replace the on-device versions) ---------- */
  const sub = coll => coll === 'chars' || coll === 'bible';
  function fsWrite(coll, o) {
    if (coll === 'members') return Promise.resolve();
    if (sub(coll)) { IDX[o.id] = o.sid; return FS.doc(`stories/${o.sid}/${coll}/${o.id}`).set(clean(o)); }
    if (coll === 'stories') {
      const ref = FS.doc('stories/' + o.id);
      if (KNOWN.has(o.id)) return ref.update({ name: o.name || '', genre: o.genre || '', color: o.color || '' });
      return ref.set({ ...clean(o), createdBy: ME.id, members: [ME.id] });
    }
    return FS.doc(`${coll}/${o.id}`).set(clean(o));
  }
  function frun(k) {
    const j = FT[k]; if (!j) return; delete FT[k]; clearTimeout(j.t); status('Saving…');
    FC[k] = (FC[k] || Promise.resolve()).then(j.fn).then(() => status(), fbErr);
  }
  put = function (coll, o, delay = 500) {
    if (MODE !== 'shared') { saveLocal(); return; }
    const k = coll + '/' + o.id; if (FT[k]) clearTimeout(FT[k].t);
    FT[k] = { t: setTimeout(() => frun(k), delay), fn: () => fsWrite(coll, o) };
  };
  flush = function () { Object.keys(FT).forEach(frun); };
  del = function (coll, id) {
    if (MODE !== 'shared') { saveLocal(); return; }
    if (coll === 'members') {
      const [sid, who] = id.split('~'); if (who !== ME.id) return;
      const st = STORIES.find(s => s.id === sid); if (st && st.createdBy === ME.id) return; // creators delete, they don't leave
      FS.doc('stories/' + sid).update({ members: FV().arrayRemove(ME.id) }).catch(fbErr); return;
    }
    const k = coll + '/' + id; if (FT[k]) { clearTimeout(FT[k].t); delete FT[k]; }
    const ref = sub(coll) ? FS.doc(`stories/${IDX[id]}/${coll}/${id}`) : FS.doc(`${coll}/${id}`);
    // A story is deleted last, after its characters and bible entries are gone.
    const before = coll === 'stories' ? Promise.all(Object.values(FC)).catch(() => {}) : (FC[k] || Promise.resolve());
    FC[k] = before.then(() => ref.delete()).catch(fbErr);
  };
  addBundle = async function (d) {
    const map = {}; let i = 0;
    for (const s of d.stories) { const id = newId() + (i++); map[s.id] = id; await FS.doc('stories/' + id).set({ ...clean(s), createdBy: ME.id, members: [ME.id], createdAt: Date.now() + i }); }
    for (const c of d.chars) { if (!map[c.sid]) continue; const id = newId() + (i++); await FS.doc(`stories/${map[c.sid]}/chars/${id}`).set({ ...clean(c), sid: map[c.sid], ownerId: ME.id }); }
    for (const b of d.bible) { if (!map[b.sid]) continue; const id = newId() + (i++); await FS.doc(`stories/${map[b.sid]}/bible/${id}`).set({ ...clean(b), sid: map[b.sid], ownerId: ME.id }); }
    return Object.keys(map).length;
  };

  /* ---------- live data ---------- */
  function teardown() { UNSUBS.forEach(f => { try { f(); } catch (e) {} }); UNSUBS = []; FRIENDS = []; KNOWN = new Set(); }
  function startShared(user) {
    MODE = 'loading'; ME = { id: user.uid }; U = U_FB; CANWRITE = true;
    STORIES = []; CHARS = []; BIBLE = []; MEMB = []; curC = null; curB = null;
    renderAll();
    const CM = {}, BM = {}, SUBS = {};
    const recompute = () => { CHARS = Object.values(CM).flat(); BIBLE = Object.values(BM).flat(); };
    const pickActive = () => { if (!STORIES.some(x => x.id === active)) active = STORIES[0] ? STORIES[0].id : null; };
    UNSUBS.push(FS.collection('stories').where('members', 'array-contains', ME.id).onSnapshot(s => {
      STORIES = s.docs.map(d => ({ ...d.data(), id: d.id }));
      KNOWN = new Set(STORIES.map(x => x.id));
      MEMB = STORIES.flatMap(st => (st.members || []).map(u => ({ id: st.id + '~' + u, sid: st.id, uid: u })));
      for (const sid of Object.keys(SUBS)) if (!KNOWN.has(sid)) { SUBS[sid].forEach(f => f()); delete SUBS[sid]; delete CM[sid]; delete BM[sid]; }
      for (const sid of KNOWN) if (!SUBS[sid]) SUBS[sid] = [
        FS.collection(`stories/${sid}/chars`).onSnapshot(q => { CM[sid] = q.docs.map(d => { IDX[d.id] = sid; return { ...d.data(), id: d.id, sid }; }); recompute(); onData(); }, () => {}),
        FS.collection(`stories/${sid}/bible`).onSnapshot(q => { BM[sid] = q.docs.map(d => { IDX[d.id] = sid; return { ...d.data(), id: d.id, sid }; }); recompute(); onData(); }, () => {})
      ];
      recompute(); pickActive();
      if (MODE === 'loading') { MODE = 'shared'; renderAll(); } else onData();
    }, () => toast('Could not load your stories. Check your connection.')));
    UNSUBS.push(FS.collection('friendships').where('members', 'array-contains', ME.id).onSnapshot(s => {
      FRIENDS = s.docs.map(d => ({ ...d.data(), id: d.id }));
      loadProfiles(FRIENDS.flatMap(f => f.members)).then(onData);
    }, () => {}));
    UNSUBS.push(() => Object.values(SUBS).flat().forEach(f => f()));
  }

  /* ---------- friends ---------- */
  const other = f => f.members.find(m => m !== ME.id);
  const frow = (id, buttons) => `<div class="frow">${ava(id)}<span class="who"><strong>${who(id)}</strong> <span class="note">${esc(handleOf(id))}</span></span><span class="btns">${buttons}</span></div>`;
  renderFriends = function () {
    const box = $('#tab-friends');
    if (MODE === 'loading') { box.innerHTML = '<div class="panel"><p class="note">Loading…</p></div>'; return; }
    if (MODE !== 'shared') {
      box.innerHTML = `<div class="panel"><span class="label">Friends</span><h2>Share story universes</h2>
        <p class="note" style="max-width:62ch">Sign in to add friends by username and share stories, so their characters show up next to yours. Your stories on this device can be copied into your account from Backup.</p>
        <button class="btn primary" style="justify-self:start" id="f-signin">Sign in or create an account</button></div>`;
      $('#f-signin').onclick = () => { lsSet('ll-offline', false); showAuth('in'); };
      return;
    }
    const me = PROF[ME.id] || {}, w = W();
    const acc = FRIENDS.filter(f => f.status === 'accepted');
    const inc = FRIENDS.filter(f => f.status === 'pending' && f.requestedBy !== ME.id);
    const out = FRIENDS.filter(f => f.status === 'pending' && f.requestedBy === ME.id);
    box.innerHTML = `<div style="display:grid;gap:16px">
      <div class="panel"><span class="label">Your username</span>
        <div class="acct-row">${ava(ME.id, 'lg')}<div><strong>${esc(me.name || 'You')}</strong><br><span class="note">@${esc(me.handle || '')}</span></div></div>
        <div class="btns"><button class="btn" id="f-copy">Copy username</button></div>
        <p class="note">Friends add you with this username.</p></div>
      <div class="panel"><span class="label">Add a friend</span>
        <form class="wedit" id="f-form"><input id="f-handle" placeholder="@username" autocapitalize="off" autocomplete="off" spellcheck="false" aria-label="Friend's username"><button class="btn primary" type="submit">Send request</button></form>
        <p class="note" id="f-msg" aria-live="polite"></p></div>
      ${inc.length ? `<div class="panel"><span class="label">Friend requests (${inc.length})</span>${inc.map(f => frow(other(f), `<button class="btn primary small" data-acc="${f.id}">Accept</button><button class="btn ghost small" data-dec="${f.id}">Decline</button>`)).join('')}</div>` : ''}
      <div class="panel"><span class="label">Friends (${acc.length})</span>
        ${acc.length ? acc.map(f => {
          const id = other(f), common = STORIES.filter(s => (s.members || []).includes(id));
          const inv = w && !(w.members || []).includes(id) ? `<button class="btn small" data-inv="${id}">Add to ${esc(w.name)}</button>` : '';
          return frow(id, inv + `<button class="btn ghost small danger" data-rm="${f.id}">Remove</button>`)
            + `<div class="chips" style="margin:-4px 0 6px 36px">${common.map(s => `<button class="chip" style="border:0;cursor:pointer" data-go="${s.id}">${esc(s.name)}</button>`).join('') || '<span class="note">No shared stories yet</span>'}</div>`;
        }).join('') : '<p class="note">No friends yet. Send a request with their username.</p>'}
        ${w && acc.length ? `<p class="note">"Add to ${esc(w.name)}" lets that friend see the story, add their own characters and edit its story bible.</p>` : ''}</div>
      ${out.length ? `<div class="panel"><span class="label">Waiting for them to accept</span>${out.map(f => frow(other(f), `<button class="btn ghost small" data-dec="${f.id}">Cancel</button>`)).join('')}</div>` : ''}
    </div>`;
    const msg = (t, bad) => { const m = $('#f-msg'); m.textContent = t; m.classList.toggle('err', !!bad); };
    $('#f-copy').onclick = () => copy('@' + (me.handle || ''));
    $('#f-form').onsubmit = async e => {
      e.preventDefault();
      const h = $('#f-handle').value.trim().toLowerCase().replace(/^@/, '');
      if (!/^[a-z0-9_]{3,20}$/.test(h)) return msg('Usernames are 3 to 20 letters, numbers or underscores.', 1);
      msg('Looking them up…');
      try {
        const s = await FS.doc('handles/' + h).get();
        if (!s.exists) return msg('No one has that username. Check the spelling.', 1);
        const uid = s.data().uid; if (uid === ME.id) return msg("That's your own username.", 1);
        const fid = [ME.id, uid].sort().join('_'), ex = FRIENDS.find(f => f.id === fid);
        if (ex && ex.status === 'accepted') return msg('You are already friends.');
        if (ex && ex.requestedBy !== ME.id) { await FS.doc('friendships/' + fid).update({ status: 'accepted' }); return msg('They had already asked. You are now friends.'); }
        if (ex) return msg('Request already sent. Waiting for them to accept.');
        await FS.doc('friendships/' + fid).set({ members: [ME.id, uid].sort(), requestedBy: ME.id, status: 'pending', createdAt: Date.now() });
        $('#f-handle').value = ''; msg(`Request sent to @${h}.`);
      } catch (err) { msg('Could not send the request. Check your connection and try again.', 1); }
    };
    box.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => FS.doc('friendships/' + b.dataset.acc).update({ status: 'accepted' }).catch(fbErr));
    box.querySelectorAll('[data-dec]').forEach(b => b.onclick = () => FS.doc('friendships/' + b.dataset.dec).delete().catch(fbErr));
    box.querySelectorAll('[data-rm]').forEach(b => arm(b, 'Tap again to remove', () => FS.doc('friendships/' + b.dataset.rm).delete().catch(fbErr)));
    box.querySelectorAll('[data-inv]').forEach(b => b.onclick = () => {
      b.disabled = true;
      FS.doc('stories/' + w.id).update({ members: FV().arrayUnion(b.dataset.inv) })
        .then(() => toast(`Added to ${w.name}`)).catch(e => { b.disabled = false; fbErr(e); });
    });
    box.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { setActive(b.dataset.go); showTab('cast'); });
  };

  /* ---------- story card: invite button ---------- */
  const baseWorlds = renderWorlds;
  renderWorlds = function () {
    baseWorlds();
    if (MODE !== 'shared') return;
    const m = document.querySelector('#wedit .members');
    if (m && W()) { const b = document.createElement('button'); b.className = 'btn small'; b.textContent = 'Invite friends'; b.onclick = () => showTab('friends'); m.appendChild(b); }
  };

  /* ---------- account area in the menu ---------- */
  const baseRenderAll = renderAll;
  renderAll = function () {
    baseRenderAll();
    let a = document.getElementById('acct');
    if (!a) { a = document.createElement('div'); a.id = 'acct'; a.className = 'acct'; $('#drawer').appendChild(a); }
    if (MODE === 'shared') {
      const p = PROF[ME.id] || {};
      a.innerHTML = `<div class="acct-row">${ava(ME.id)}<span><strong>${esc(p.name || 'You')}</strong> <span class="note">@${esc(p.handle || '')}</span></span></div><button class="btn ghost small" id="a-out" style="justify-self:start">Sign out</button>`;
      $('#a-out').onclick = () => { lsSet('ll-offline', false); AUTH.signOut(); };
    } else if (MODE === 'local') {
      a.innerHTML = `<p class="note">Saved on this device only.</p><button class="btn small" id="a-in" style="justify-self:start">Sign in to share with friends</button>`;
      $('#a-in').onclick = () => { lsSet('ll-offline', false); showAuth('in'); };
    } else a.innerHTML = '';
    paintPeople();
  };

  /* ---------- sign-in screen ---------- */
  const AUTH_ERR = {
    'auth/email-already-in-use': 'That email already has an account. Sign in instead.',
    'auth/invalid-email': 'That email address does not look right.',
    'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/invalid-credential': 'Email or password is wrong.',
    'auth/wrong-password': 'Email or password is wrong.',
    'auth/user-not-found': 'No account with that email. Create one instead.',
    'auth/missing-password': 'Enter your password.',
    'auth/too-many-requests': 'Too many tries. Wait a few minutes and try again.',
    'auth/network-request-failed': 'No connection. Check your internet and try again.'
  };
  function showAuth(mode) {
    AUTHMODE = mode;
    let el = document.getElementById('auth');
    if (!el) { el = document.createElement('div'); el.id = 'auth'; el.className = 'auth'; document.body.appendChild(el); }
    el.hidden = false;
    const up = mode === 'up', prof = mode === 'profile';
    el.innerHTML = `<div class="auth-card">
      <div class="auth-brand"><img src="icons/icon-192.png" alt=""><span class="brand">Lantern <span>Ledger</span></span></div>
      <p class="note">${prof ? 'One last step: pick the name and username your friends will see.' : 'Sign in to share story universes with your friends.'}</p>
      ${prof ? '' : `<div class="seg"><button type="button" data-m="in" aria-pressed="${!up}">Sign in</button><button type="button" data-m="up" aria-pressed="${up}">Create account</button></div>`}
      <form id="auth-form" novalidate>
        ${up || prof ? `<label class="field"><span class="label">Display name</span><input id="a-name" autocomplete="nickname" maxlength="40"></label>
        <label class="field"><span class="label">Username</span><input id="a-handle" placeholder="e.g. lantern_keeper" autocapitalize="off" autocomplete="username" spellcheck="false" maxlength="21"></label>` : ''}
        ${prof ? '' : `<label class="field"><span class="label">Email</span><input id="a-email" type="email" autocomplete="email"></label>
        <label class="field"><span class="label">Password</span><input id="a-pw" type="password" autocomplete="${up ? 'new-password' : 'current-password'}"></label>`}
        <p class="note" id="a-msg" aria-live="polite"></p>
        <button class="btn primary" type="submit" id="a-go">${prof ? 'Save and continue' : up ? 'Create account' : 'Sign in'}</button>
        ${mode === 'in' ? '<button class="btn ghost" type="button" id="a-forgot">Forgot password?</button>' : ''}
      </form>
      ${prof ? '<button class="btn ghost" id="a-cancel">Sign out</button>' : '<button class="btn ghost" id="a-offline">Use without an account (this device only)</button>'}
    </div>`;
    const msg = (t, bad) => { const m = $('#a-msg'); m.textContent = t; m.classList.toggle('err', !!bad); };
    el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => showAuth(b.dataset.m));
    const off = $('#a-offline'); if (off) off.onclick = () => { lsSet('ll-offline', true); hideAuth(); startLocal(); };
    const cancel = $('#a-cancel'); if (cancel) cancel.onclick = () => AUTH.signOut();
    const forgot = $('#a-forgot'); if (forgot) forgot.onclick = async () => {
      const email = $('#a-email').value.trim(); if (!email) return msg('Enter your email first, then tap Forgot password.', 1);
      try { await AUTH.sendPasswordResetEmail(email); msg('Check your email for a link to reset your password.'); }
      catch (e) { msg(AUTH_ERR[e.code] || 'Could not send the reset email.', 1); }
    };
    $('#auth-form').onsubmit = async e => {
      e.preventDefault();
      const go = $('#a-go'); go.disabled = true;
      try {
        if (mode === 'in') {
          msg('Signing in…');
          await AUTH.signInWithEmailAndPassword($('#a-email').value.trim(), $('#a-pw').value);
        } else {
          const name = $('#a-name').value.trim(), handle = $('#a-handle').value.trim().toLowerCase().replace(/^@/, '');
          if (!name) throw { msg: 'Enter a display name.' };
          if (!/^[a-z0-9_]{3,20}$/.test(handle)) throw { msg: 'Usernames are 3 to 20 letters, numbers or underscores.' };
          msg('Checking that username…');
          const taken = await FS.doc('handles/' + handle).get();
          if (taken.exists && (!AUTH.currentUser || taken.data().uid !== AUTH.currentUser.uid)) throw { msg: 'That username is taken. Try another.' };
          PENDING_PROFILE = { name, handle };
          if (mode === 'up') { msg('Creating your account…'); await AUTH.createUserWithEmailAndPassword($('#a-email').value.trim(), $('#a-pw').value); }
          else await finishProfile(AUTH.currentUser);
        }
      } catch (err) {
        go.disabled = false;
        msg(err.msg || AUTH_ERR[err.code] || err.message || 'Something went wrong. Try again.', 1);
      }
    };
    const first = el.querySelector('input'); if (first) first.focus();
  }
  function hideAuth() { const el = document.getElementById('auth'); if (el) el.hidden = true; }

  let PENDING_PROFILE = null;
  async function finishProfile(user) {
    const { name, handle } = PENDING_PROFILE; PENDING_PROFILE = null;
    try {
      await FS.runTransaction(async t => {
        const h = FS.doc('handles/' + handle), s = await t.get(h);
        if (s.exists && s.data().uid !== user.uid) throw { msg: 'That username was just taken. Pick another.' };
        if (!s.exists) t.set(h, { uid: user.uid });
        t.set(FS.doc('users/' + user.uid), { name, handle, createdAt: Date.now() });
      });
      PROF[user.uid] = { name, handle };
      hideAuth(); startShared(user);
    } catch (err) {
      showAuth('profile');
      const m = $('#a-msg'); m.textContent = err.msg || 'Could not save your profile. Check your connection and try again.'; m.classList.add('err');
    }
  }

  /* ---------- start ---------- */
  function load(src) {
    return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error(src)); document.head.appendChild(s); });
  }
  (async () => {
    status('Connecting…');
    try { for (const f of ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js']) await load('vendor/' + f); }
    catch (e) { toast('Sign-in could not load. Using this device only for now.'); startLocal(); return; }
    firebase.initializeApp(window.FIREBASE_CONFIG);
    AUTH = firebase.auth(); FS = firebase.firestore();
    FS.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    AUTH.onAuthStateChanged(async user => {
      teardown();
      if (user) {
        if (PENDING_PROFILE) return finishProfile(user);
        let p = null; try { p = await FS.doc('users/' + user.uid).get(); } catch (e) {}
        if (p && !p.exists) return showAuth('profile');
        if (p) PROF[user.uid] = p.data();
        hideAuth(); startShared(user);
      } else if (lsGet('ll-offline')) { hideAuth(); startLocal(); }
      else { MODE = 'loading'; showAuth('in'); }
    });
  })();
})();
