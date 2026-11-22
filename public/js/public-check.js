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
      if (d.age.status === 'unknown') {
        html += '<div class="pc-row"><strong>Domain (' + dom + '):</strong> <span class="pc-warn">we couldn\'t confirm when it was registered.</span> Treat it with caution.</div>';
      } else {
        var when = esc(d.age.text);
        var tail = d.age.paidThrough ? ' It is paid up through ' + esc(d.age.paidThrough) + '.' : '';
        if (d.age.band === 'very_new') {
          html += '<div class="pc-row"><strong>Domain (' + dom + '):</strong> <span class="pc-warn">registered only ' + when + ' ago.</span> Very new domains are a common sign of a scam.</div>';
        } else if (d.age.band === 'recent') {
          html += '<div class="pc-row"><strong>Domain (' + dom + '):</strong> <span class="pc-warn">registered ' + when + ' ago.</span> Fairly new. Not a red flag on its own, but check the company\'s own website to confirm this is really theirs.' + tail + '</div>';
        } else {
          html += '<div class="pc-row"><strong>Domain (' + dom + '):</strong> registered ' + when + ' ago (' + esc(d.age.year) + '). An older domain is a good sign, but scammers can also copy real company names, so check the spelling.' + tail + '</div>';
        }
      }
    }

    if (!d.freeProvider && d.similar) {
      var brand = esc(d.similar.brand);
      html += d.similar.kind === 'uses_name'
        ? '<div class="pc-row"><strong>Name:</strong> <span class="pc-warn">this domain uses the name ' + brand + ' with extra words added.</span> Real recruiters almost always write from the company\'s main domain. Confirm on the company\'s own website before you reply.</div>'
        : '<div class="pc-row"><strong>Name:</strong> <span class="pc-warn">this domain looks a lot like ' + brand + ', but is not spelled the same.</span> Check the spelling carefully, and find the company\'s own careers page yourself.</div>';
    }

    if (!d.freeProvider && d.dns) {
      if (d.dns.mail === 'no') {
        html += '<div class="pc-row"><strong>Email:</strong> <span class="pc-warn">this domain isn\'t set up to receive email.</span> A real recruiter\'s company can be replied to. Be careful.</div>';
      } else if (d.dns.mail === 'yes') {
        html += '<div class="pc-row"><strong>Email:</strong> this domain is set up to receive email.</div>';
      }
      if (d.dns.web === 'no') {
        html += '<div class="pc-row"><strong>Website:</strong> <span class="pc-warn">no website address is set up for this domain.</span> Most real companies have one.</div>';
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
