(function () {
  const container = document.getElementById('saved-list-container');
  if (!container) return;

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function renderCard(item) {
    const r = item.recruiter;
    const initials = `${r.firstName.charAt(0)}${r.lastName.charAt(0)}`.toUpperCase();
    const savedDate = new Date(item.savedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

    const photoHtml = r.profilePhotoUrl
      ? `<div class="saved-photo"><img src="${r.profilePhotoUrl}" alt=""></div>`
      : `<div class="saved-avatar-placeholder">${initials}</div>`;

    return `
      <div class="saved-card" data-recruiter-slug="${r.slug}">
        <div class="saved-card-top">
          <div class="saved-name-group">
            ${photoHtml}
            <div>
              <div class="saved-name"><a href="/recruiter/${r.slug}">${escapeHtml(r.firstName)} ${escapeHtml(r.lastName)}</a></div>
              ${r.company ? `<div class="saved-company">${escapeHtml(r.company)}</div>` : ''}
            </div>
          </div>
          <div class="saved-date">Saved ${savedDate}</div>
        </div>

        <label class="saved-note-label">Your Note</label>
        <textarea class="saved-note-textarea" placeholder="Why did you save this recruiter?">${escapeHtml(item.note || '')}</textarea>

        <div class="saved-card-actions">
          <span class="saved-note-status">Saved</span>
          <button type="button" class="saved-unsave-btn">Remove</button>
        </div>
      </div>
    `;
  }

  async function loadList() {
    try {
      const response = await fetch('/api/saved-recruiters/list');
      const data = await response.json();

      if (!response.ok) {
        container.innerHTML = `<div class="empty-state">${data.error || 'Something went wrong loading your saved recruiters.'}</div>`;
        return;
      }

      if (!data.savedRecruiters || data.savedRecruiters.length === 0) {
        container.innerHTML = '<div class="empty-state">You haven\'t saved any recruiters yet. <a href="/recruiter-search">Browse recruiters</a> to get started.</div>';
        return;
      }

      container.innerHTML = `<div class="saved-list">${data.savedRecruiters.map(renderCard).join('')}</div>`;
      attachHandlers();
    } catch (error) {
      container.innerHTML = '<div class="empty-state">Could not load your saved recruiters. Please refresh the page.</div>';
    }
  }

  function attachHandlers() {
    container.querySelectorAll('.saved-card').forEach((card) => {
      const slug = card.getAttribute('data-recruiter-slug');
      const textarea = card.querySelector('.saved-note-textarea');
      const status = card.querySelector('.saved-note-status');
      const unsaveBtn = card.querySelector('.saved-unsave-btn');

      let debounceTimer = null;

      textarea.addEventListener('input', () => {
        status.classList.remove('visible');
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          try {
            const response = await fetch('/api/saved-recruiters/update-note', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ recruiterSlug: slug, note: textarea.value }),
            });
            if (response.ok) {
              status.classList.add('visible');
              setTimeout(() => status.classList.remove('visible'), 1500);
            }
          } catch (error) {
            // Silent failure on autosave — the candidate can just retype
            // if needed; not worth an intrusive error for a note field.
          }
        }, 800);
      });

      unsaveBtn.addEventListener('click', async () => {
        if (!confirm('Remove this recruiter from your saved list?')) return;

        unsaveBtn.disabled = true;
        try {
          const response = await fetch('/api/saved-recruiters/unsave', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recruiterSlug: slug }),
          });
          if (response.ok) {
            card.remove();
            if (container.querySelectorAll('.saved-card').length === 0) {
              loadList();
            }
          } else {
            unsaveBtn.disabled = false;
          }
        } catch (error) {
          unsaveBtn.disabled = false;
        }
      });
    });
  }

  loadList();
})();