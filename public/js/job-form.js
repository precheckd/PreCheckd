(function () {
  const form = document.getElementById('job-form');
  if (!form) return;
  const $ = (id) => document.getElementById(id);

  // ---- job title (free text) with optional suggestions ----
  const titleInput = $('jp-title');
  const titleIdInput = $('jp-titleid');
  const ideas = $('jp-title-ideas');
  const results = $('jp-role-results');
  const note = $('jp-suggest-note');
  const keySelects = Array.from(form.querySelectorAll('.jp-skill-key'));
  const levelSelects = Array.from(form.querySelectorAll('select[name$="[minLevel]"]'));
  const roleIds = {};   // lower-case role title -> role id, from the matches shown so far
  const norm = (t) => String(t || '').trim().toLowerCase();

  // The hidden id is only for the pay suggestion: a role's id when the typed title is exactly that role, else "custom".
  function syncTitleId() {
    titleIdInput.value = roleIds[norm(titleInput.value)] || (titleIdInput.dataset.initial && norm(titleInput.value) === titleIdInput.dataset.initialTitle ? titleIdInput.dataset.initial : 'custom');
    form.dispatchEvent(new Event('change', { bubbles: true }));
  }
  titleIdInput.dataset.initial = titleIdInput.value !== 'custom' ? titleIdInput.value : '';
  titleIdInput.dataset.initialTitle = norm(titleInput.value);

  function chip(text, onClick) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'jp-chip'; b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }
  function noSkillsYet() { return keySelects.every((s) => !s.value); }
  function fillSkills(list) {
    const usable = list.slice(0, keySelects.length);
    keySelects.forEach((sel, i) => {
      const s = usable[i];
      const has = s && Array.from(sel.options).some((o) => o.value === s.key);
      sel.value = has ? s.key : '';
      if (levelSelects[i]) levelSelects[i].value = '';   // levels are always the recruiter's choice
    });
    form.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function showRoles(roles) {
    results.textContent = '';
    roles.forEach((r) => {
      roleIds[norm(r.title)] = r.id;
      results.appendChild(chip(r.title, () => {
        titleInput.value = r.title;
        if (noSkillsYet()) fillSkills(r.skills.filter((s) => s.testable));
        syncTitleId();
      }));
    });
    if (roles.length) {
      const hint = document.createElement('p');
      hint.className = 'jp-muted'; hint.style.width = '100%'; hint.style.margin = '0';
      hint.textContent = 'Optional: tap a matching role to use its title and fill in its skills.';
      results.insertBefore(hint, results.firstChild);
    }
  }
  let roleTimer = null;
  titleInput.addEventListener('input', () => {
    syncTitleId();
    clearTimeout(roleTimer);
    const q = titleInput.value.trim();
    if (q.length < 2) { results.textContent = ''; return; }
    roleTimer = setTimeout(async () => {
      try {
        const res = await fetch('/recruiter-jobs/roles?q=' + encodeURIComponent(q), { credentials: 'same-origin' });
        const data = await res.json();
        showRoles(data.roles || []);
        syncTitleId();
      } catch (e) { /* suggestions are optional */ }
    }, 250);
  });

  // ---- suggest skills and titles from the description ----
  const sumEl = $('jp-summary');
  const respEl = form.querySelector('textarea[name="responsibilities"]');
  const lastKey = 'data-suggested';
  const textNow = () => (sumEl.value + '\n' + respEl.value).trim();
  // Edits and drafts that already have skills picked are not re-suggested until the description changes.
  if (!noSkillsYet()) form.setAttribute(lastKey, textNow());
  function lockSkills(on) {
    keySelects.forEach((sel) => { sel.classList.toggle('jp-locked', on); sel.tabIndex = on ? -1 : 0; if (sel.parentElement) sel.parentElement.hidden = on && !sel.value; });
  }
  async function suggest() {
    const text = textNow();
    if (text.length < 40 || form.getAttribute(lastKey) === text) return;
    form.setAttribute(lastKey, text);
    try {
      const res = await fetch('/recruiter-jobs/suggest', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: sumEl.value, responsibilities: respEl.value }) });
      const data = await res.json();
      if (!res.ok) { note.textContent = data.error || 'We could not suggest skills right now. Pick them yourself below.'; note.hidden = false; return; }
      const hasSkills = !!(data.skills && data.skills.length);
      if (hasSkills) fillSkills(data.skills);
      lockSkills(hasSkills);
      ideas.textContent = '';
      const useTitle = (t) => { titleInput.value = t; titleInput.dispatchEvent(new Event('input', { bubbles: true })); markChosen(); };
      const markChosen = () => { Array.from(ideas.children).forEach((c) => { c.style.borderColor = norm(c.textContent) === norm(titleInput.value) ? '#2ECC71' : ''; }); };
      (data.titles || []).forEach((t) => ideas.appendChild(chip(t, () => useTitle(t))));
      const parts = [];
      if (hasSkills) {
        parts.push('We read your posting and chose the top ' + (data.skills.length === 1 ? 'skill' : data.skills.length + ' skills') + ' for this position: ' + data.skills.map((s) => s.label).join(', ') + '. These are set automatically. Choose the job title below that most closely matches, then set the minimum level for each skill.');
      } else {
        parts.push('We could not match skills from that text. Pick them yourself below, or go back and add more detail to your description.');
      }
      if (data.missing && data.missing.length) parts.push('We do not test ' + data.missing.join(', ') + ' yet, so those cannot be required.');
      note.textContent = parts.join(' ');
      note.hidden = false;
    } catch (e) {
      form.removeAttribute(lastKey);
      note.textContent = 'We could not suggest skills right now. Pick them yourself below.'; note.hidden = false;
    }
  }
  // The wizard calls this when the recruiter leaves the description page going forward.
  window.jpOnLeaveDescription = suggest;

  // ---- company suggestions ----
  const company = $('jp-company');
  const companyList = $('jp-company-list');
  let companyTimer = null;
  company.addEventListener('input', () => {
    clearTimeout(companyTimer);
    const q = company.value.trim();
    if (q.length < 2) return;
    companyTimer = setTimeout(async () => {
      try {
        const res = await fetch('/recruiter-jobs/companies?q=' + encodeURIComponent(q), { credentials: 'same-origin' });
        const data = await res.json();
        companyList.textContent = '';
        (data.companies || []).forEach((name) => { const o = document.createElement('option'); o.value = name; companyList.appendChild(o); });
      } catch (e) { /* suggestions are optional */ }
    }, 250);
  });

  // ---- show only the fields that apply ----
  const emp = $('jp-emp'), arr = $('jp-arr'), reason = $('jp-reason');
  function sync() {
    $('jp-contract').hidden = emp.value !== 'contract';
    const a = arr.value;
    $('jp-hybrid').hidden = a !== 'hybrid';
    $('jp-area').hidden = a !== 'remote_in_area';
    const r = reason.value;
    $('jp-states').hidden = !(a === 'remote_in_area' && r === 'states');
    $('jp-radius').hidden = !(a === 'remote_in_area' && r === 'radius');
    $('jp-address').hidden = !(a === 'onsite' || a === 'hybrid' || (a === 'remote_in_area' && r === 'radius'));

    const commOnly = $('jp-comm-only').checked;
    const enable = $('jp-comm-enable');
    form.querySelectorAll('#jp-base-row input, #jp-base-row select').forEach((el) => { el.disabled = commOnly; });
    if (commOnly) enable.checked = true;
    enable.disabled = commOnly;
    $('jp-comm').hidden = !(enable.checked || commOnly);
  }
  [emp, arr, reason, $('jp-comm-only'), $('jp-comm-enable')].forEach((el) => el.addEventListener('change', sync));
  sync();

  // Disabled inputs are not submitted; the server forces base pay to 0 for commission-only jobs anyway.

  // ---- editing: tell the recruiter how many applicants a change would withdraw, before it saves ----
  const previewUrl = form.getAttribute('data-preview');
  if (previewUrl) {
    let confirming = false;
    form.addEventListener('submit', async function (e) {
      if (confirming) return;
      e.preventDefault();
      let ok = true;
      try {
        const params = new URLSearchParams(new FormData(form));
        const res = await fetch(previewUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
        const data = await res.json();
        if (data && data.ok && data.withdraw > 0) {
          ok = window.confirm(data.withdraw + (data.withdraw === 1 ? ' applicant' : ' applicants') +
            ' will be withdrawn because of this change. They will be told what changed and how to fix it. Save the change?');
          if (ok) {
            let box = form.querySelector('input[name="confirmWithdraw"]');
            if (!box) { box = document.createElement('input'); box.type = 'hidden'; box.name = 'confirmWithdraw'; form.appendChild(box); }
            box.value = 'on'; box.checked = true;
          }
        }
      } catch (err) { /* the server still asks for confirmation if it is needed */ }
      if (ok) { confirming = true; form.submit(); }
    });
  }

  // ---- summary counter ----
  const summary = $('jp-summary');
  const count = $('jp-summary-count');
  function updateCount() { count.textContent = summary.value.length; }
  summary.addEventListener('input', updateCount);
  updateCount();

  // ---- pay suggestion (BLS) ----
  const tip = $('jp-paytip');
  const bench = window.PAY_BENCH;
  if (tip && bench) {
    const RANK = { Foundational: 1, Intermediate: 2, Advanced: 3, Expert: 4 };
    const LEVELS = ['Entry level', 'Junior', 'Mid-level', 'Senior', 'Expert'];
    const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
    function levelNow() {
      let top = 0;
      form.querySelectorAll('select[name$="[minLevel]"]').forEach((s) => { top = Math.max(top, RANK[s.value] || 0); });
      return LEVELS[top];
    }
    function showTip() {
      const t = $('jp-titleid');
      const type = (form.querySelector('[name="basePayType"]') || {}).value;
      const comm = $('jp-comm-only');
      const band = t && bench.bands[t.value] && bench.bands[t.value][levelNow()];
      if (!band || (comm && comm.checked)) { tip.hidden = true; return; }
      const hourly = type === 'hourly';
      const f = (n) => hourly ? '$' + (Math.round(n / 2080 * 2) / 2).toFixed(2) + '/hr' : money(n) + '/yr';
      const range = band.high === null ? f(band.low) + ' and up' : f(band.low) + ' to ' + f(band.high);
      tip.innerHTML = '<strong>Typical pay for this role: ' + range + '</strong> <span>(' + levelNow() + '; closest BLS occupation: ' + band.occupation + ')</span>' +
        '<small>A suggestion to help you attract good candidates. Based on ' + bench.source + '. You set the pay.</small>';
      tip.hidden = false;
    }
    form.addEventListener('change', showTip);
    showTip();
  }
})();
