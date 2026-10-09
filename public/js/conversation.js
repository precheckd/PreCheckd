// Running conversation pane: renders the thread, polls for new messages every
// ~12s, sends messages without a page reload, and runs the contact-info
// request/share flow. Message text only ever goes in via textContent.
(function () {
  const root = document.getElementById('convo');
  const dataEl = document.getElementById('convo-data');
  if (!root || !dataEl) return;

  const pane = JSON.parse(dataEl.textContent);
  const base = `/messages/thread/${pane.connectionRequestId}`;
  const POLL_MS = 12000;

  const $ = (id) => document.getElementById(id);
  const els = {
    messages: $('convo-messages'),
    form: $('convo-form'),
    input: $('convo-input'),
    send: $('convo-send'),
    error: $('convo-error'),
    unavailable: $('convo-unavailable'),
    contactLine: $('convo-contact-line'),
    ask: $('convo-ask'),
    warn: $('convo-warn'),
    warnTitle: $('convo-warn-title'),
    warnPoints: $('convo-warn-points'),
    warnConfirm: $('convo-warn-confirm'),
    warnCancel: $('convo-warn-cancel'),
    respond: $('convo-respond'),
    respondPoints: $('convo-respond-points'),
    shareEmail: $('convo-share-email'),
    shareEmailLabel: $('convo-share-email-label'),
    sharePhone: $('convo-share-phone'),
    sharePhoneLabel: $('convo-share-phone-label'),
    sharePhoneWrap: $('convo-share-phone-wrap'),
    shareBtn: $('convo-share-btn'),
    declineBtn: $('convo-decline-btn'),
    tabBadge: $('convo-tab-badge')
  };

  const seen = new Set();
  let lastId = pane.lastId || '';
  let canSend = pane.canSend;
  let contact = pane.contact;
  let unread = pane.unreadCount || 0;
  let sending = false;
  let warnOpen = false;

  // ---- Rendering ----

  function formatTime(iso) {
    const d = new Date(iso);
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay
      ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  const NOTE_TEXT_MINE = {
    contact_request: 'You asked for contact info.',
    contact_shared: 'You shared your contact info.',
    contact_declined: 'You chose to keep talking here for now.'
  };

  function renderMessage(m) {
    if (m.kind !== 'message') {
      const note = document.createElement('div');
      note.className = 'convo-note';
      note.textContent = m.mine ? NOTE_TEXT_MINE[m.kind] || m.body : m.body;
      return note;
    }

    const wrap = document.createElement('div');
    wrap.className = `convo-msg ${m.mine ? 'mine' : 'theirs'}`;

    const bubble = document.createElement('div');
    bubble.className = 'convo-bubble';
    bubble.textContent = m.body;

    const time = document.createElement('div');
    time.className = 'convo-time';
    time.textContent = formatTime(m.sentAt);

    wrap.appendChild(bubble);

    // Scam-pattern warnings, only ever sent for messages from the other person.
    (m.warnings || []).forEach((text) => {
      const warn = document.createElement('div');
      warn.className = 'convo-warning';
      warn.setAttribute('role', 'alert');
      warn.textContent = `⚠ ${text}`;
      wrap.appendChild(warn);
    });

    wrap.appendChild(time);
    return wrap;
  }

  function nearBottom() {
    const el = els.messages;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function scrollToBottom() {
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function showEmptyState() {
    if (seen.size > 0 || els.messages.querySelector('.convo-empty')) return;
    const empty = document.createElement('div');
    empty.className = 'convo-empty';
    empty.textContent = `No messages yet. Say hello to ${pane.otherName} — conversations here stay protected by PreCheckd verification.`;
    els.messages.appendChild(empty);
  }

  function appendMessages(list, { forceScroll = false } = {}) {
    const fresh = list.filter((m) => !seen.has(m.id));
    if (fresh.length === 0) return 0;

    const stick = forceScroll || nearBottom();
    const empty = els.messages.querySelector('.convo-empty');
    if (empty) empty.remove();

    fresh.forEach((m) => {
      seen.add(m.id);
      if (m.id > lastId) lastId = m.id;
      els.messages.appendChild(renderMessage(m));
    });

    if (stick) scrollToBottom();
    return fresh.filter((m) => !m.mine).length;
  }

  // ---- Visibility / unread badge ----

  function paneVisible() {
    return !document.hidden && root.offsetParent !== null;
  }

  function updateBadge() {
    if (!els.tabBadge) return;
    els.tabBadge.textContent = String(unread);
    els.tabBadge.hidden = unread <= 0;
  }

  // ---- Contact info UI ----

  function setList(ul, items) {
    ul.textContent = '';
    items.forEach((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      ul.appendChild(li);
    });
  }

  function renderContact() {
    const shared = contact.shared;

    if (shared) {
      els.contactLine.textContent = `Shared contact: ${[shared.email, shared.phone].filter(Boolean).join(' · ')}`;
      els.contactLine.classList.remove('muted');
      els.contactLine.hidden = false;
    } else if (contact.iAsked) {
      els.contactLine.textContent = 'Contact request sent — waiting on their answer.';
      els.contactLine.classList.add('muted');
      els.contactLine.hidden = false;
    } else {
      els.contactLine.hidden = true;
    }

    const canAsk = !shared && !contact.iAsked && !contact.iAmAsked;
    els.ask.hidden = !canAsk || warnOpen;
    els.warn.hidden = !(canAsk && warnOpen);
    if (!canAsk) warnOpen = false;

    els.respond.hidden = !contact.iAmAsked;
    if (contact.iAmAsked && contact.own) {
      els.shareEmailLabel.textContent = `Share my email (${contact.own.email})`;
      if (contact.own.phone) {
        els.sharePhoneLabel.textContent = `Share my phone (${contact.own.phone})`;
        els.sharePhoneWrap.hidden = false;
      } else {
        els.sharePhoneWrap.hidden = true;
        els.sharePhone.checked = false;
      }
    }
  }

  function renderComposer() {
    els.form.hidden = !canSend;
    els.unavailable.hidden = canSend;
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = false;
  }

  function clearError() {
    els.error.hidden = true;
  }

  // ---- Network ----

  async function postJson(path, body) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* non-JSON error body */ }
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  async function poll() {
    const visible = paneVisible();
    try {
      const res = await fetch(`${base}/poll?afterId=${encodeURIComponent(lastId)}&markRead=${visible ? 1 : 0}`, {
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) return;
      const data = await res.json();

      const incoming = appendMessages(data.messages);
      if (visible) unread = 0;
      else unread += incoming;

      contact = data.contact;
      canSend = data.canSend;
      renderContact();
      renderComposer();
      updateBadge();
      if (seen.size === 0) showEmptyState();
    } catch (e) {
      // Transient network error — the next poll will catch up.
    }
  }

  function schedulePoll() {
    setTimeout(async () => {
      if (!document.hidden) await poll();
      schedulePoll();
    }, POLL_MS);
  }

  // ---- Events ----

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = els.input.value.trim();
    if (!body || sending) return;

    sending = true;
    els.send.disabled = true;
    clearError();

    try {
      const data = await postJson('/send', { body });
      els.input.value = '';
      els.input.style.height = '';
      appendMessages([data.message], { forceScroll: true });
    } catch (err) {
      showError(err.message);
    } finally {
      sending = false;
      els.send.disabled = false;
      els.input.focus();
    }
  });

  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      els.form.requestSubmit();
    }
  });

  els.input.addEventListener('input', () => {
    els.input.style.height = 'auto';
    els.input.style.height = `${Math.min(els.input.scrollHeight, 120)}px`;
  });

  els.ask.addEventListener('click', () => {
    warnOpen = true;
    renderContact();
  });

  els.warnCancel.addEventListener('click', () => {
    warnOpen = false;
    renderContact();
  });

  els.warnConfirm.addEventListener('click', async () => {
    els.warnConfirm.disabled = true;
    clearError();
    try {
      const data = await postJson('/contact/request');
      contact = data.contact;
      warnOpen = false;
      renderContact();
      await poll();
    } catch (err) {
      showError(err.message);
    } finally {
      els.warnConfirm.disabled = false;
    }
  });

  async function respond(action) {
    els.shareBtn.disabled = true;
    els.declineBtn.disabled = true;
    clearError();
    try {
      const data = await postJson('/contact/respond', {
        action,
        shareEmail: els.shareEmail.checked,
        sharePhone: els.sharePhone.checked
      });
      contact = data.contact;
      renderContact();
      await poll();
    } catch (err) {
      showError(err.message);
    } finally {
      els.shareBtn.disabled = false;
      els.declineBtn.disabled = false;
    }
  }

  els.shareBtn.addEventListener('click', () => respond('share'));
  els.declineBtn.addEventListener('click', () => respond('decline'));

  // Phone layout: switch between the profile and the conversation.
  const layout = document.querySelector('.split-layout');
  document.querySelectorAll('[data-split-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!layout) return;
      const tab = btn.getAttribute('data-split-tab');
      layout.setAttribute('data-active', tab);
      document.querySelectorAll('[data-split-tab]').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      if (tab === 'convo') {
        scrollToBottom();
        poll();
      }
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });

  // ---- Init ----

  setList(els.warnPoints, pane.warning.points);
  setList(els.respondPoints, pane.warning.points);
  els.warnTitle.textContent = pane.warning.title;

  appendMessages(pane.messages, { forceScroll: true });
  if (seen.size === 0) showEmptyState();
  renderContact();
  renderComposer();
  updateBadge();
  poll();
  schedulePoll();

  // Arriving from the inbox (?tab=messages): on phones, open straight on the
  // Messages tab. Harmless on desktop, where both sides are always visible.
  try {
    if (new URLSearchParams(window.location.search).get('tab') === 'messages') {
      const convoTab = document.querySelector('[data-split-tab="convo"]');
      if (convoTab) convoTab.click();
    }
  } catch (e) { /* non-critical */ }
})();
