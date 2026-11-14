(function () {
  const form = document.getElementById('job-form');
  if (!form) return;
  const $ = (id) => document.getElementById(id);

  // ---- job title: always one of our roles ----
  const titleInput = $('jp-title');
  const titleIdInput = $('jp-titleid');
  const ideas = $('jp-title-ideas');
  const results = $('jp-role-results');
  const search = $('jp-role-search');
  const note = $('jp-suggest-note');
  const stepErr = $('jp-step2-err');
  const keySelects = Array.from(form.querySelectorAll('.jp-skill-key'));
  const levelSelects = Array.from(form.querySelectorAll('select[name$="[minLevel]"]'));

  function chip(text, onClick) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'jp-chip'; b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }
  function markChosen() {
    form.querySelectorAll('.jp-chip[data-id]').forEach((c) => c.classList.toggle('is-on', c.dataset.id === titleIdInput.value));
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
  function pickRole(r, skills) {
    titleInput.value = r.title;
    titleIdInput.value = r.id;
    if (skills && noSkillsYet() && !keySelects[0].classList.contains('jp-locked')) fillSkills(skills.filter((s) => s.testable));
    stepErr.hidden = true;
    markChosen();
    form.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // The last suggestion: "Not listed" opens the search box for the whole role list.
  function renderIdeas(roles) {
    ideas.textContent = '';
    (roles || []).forEach((r) => ideas.appendChild(roleChip(r, null)));
    const nl = chip('Not listed', () => {
      if (!search.hidden) { search.hidden = true; search.value = ''; results.textContent = ''; nl.classList.remove('is-on'); return; }
      search.hidden = false; nl.classList.add('is-on'); search.focus();
    });
    if (!search.hidden) nl.classList.add('is-on');
    ideas.appendChild(nl);
    markChosen();
  }
  function roleChip(r, skills) { const c = chip(r.title, () => pickRole(r, skills)); c.dataset.id = r.id; return c; }
  if (titleIdInput.value && !titleInput.value) titleIdInput.value = '';
  renderIdeas([]);

  let roleTimer = null;
  search.addEventListener('input', () => {
    clearTimeout(roleTimer);
    const q = search.value.trim();
    if (q.length < 2) { results.textContent = ''; return; }
    roleTimer = setTimeout(async () => {
      try {
        const res = await fetch('/recruiter-jobs/roles?q=' + encodeURIComponent(q), { credentials: 'same-origin' });
        const data = await res.json();
        results.textContent = '';
        (data.roles || []).forEach((r) => results.appendChild(roleChip(r, r.skills)));
        markChosen();
      } catch (e) { /* the suggestions above still work */ }
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
    $('jp-ai-ok').hidden = true;
    try {
      const res = await fetch('/recruiter-jobs/suggest', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: sumEl.value, responsibilities: respEl.value }) });
      const data = await res.json();
      if (!res.ok) { note.textContent = 'Pick your skills above.'; note.hidden = false; return; }
      const hasSkills = !!(data.skills && data.skills.length);
      $('jp-ai-ok').hidden = !(hasSkills && data.source === 'ai');
      if (hasSkills) fillSkills(data.skills);
      lockSkills(hasSkills);
      renderIdeas(data.roles);
      note.hidden = hasSkills;
      note.textContent = hasSkills ? '' : 'Pick your skills above.';
    } catch (e) {
      form.removeAttribute(lastKey);
      note.textContent = 'Pick your skills above.'; note.hidden = false;
    }
  }
  // The wizard calls these when the recruiter leaves a page going forward.
  window.jpOnLeaveDescription = suggest;
  window.jpCanLeave = function (from, to) {
    if (!(from <= 1 && to > 1)) return true;
    const problems = [];
    let any = false;
    keySelects.forEach((sel, i) => {
      const lv = levelSelects[i];
      const bad = !!(sel.value && lv && !lv.value);
      if (sel.value) any = true;
      if (lv) lv.classList.toggle('jp-bad', bad);
      if (bad) problems.push('level');
    });
    if (!any) problems.unshift('skill');
    if (!titleIdInput.value && !titleInput.value.trim()) problems.push('title');
    if (!problems.length) { stepErr.hidden = true; return true; }
    const msgs = [];
    if (problems.includes('skill')) msgs.push('Pick at least one skill.');
    if (problems.includes('level')) msgs.push('Choose a level for each skill.');
    if (problems.includes('title')) msgs.push('Choose a job title.');
    stepErr.textContent = msgs.join(' ');
    stepErr.hidden = false;
    return false;
  };
  levelSelects.forEach((lv) => lv.addEventListener('change', () => lv.classList.remove('jp-bad')));

  // ---- shifts: Flexible means any shift, so it stands alone ----
  const shiftBoxes = Array.from(form.querySelectorAll('input[name="shifts"]'));
  shiftBoxes.forEach((box) => box.addEventListener('change', () => {
    if (!box.checked) return;
    shiftBoxes.forEach((o) => { if (o !== box && (box.value === 'flexible' || o.value === 'flexible')) o.checked = false; });
  }));

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

    const payType = form.querySelector('[name="basePayType"]');
    const commOnly = payType.value === 'commission';
    const enable = $('jp-comm-enable');
    form.querySelectorAll('#jp-base-row input').forEach((el) => { el.disabled = commOnly; if (commOnly) el.value = ''; });
    $('jp-comm-enable-row').hidden = commOnly;
    if (commOnly) enable.checked = true;
    enable.disabled = commOnly;
    $('jp-comm').hidden = !(enable.checked || commOnly);
  }
  [emp, arr, reason, form.querySelector('[name="basePayType"]'), $('jp-comm-enable')].forEach((el) => el.addEventListener('change', sync));
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
      const comm = { checked: type === 'commission' };
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
