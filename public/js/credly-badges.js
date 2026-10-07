(function () {
  const recheckBtn = document.getElementById('credly-recheck-btn');
  if (recheckBtn && window.PRECHECKD_CANDIDATE_SLUG) {
    const status = document.getElementById('credly-recheck-status');
    recheckBtn.addEventListener('click', async function () {
      const input = document.querySelector('input[name="credlyUsername"]');
      recheckBtn.disabled = true;
      status.textContent = 'Checking Credly…';
      try {
        const response = await fetch(`/candidate/${window.PRECHECKD_CANDIDATE_SLUG}/edit/recheck-credly`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credlyUsername: input ? input.value : '' }),
        });
        const data = await response.json();
        if (!response.ok) {
          status.textContent = data.error || 'Something went wrong. Please try again.';
          recheckBtn.disabled = false;
          return;
        }
        status.textContent = 'Done — refreshing…';
        window.location.reload();
      } catch (error) {
        status.textContent = 'Could not reach the server. Please try again.';
        recheckBtn.disabled = false;
      }
    });
  }

  const container = document.getElementById('credly-found-list');
  if (!container) return;

  const slug = window.PRECHECKD_CANDIDATE_SLUG;
  if (!slug) return;

  container.addEventListener('click', async function (e) {
    const button = e.target.closest('button[data-action]');
    if (!button) return;

    const item = button.closest('.credly-found-item');
    const badgeId = item.getAttribute('data-badge-id');
    const action = button.getAttribute('data-action');
    const endpoint = action === 'add'
      ? `/candidate/${slug}/edit/add-credly-badge`
      : `/candidate/${slug}/edit/dismiss-credly-badge`;

    // Disable both buttons in this row while the request is in flight, so
    // a candidate can't double-click and fire two conflicting requests.
    const rowButtons = item.querySelectorAll('button');
    rowButtons.forEach((b) => { b.disabled = true; });

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ badgeId }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || 'Something went wrong. Please try again.');
        rowButtons.forEach((b) => { b.disabled = false; });
        return;
      }

      // Either way — added or dismissed — this badge is resolved, so
      // remove its row from view without a full page reload.
      item.remove();

      // If that was the last pending badge, remove the whole box.
      if (container.children.length === 0) {
        const box = document.getElementById('credly-found-box');
        if (box) box.remove();
      }

      // If a badge was just added, its data won't be reflected in the
      // certifications section below (which is rendered from
      // window.PRECHECKD_CANDIDATE_DATA at page load) until the page is
      // refreshed. Simplest correct behavior: reload so the new
      // certification entry actually appears in the form.
      if (action === 'add') {
        window.location.reload();
      }
    } catch (error) {
      alert('Could not reach the server. Please try again.');
      rowButtons.forEach((b) => { b.disabled = false; });
    }
  });
})();