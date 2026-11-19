(function () {
  var form = document.getElementById('public-check-form');
  if (!form) return;
  var input = document.getElementById('public-check-input');
  var button = document.getElementById('public-check-btn');
  var box = document.getElementById('public-check-results');

  function esc(v) {
    var d = document.createElement('div');
    d.textContent = v == null ? '' : String(v);
    return d.innerHTML;
  }

  function show(html) { box.innerHTML = html; box.classList.add('visible'); }

  function render(d) {
    var html = '';
    var dom = esc(d.domain);

    if (d.verified) {
      var who = esc(d.verified.name) + (d.verified.company ? ' at ' + esc(d.verified.company) : '');
      html += '<div class="pc-row"><span class="pc-good">Verified on PreCheckd.</span> This address belongs to ' + who + '. <a href="' + esc(d.verified.profileUrl) + '">See their profile</a>.</div>';
    } else {
      html += '<div class="pc-row"><strong>PreCheckd:</strong> this address is not a verified recruiter on PreCheckd. That alone doesn\'t mean it\'s a scam, since most recruiters aren\'t on PreCheckd yet.</div>';
    }

    if (d.freeProvider) {
      html += '<div class="pc-row"><strong>Email provider (' + dom + '):</strong> <span class="pc-warn">a free email address.</span> Recruiters at real companies almost always write from a company address, so be extra careful and confirm the person another way.</div>';
    } else if (d.age) {
      if (d.age.status === 'established') {
        html += '<div class="pc-row"><strong>Domain (' + dom + '):</strong> registered in ' + esc(d.age.year) + '. An older domain is a good sign, but scammers can also copy real company names, so check the spelling.</div>';
      } else if (d.age.status === 'new') {
        html += '<div class="pc-row"><strong>Domain (' + dom + '):</strong> <span class="pc-warn">registered only ' + esc(d.age.days) + ' days ago.</span> Very new domains are a common sign of a scam.</div>';
      } else {
        html += '<div class="pc-row"><strong>Domain (' + dom + '):</strong> <span class="pc-warn">we couldn\'t confirm when it was registered.</span> Treat it with caution.</div>';
      }
    }

    var q = '"' + d.email + '" scam OR fraud';
    html += '<div class="pc-row"><a href="https://www.google.com/search?q=' + encodeURIComponent(q) + '" target="_blank" rel="noopener noreferrer">Search the web for this email &rarr;</a></div>';
    show(html);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = input.value.trim();
    if (!email) return;
    button.disabled = true;
    button.textContent = 'Checking...';
    box.classList.remove('visible');
    box.innerHTML = '';

    fetch('/api/public-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email }),
    })
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
      .then(function (res) {
        if (!res.ok) show('<p class="pc-error">' + esc(res.data.error || 'Something went wrong.') + '</p>');
        else render(res.data);
      })
      .catch(function () { show('<p class="pc-error">Could not reach the checker. Please try again.</p>'); })
      .then(function () { button.disabled = false; button.textContent = 'Check'; });
  });
})();
