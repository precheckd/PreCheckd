(function () {
  const list = document.getElementById('conn-list');
  if (!list) return;

  const cards = Array.from(list.querySelectorAll('.conn-card'));
  const filterInput = document.getElementById('conn-filter-input');
  const noMatch = document.getElementById('conn-no-match');

  // Filter by name/company/email (precomputed in data-search) plus whatever
  // is currently typed in each card's note.
  function applyFilter() {
    const term = (filterInput.value || '').trim().toLowerCase();
    let visible = 0;

    cards.forEach((card) => {
      const haystack = (card.getAttribute('data-search') || '') + ' ' + card.querySelector('.conn-note-textarea').value.toLowerCase();
      const show = term === '' || haystack.includes(term);
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });

    noMatch.style.display = visible === 0 ? 'block' : 'none';
  }

  if (filterInput) filterInput.addEventListener('input', applyFilter);

  cards.forEach((card) => {
    const key = card.getAttribute('data-key');
    const textarea = card.querySelector('.conn-note-textarea');
    const status = card.querySelector('.conn-note-status');
    const unsaveBtn = card.querySelector('[data-unsave]');

    let debounceTimer = null;
    let hideTimer = null;

    function showStatus(text, isError) {
      status.textContent = text;
      status.classList.toggle('error', Boolean(isError));
      status.classList.add('visible');
      clearTimeout(hideTimer);
      if (!isError) {
        hideTimer = setTimeout(() => status.classList.remove('visible'), 1500);
      }
    }

    async function saveNote() {
      try {
        const response = await fetch('/connections/note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, note: textarea.value }),
        });
        if (response.ok) {
          showStatus('Saved', false);
        } else {
          showStatus('Could not save — try again', true);
        }
      } catch (error) {
        showStatus('Could not save — try again', true);
      }
    }

    textarea.addEventListener('input', () => {
      status.classList.remove('visible');
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(saveNote, 800);
    });

    // Don't lose a note typed just before leaving the field or the page.
    textarea.addEventListener('blur', () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
        saveNote();
      }
    });

    if (unsaveBtn) {
      unsaveBtn.addEventListener('click', async () => {
        if (!confirm('Remove this recruiter from your saved list?')) return;

        unsaveBtn.disabled = true;
        try {
          const response = await fetch('/api/saved-recruiters/unsave', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recruiterSlug: unsaveBtn.getAttribute('data-unsave') }),
          });

          if (!response.ok) {
            unsaveBtn.disabled = false;
            return;
          }

          if (unsaveBtn.getAttribute('data-still-connected') === 'true') {
            // Still a connection — keep the entry, just drop the saved bits.
            const badge = card.querySelector('[data-saved-badge]');
            if (badge) badge.remove();
            unsaveBtn.remove();
          } else {
            card.remove();
            cards.splice(cards.indexOf(card), 1);
            if (cards.length === 0) window.location.reload();
          }
        } catch (error) {
          unsaveBtn.disabled = false;
        }
      });
    }
  });
})();
