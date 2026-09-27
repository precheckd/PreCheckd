(function () {
  const button = document.getElementById('save-recruiter-btn');
  if (!button) return;

  const label = document.getElementById('save-recruiter-label');
  const slug = button.getAttribute('data-recruiter-slug');

  function setSavedState(isSaved) {
    button.classList.toggle('is-saved', isSaved);
    label.textContent = isSaved ? 'Saved' : 'Save';
  }

  // Check initial saved status on page load.
  fetch(`/api/saved-recruiters/status/${slug}`)
    .then((res) => res.json())
    .then((data) => setSavedState(Boolean(data.saved)))
    .catch(() => {
      // If the check fails, leave the button in its default "Save" state.
    });

  function promptForNote() {
    // Simple browser prompt — matches the lightweight, no-frills spirit of
    // this feature. A candidate can leave it blank and still save.
    return window.prompt('Why are you saving this recruiter? (optional)', '');
  }

  button.addEventListener('click', async function () {
    const currentlySaved = button.classList.contains('is-saved');

    button.disabled = true;

    try {
      if (currentlySaved) {
        const response = await fetch('/api/saved-recruiters/unsave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recruiterSlug: slug }),
        });
        const data = await response.json();
        if (!response.ok) {
          alert(data.error || 'Something went wrong. Please try again.');
          return;
        }
        setSavedState(false);
      } else {
        const note = promptForNote();
        // A null return means the candidate hit Cancel on the prompt —
        // respect that as "don't save at all," not "save with no note."
        if (note === null) {
          return;
        }

        const response = await fetch('/api/saved-recruiters/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recruiterSlug: slug, note }),
        });
        const data = await response.json();
        if (!response.ok) {
          alert(data.error || 'Something went wrong. Please try again.');
          return;
        }
        setSavedState(true);
      }
    } catch (error) {
      alert('Could not reach the server. Please try again.');
    } finally {
      button.disabled = false;
    }
  });
})();