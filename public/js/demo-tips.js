// Demo tips: small yellow "i" buttons that explain what a page or section is doing. Loaded only on the demo site
// (see layouts/main.ejs), so the real site never shows them. Each tip is one or two plain sentences.
// Add ?tips=0 to any demo URL to hide them (for screenshots); ?tips=1 brings them back.
(function () {
  'use strict';

  var off = false;
  try {
    var q = new URLSearchParams(window.location.search).get('tips');
    if (q === '0') sessionStorage.setItem('demoTips', 'off');
    if (q === '1') sessionStorage.removeItem('demoTips');
    off = sessionStorage.getItem('demoTips') === 'off';
  } catch (e) { off = q === '0'; }
  if (off) return;

  // Where each tip goes: a page (path pattern), the element to attach to (CSS selector plus the text it starts with),
  // and the text shown. Tips sit at the end of the matched element.
  var JOB_FORM = /^\/recruiter-jobs\/(new|[a-f0-9]{24}\/edit)\/?$/;
  var TIPS = [
    { page: JOB_FORM, sel: 'h2', starts: '1. Description',
      tip: 'Describe the role in your own words. Our system will parse this information to suggest applicable skills on the next page.' },
    { page: JOB_FORM, sel: 'h2', starts: '2. Job title and skills',
      tip: 'We suggest up to three skills from your description, and you confirm each one. Candidates prove these skills with tests, so you see results, not resume claims.' },
    { page: JOB_FORM, sel: 'h2', starts: '3. Company',
      tip: 'Candidates see the hiring company. Blind postings are not allowed, so people know who they are applying to.' },
    { page: JOB_FORM, sel: 'h2', starts: '4. Job details',
      tip: 'Work setting, openings and schedule. A street address stays private. Candidates only see the city.' },
    { page: JOB_FORM, sel: 'h2', starts: '5. Pay',
      tip: 'Pay is required on every posting, so candidates know before they apply and no one wastes time on a job that does not fit.' },
    { page: JOB_FORM, sel: 'h2', starts: '6. Requirements',
      tip: 'Education and certifications you require are verified by PreCheckd, so candidates cannot just claim them. Clearance is reported by the candidate.' },
    { page: JOB_FORM, sel: '.jp-label', starts: 'Finalist test',
      tip: 'Optional, and no extra charge. Pick three topics, then invite some of your applicants to one short assessment that covers them.' },
    { page: JOB_FORM, sel: 'h2', starts: 'Review and',
      tip: 'Check everything on one screen. When applications close, you record how the job ended, which is how applicants find out what happened.' }
  ];

  var css = [
    '.demo-tip{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin:0 0 0 .5rem;padding:0;',
    'border:2px solid #F5C518;border-radius:50%;background:transparent;color:#F5C518;font:700 12px/1 Georgia,serif;cursor:pointer;vertical-align:middle;}',
    '.demo-tip:hover,.demo-tip[aria-expanded="true"]{background:#F5C518;color:#1F363C;}',
    '.demo-tip:focus-visible{outline:2px solid #F4F7F8;outline-offset:2px;}',
    '.demo-tip-pop{box-sizing:border-box;position:absolute;z-index:2000;max-width:320px;width:max-content;padding:.7rem .9rem;background:#2A4750;color:#F4F7F8;',
    'border:1px solid #3B5860;border-left:4px solid #F5C518;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.4);',
    'font:400 14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-transform:none;letter-spacing:0;text-align:left;}'
  ].join('');
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var pop = null, openBtn = null, seq = 0;

  function close() {
    if (pop) { pop.remove(); pop = null; }
    if (openBtn) { openBtn.setAttribute('aria-expanded', 'false'); openBtn.removeAttribute('aria-describedby'); openBtn = null; }
  }

  function place() {
    if (!pop || !openBtn) return;
    var r = openBtn.getBoundingClientRect();
    var w = Math.min(320, window.innerWidth - 24);
    pop.style.maxWidth = w + 'px';
    var left = Math.max(12, Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - w - 12));
    pop.style.left = left + 'px';
    pop.style.top = (r.bottom + window.scrollY + 8) + 'px';
  }

  function open(btn, text) {
    close();
    pop = document.createElement('div');
    pop.className = 'demo-tip-pop';
    pop.id = 'demo-tip-pop';
    pop.setAttribute('role', 'tooltip');
    pop.textContent = text;
    document.body.appendChild(pop);
    openBtn = btn;
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-describedby', 'demo-tip-pop');
    place();
  }

  function addTip(el, text) {
    if (el.querySelector(':scope > .demo-tip')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'demo-tip';
    b.id = 'demo-tip-' + (++seq);
    b.setAttribute('aria-label', 'What is this?');
    b.setAttribute('aria-expanded', 'false');
    b.textContent = 'i';
    b.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      if (openBtn === b) close(); else open(b, text);
    });
    el.appendChild(b);
  }

  function init() {
    var path = window.location.pathname;
    TIPS.forEach(function (t) {
      if (!t.page.test(path)) return;
      var els = document.querySelectorAll(t.sel);
      for (var i = 0; i < els.length; i++) {
        var own = (els[i].firstChild && els[i].firstChild.nodeType === 3 ? els[i].firstChild.nodeValue : els[i].textContent).trim();
        if (own.indexOf(t.starts) === 0) { addTip(els[i], t.tip); break; }
      }
    });
  }

  document.addEventListener('click', function (ev) { if (pop && !ev.target.closest('.demo-tip, .demo-tip-pop')) close(); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') close(); });
  window.addEventListener('resize', place);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
