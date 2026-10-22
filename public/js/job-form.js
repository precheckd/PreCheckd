(function () {
  const form = document.getElementById('job-form');
  if (!form) return;
  const $ = (id) => document.getElementById(id);

  // ---- titles follow the picked skills ----
  const titlesBox = $('jp-titles');
  const emptyMsg = $('jp-titles-empty');
  const noTitle = $('jp-no-title');
  const keySelects = Array.from(form.querySelectorAll('.jp-skill-key'));

  function pickedKeys() {
    return Array.from(new Set(keySelects.map((s) => s.value).filter(Boolean)));
  }

  function showTitles(titles, keys) {
    const current = (form.querySelector('input[name="titleId"]:checked') || {}).value;
    titlesBox.textContent = '';
    titles.forEach((t) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio'; input.name = 'titleId'; input.value = t.id;
      if (t.id === current) input.checked = true;
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + t.title));
      titlesBox.appendChild(label);
    });
    emptyMsg.hidden = keys.length > 0;
    noTitle.hidden = !(keys.length > 0 && titles.length === 0);
  }

  async function refreshTitles() {
    const keys = pickedKeys();
    if (!keys.length) return showTitles([], keys);
    try {
      const res = await fetch('/recruiter-jobs/titles?skills=' + encodeURIComponent(keys.join(',')), { credentials: 'same-origin' });
      const data = await res.json();
      showTitles(data.titles || [], keys);
    } catch (e) { /* leave the list as it is */ }
  }
  keySelects.forEach((s) => s.addEventListener('change', refreshTitles));
  if (pickedKeys().length && !titlesBox.children.length) refreshTitles();
  else noTitle.hidden = !(pickedKeys().length > 0 && titlesBox.children.length === 0);

  const requestBtn = $('jp-request-title');
  if (requestBtn) {
    requestBtn.addEventListener('click', async () => {
      const status = $('jp-request-status');
      requestBtn.disabled = true;
      try {
        const res = await fetch('/recruiter-jobs/request-title', {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skills: pickedKeys().map((k) => ({ key: k })) }),
        });
        const data = await res.json();
        status.textContent = ' ' + (data.message || data.error || 'Done.');
      } catch (e) {
        status.textContent = ' Something went wrong. Please try again.';
        requestBtn.disabled = false;
      }
    });
  }

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

  // ---- summary counter ----
  const summary = $('jp-summary');
  const count = $('jp-summary-count');
  function updateCount() { count.textContent = summary.value.length; }
  summary.addEventListener('input', updateCount);
  updateCount();
})();
