// Help tips: small yellow "i" buttons that explain what a form or section is for. Loaded on every page (see layouts/main.ejs).
// Each tip is one or two plain sentences and only explains; anything a person must know stays visible on the page.
// Add ?tips=0 to any URL to hide them (for screenshots); ?tips=1 brings them back.
(function () {
  'use strict';

  var off = false;
  try {
    var q = new URLSearchParams(window.location.search).get('tips');
    if (q === '0') sessionStorage.setItem('helpTips', 'off');
    if (q === '1') sessionStorage.removeItem('helpTips');
    off = sessionStorage.getItem('helpTips') === 'off';
  } catch (e) { off = q === '0'; }
  if (off) return;

  // Where each tip goes: a page (path pattern), the element to attach to (CSS selector plus the text it starts with),
  // and the text shown. Tips sit at the end of the matched element.
  var JOB_FORM = /^\/recruiter-jobs\/(new|[a-f0-9]{24}\/edit)\/?$/;
  var REC_SIGNUP = /^\/founding-recruiter\/?$/;
  var CAND_SIGNUP = /^\/candidate-signup\/?$/;
  var CAND_SKILLS = /^\/candidate\/[^/]+\/skills\/?$/;
  var BILLING = /^\/billing\/?$/;
  var TIPS = [
    { page: JOB_FORM, sel: 'h2', starts: '1. Description',
      tip: 'Describe the role in your own words. Our system will parse this information to suggest applicable skills on the next page.' },
    { page: JOB_FORM, sel: 'h2', starts: '2. Job title and skills',
      tip: 'We suggest up to three skills from your description, and you confirm each one. Candidates prove these skills with tests, so you see results, not resume claims.' },
    { page: JOB_FORM, sel: 'h2', starts: '3. Company',
      tip: 'Candidates see the hiring company. Blind postings are not allowed, so people know who they are applying to.' },
    { page: JOB_FORM, sel: 'label.jp-field', starts: 'Work setting',
      tip: 'Remote in Area means the job is remote, but only people in certain states, or within a set distance of an address, can apply. Use it for tax, licensing or payroll rules, or when people come to the office for some things.' },
    { page: JOB_FORM, sel: 'label.jp-field', starts: 'Street address',
      tip: 'Candidates never see the street address, only the city and state. We use it to place the job on the map, so it shows up when candidates search near that location.' },
    { page: JOB_FORM, sel: 'h2', starts: '5. Pay',
      tip: 'Pay is required on every posting, so candidates know before they apply and no one wastes time on a job that does not fit.' },
    { page: JOB_FORM, sel: 'h2', starts: '6. Requirements',
      tip: 'Education and certifications you require are verified by PreCheckd, so candidates cannot just claim them. Clearance is reported by the candidate.' },
    { page: JOB_FORM, sel: '.jp-label', starts: 'Finalist test',
      tip: 'Optional, and no extra charge. Pick three topics, then invite some of your applicants to one short assessment that covers them.' },
    { page: JOB_FORM, sel: 'h2', starts: 'Review and',
      tip: 'Check everything on one screen. When applications close, you record how the job ended, which is how applicants find out what happened.' },

    // Recruiter signup
    { page: REC_SIGNUP, sel: 'h2', starts: '1. Your details',
      tip: 'Every recruiter on PreCheckd is a verified person. We confirm your email, phone and ID so candidates know who they\u2019re dealing with.' },
    { page: REC_SIGNUP, sel: 'h2', starts: '2. Verify your phone',
      tip: 'We text you a code to confirm the number is yours.' },
    { page: REC_SIGNUP, sel: 'h2', starts: '3. Identity verification',
      tip: 'A one-time check of your government ID and a selfie, run by Stripe Identity. It proves you\u2019re a real person.' },

    // Candidate signup
    { page: CAND_SIGNUP, sel: 'label', starts: 'Resume',
      tip: 'We read your resume to fill in your work history and education. You review everything before it\u2019s saved, or you can skip it and type it yourself.' },
    { page: CAND_SIGNUP, sel: 'h2', starts: 'Verify your identity',
      tip: 'A one-time check of your government ID and a selfie, run by Stripe Identity. It\u2019s what earns your verified badge.' },
    { page: CAND_SIGNUP, sel: 'h2', starts: 'Review your details',
      tip: 'Check what we pulled from your resume and fix anything that\u2019s wrong before you continue.' },

    // Candidate skills and tests
    { page: CAND_SKILLS, sel: 'h2', starts: 'Your skills',
      tip: 'Tick Show on the skills recruiters can see. They see how many skills you\u2019ve been tested on and how many you show, never the hidden ones.' },
    { page: CAND_SKILLS, sel: 'h2', starts: "Don't see your skill?",
      tip: 'We build tests on request, usually within 1 business day, and email you when yours is ready.' },
    { page: CAND_SKILLS, sel: 'h2', starts: 'Tell my recruiters',
      tip: 'Your connections see a one-line update when you earn a certification, degree or skill level. Failed tests and hidden skills are never shared.' },

    // Recruiter billing
    { page: BILLING, sel: 'h2', starts: 'Extra open postings',
      tip: 'Your plan covers 5 open postings at a time. Closing a posting frees its slot, so you only need extras if you want more open at once.' }
  ];

  var css = [
    '.help-tip{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin:0 0 0 .5rem;padding:0;',
    'border:2px solid #F5C518;border-radius:50%;background:transparent;color:#F5C518;font:700 12px/1 Georgia,serif;cursor:pointer;vertical-align:middle;}',
    '.help-tip:hover,.help-tip[aria-expanded="true"]{background:#F5C518;color:#1F363C;}',
    '.help-tip:focus-visible{outline:2px solid #F4F7F8;outline-offset:2px;}',
    '.help-tip-pop{box-sizing:border-box;position:absolute;z-index:2000;max-width:320px;width:max-content;padding:.7rem .9rem;background:#2A4750;color:#F4F7F8;',
    'border:1px solid #3B5860;border-left:4px solid #F5C518;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.4);',
    'font:400 14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-transform:none;letter-spacing:0;text-align:left;}'
  ].join('');
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var pop = null, openBtn = null, seq = 0, pinned = false, timer = null;
  // Hover opens a note only with a real mouse; touch screens use tap. A click pins the note open.
  var canHover = !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);

  function close() {
    clearTimeout(timer); pinned = false;
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
    pop.className = 'help-tip-pop';
    pop.id = 'help-tip-pop';
    pop.setAttribute('role', 'tooltip');
    pop.textContent = text;
    document.body.appendChild(pop);
    openBtn = btn;
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-describedby', 'help-tip-pop');
    place();
  }

  function addTip(el, text) {
    if (el.querySelector(':scope > .help-tip')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'help-tip';
    b.id = 'help-tip-' + (++seq);
    b.setAttribute('aria-label', 'What is this?');
    b.setAttribute('aria-expanded', 'false');
    b.textContent = 'i';
    b.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      clearTimeout(timer);
      if (openBtn === b && pinned) { close(); return; }
      if (openBtn !== b) open(b, text);
      pinned = true;
    });
    if (canHover) {
      b.addEventListener('mouseenter', function () {
        clearTimeout(timer);
        timer = setTimeout(function () { if (openBtn !== b) open(b, text); }, 250);
      });
      b.addEventListener('mouseleave', function () {
        clearTimeout(timer);
        if (openBtn === b && !pinned) close();
      });
    }
    b.addEventListener('focus', function () {
      var kb = false; try { kb = b.matches(':focus-visible'); } catch (e) { /* older browsers: skip */ }
      if (kb && openBtn !== b) open(b, text);
    });
    b.addEventListener('blur', function () { if (openBtn === b && !pinned) close(); });
    
    // On a form label the icon sits right after the label words. Labels are flex columns, so the words and the icon
    // are wrapped together to keep them on one line.
    var txt = null;
    if (el.tagName === 'LABEL') {
      for (var n = el.firstChild; n; n = n.nextSibling) { if (n.nodeType === 3 && n.nodeValue.trim()) { txt = n; break; } }
    }
    if (txt) {
      var wrap = document.createElement('span');
      el.insertBefore(wrap, txt);
      wrap.appendChild(txt);
      wrap.appendChild(b);
    } else el.appendChild(b);
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

  document.addEventListener('click', function (ev) { if (pop && !ev.target.closest('.help-tip, .help-tip-pop')) close(); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') close(); });
  window.addEventListener('resize', place);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
