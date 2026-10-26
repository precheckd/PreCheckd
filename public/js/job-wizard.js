// Posting wizard: the job form's sections shown one page at a time, with a step list on the left to jump
// around, Back/Next buttons, a review page at the end, and (for new postings) a draft saved each time the
// recruiter moves to another page. Without JavaScript the whole form simply shows as one page.
(function () {
  var form = document.getElementById('job-form');
  var wiz = document.getElementById('jp-wiz');
  if (!form || !wiz) return;
  var steps = [].slice.call(form.querySelectorAll('.jp-step'));
  if (steps.length < 2) return;
  var last = steps.length - 1;
  var nav = document.getElementById('jp-nav');
  var progress = document.getElementById('jp-progress');
  var progText = document.getElementById('jp-progress-text');
  var progFill = document.getElementById('jp-progress-fill');
  var draftUrl = form.getAttribute('data-draft-url');
  var draftField = form.querySelector('input[name="_draftId"]');
  var cur = 0;
  var visited = {};
  var errored = {};
  var saving = false;

  wiz.classList.add('jp-wizard');
  progress.hidden = false;

  steps.forEach(function (st, i) {
    if (st.querySelector('.jp-err')) errored[i] = true;
    // Back / Next bar (the review page has Back plus the real submit button)
    var bar = document.createElement('div');
    bar.className = 'jp-nextbar';
    var saved = document.createElement('span'); saved.className = 'jp-saved'; bar.appendChild(saved);
    st._saved = saved;
    if (i > 0) bar.appendChild(btn('Back', 'jp-btn-ghost', function () { go(i - 1); }));
    if (i < last) bar.appendChild(btn(i === last - 1 ? 'Review' : 'Next', 'jp-btn', function () { go(i + 1); }));
    else { var submit = form.querySelector('button[type="submit"]'); if (submit) bar.appendChild(submit); }
    st.appendChild(bar);
  });

  function btn(text, cls, fn) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = text; b.addEventListener('click', fn);
    return b;
  }

  function renderNav() {
    nav.textContent = '';
    steps.forEach(function (st, i) {
      var b = document.createElement('button');
      b.type = 'button';
      var cls = i === cur ? 'is-current' : '';
      if (errored[i]) cls += ' is-error'; else if (visited[i] && i !== cur) cls += ' is-done';
      b.className = cls.trim();
      var dot = document.createElement('span'); dot.className = 'jp-dot';
      dot.textContent = errored[i] ? '!' : (visited[i] && i !== cur ? '\u2713' : String(i + 1));
      var label = document.createElement('span'); label.textContent = st.getAttribute('data-name');
      b.appendChild(dot); b.appendChild(label);
      b.addEventListener('click', function () { go(i); });
      nav.appendChild(b);
    });
  }

  function show(i) {
    cur = i; visited[i] = true;
    steps.forEach(function (st, k) { st.hidden = k !== i; });
    progText.textContent = 'Step ' + (i + 1) + ' of ' + steps.length + ': ' + steps[i].getAttribute('data-name');
    progFill.style.width = Math.round(((i + 1) / steps.length) * 100) + '%';
    if (i === last) buildReview();
    renderNav();
  }

  function go(i) {
    if (i === cur || i < 0 || i > last) return;
    // An error marker clears once the recruiter has seen that page.
    delete errored[cur];
    var leaving = steps[cur];
    saveDraft(i, leaving);
    show(i);
    wiz.scrollIntoView({ block: 'start' });
  }

  function saveDraft(nextStep, fromStep) {
    if (!draftUrl || saving) return;
    var keys = [].slice.call(form.querySelectorAll('.jp-skill-key')).some(function (s) { return s.value; });
    var company = form.querySelector('[name="hiringCompany"]');
    if (!keys && !(company && company.value.trim())) return;
    saving = true;
    var params = new URLSearchParams(new FormData(form));
    params.set('_step', String(nextStep));
    fetch(draftUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        saving = false;
        if (d && d.ok && d.id) { draftField.value = d.id; if (fromStep && fromStep._saved) fromStep._saved.textContent = 'Draft saved'; var s = steps[nextStep]; if (s && s._saved) s._saved.textContent = 'Draft saved'; }
        else if (d && d.error && fromStep._saved) { fromStep._saved.textContent = d.error; }
      })
      .catch(function () { saving = false; });
  }

  // ---- review page: every filled answer, grouped by page, with an Edit link ----
  function humanize(name) {
    return name.replace(/\[\d+\]/g, ' ').replace(/[\[\]_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim().replace(/^./, function (c) { return c.toUpperCase(); });
  }
  function ownText(label) {
    var t = '';
    label.childNodes.forEach(function (n) { if (n.nodeType === 3) t += n.textContent; });
    return t.replace(/\s+/g, ' ').trim();
  }
  function answers(step) {
    var order = []; var map = {};
    function put(key, label, value) {
      if (!map[key]) { map[key] = { label: label, values: [] }; order.push(key); }
      map[key].values.push(value);
    }
    [].slice.call(step.querySelectorAll('input, select, textarea')).forEach(function (el) {
      if (el.disabled || !el.name || el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return;
      var anc = el.parentElement, hid = false;
      while (anc && anc !== step) { if (anc.hidden) { hid = true; break; } anc = anc.parentElement; }
      if (hid) return;
      var key = el.name.replace(/\[\d+\]/g, '[]');
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (!el.checked) return;
        var lab = el.closest('label');
        var text = lab ? lab.textContent.replace(/\s+/g, ' ').trim() : el.value;
        if (el.value === 'on') put(key + text, text.length > 70 ? text.slice(0, 67) + '...' : text, 'Yes');
        else put(key, humanize(el.name), text);
      } else {
        var v = el.tagName === 'SELECT' ? (el.value ? el.options[el.selectedIndex].text : '') : el.value.trim();
        if (!v) return;
        var l = el.closest('label.jp-field');
        var name = (l && ownText(l)) || el.getAttribute('aria-label') || humanize(el.name);
        if (el.tagName === 'TEXTAREA' && v.length > 200) v = v.slice(0, 197) + '...';
        put(key + (el.name.match(/\[(\d+)\]/) || [])[1], name, v);
      }
    });
    return order.map(function (k) { return map[k]; });
  }
  function buildReview() {
    var box = document.getElementById('jp-review');
    box.textContent = '';
    steps.forEach(function (st, i) {
      if (i === last) return;
      var sec = document.createElement('div'); sec.className = 'jp-rev-sec';
      var head = document.createElement('div'); head.className = 'jp-rev-head';
      var strong = document.createElement('strong'); strong.textContent = st.getAttribute('data-name');
      var edit = btn('Edit', 'jp-btn-ghost', function () { go(i); });
      head.appendChild(strong); head.appendChild(edit); sec.appendChild(head);
      var rows = answers(st);
      if (!rows.length) { var none = document.createElement('div'); none.className = 'jp-muted'; none.textContent = 'Nothing filled in on this page.'; sec.appendChild(none); }
      rows.forEach(function (r) {
        var row = document.createElement('div'); row.className = 'jp-rev-row';
        var a = document.createElement('span'); a.textContent = r.label;
        var b = document.createElement('span'); b.textContent = r.values.join(', ');
        row.appendChild(a); row.appendChild(b); sec.appendChild(row);
      });
      box.appendChild(sec);
    });
  }

  // Enter inside a field goes to the next page instead of posting the job early.
  form.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var t = e.target;
    if (!t || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON') return;
    e.preventDefault();
    if (cur < last) go(cur + 1);
  });
  // Only the review page can submit. This listener is registered before job-form.js so the
  // "changes will withdraw applicants" check only runs on a real submit.
  form.addEventListener('submit', function (e) {
    if (cur !== last) { e.preventDefault(); e.stopImmediatePropagation(); go(cur + 1); }
  }, true);

  // Start on the first page with an error (after a failed post), else where the draft left off, else page one.
  var firstErr = steps.findIndex(function (st, i) { return errored[i]; });
  var start = firstErr >= 0 ? firstErr : Math.min(last, parseInt(form.getAttribute('data-start'), 10) || 0);
  for (var k = 0; k < start; k++) visited[k] = true;
  show(start);
})();
