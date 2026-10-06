(function () {
  const form = document.getElementById('email-checker-form');
  if (!form) return;

  const input = document.getElementById('email-checker-input');
  const button = document.getElementById('email-checker-btn');
  const resultsBox = document.getElementById('email-checker-results');

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    const email = input.value.trim();
    if (!email) return;

    button.disabled = true;
    button.textContent = 'Checking...';
    resultsBox.classList.remove('visible');
    resultsBox.innerHTML = '';

    try {
      const response = await fetch('/api/email-checker/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        resultsBox.innerHTML = `<p class="sc-error">${escapeHtml(data.error || 'Something went wrong.')}</p>`;
        resultsBox.classList.add('visible');
        return;
      }

      let html = '';
      const domain = escapeHtml(data.domain);

      if (data.domainCheck) {
        if (data.domainCheck.verified && data.domainCheck.registeredYear) {
          html += `<div class="sc-result-row"><strong>Domain (${domain}):</strong> registered since ${escapeHtml(data.domainCheck.registeredYear)}.</div>`;
        } else {
          html += `<div class="sc-result-row"><strong>Domain (${domain}):</strong> <span class="sc-flag">registration age could not be confirmed as established</span> — newer or unverified domains can be a scam indicator.</div>`;
        }
      } else if (data.domainCheckError) {
        html += `<div class="sc-error">${escapeHtml(data.domainCheckError)}</div>`;
      }

      if (data.contactCount > 0) {
        const times = data.contactCount === 1 ? 'time' : 'times';
        html += `<div class="sc-result-row"><strong>PreCheckd contact history:</strong> we've contacted this account ${data.contactCount} ${times} in the past 90 days regarding a candidate report.</div>`;
      }

      const searchQuery = `"${data.email}" scam OR fraud`;
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
      html += `<a class="sc-search-link" href="${searchUrl}" target="_blank" rel="noopener noreferrer">Search the web for this email →</a>`;

      resultsBox.innerHTML = html;
      resultsBox.classList.add('visible');
    } catch (error) {
      resultsBox.innerHTML = '<p class="sc-error">Could not reach the checker service. Please try again.</p>';
      resultsBox.classList.add('visible');
    } finally {
      button.disabled = false;
      button.textContent = 'Check';
    }
  });
})();
