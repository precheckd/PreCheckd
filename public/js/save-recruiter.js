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
      // If the check fails, leave the button in its default "Save" state —
      // worst case, a candidate who'd already saved this recruiter sees
      // "Save" instead of "Saved" until they refresh; not worth an error UI.
    });

  button.addEventListener('click', async function () {
    const currentlySaved = button.classList.contains('is-saved');
    const endpoint = currentlySaved ? '/api/saved-recruiters/unsave' : '/api/saved-recruiters/save';

    button.disabled = true;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recruiterSlug: slug }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || 'Something went wrong. Please try again.');
        return;
      }

      setSavedState(data.saved);
    } catch (error) {
      alert('Could not reach the server. Please try again.');
    } finally {
      button.disabled = false;
    }
  });
})();