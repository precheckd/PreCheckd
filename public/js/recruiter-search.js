(function () {
  const searchForm = document.getElementById('recruiter-search-form');
  const searchInput = document.getElementById('recruiter-search-input');
  const promptState = document.getElementById('prompt-state');
  const emptyState = document.getElementById('empty-state');
  const grid = document.getElementById('recruiter-grid');

  if (!searchForm) return;

  const cards = document.querySelectorAll('.recruiter-card');

  function runSearch(query) {
    const trimmed = query.trim().toLowerCase();

    if (trimmed === '') {
      promptState.classList.remove('hidden');
      emptyState.classList.add('hidden');
      grid.classList.add('hidden');
      return;
    }

    let visibleCount = 0;

    cards.forEach((card) => {
      const searchable = card.getAttribute('data-search') || '';
      if (searchable.includes(trimmed)) {
        card.classList.remove('hidden');
        visibleCount++;
      } else {
        card.classList.add('hidden');
      }
    });

    promptState.classList.add('hidden');

    if (visibleCount === 0) {
      emptyState.classList.remove('hidden');
      grid.classList.add('hidden');
    } else {
      emptyState.classList.add('hidden');
      grid.classList.remove('hidden');
    }
  }

  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    runSearch(searchInput.value);
  });

  // If a query was pre-filled (e.g. arriving from the command center's
  // search widget via ?q=...), run the search automatically on load.
  const prefilled = window.PRECHECKD_PREFILLED_QUERY || '';
  if (prefilled.trim() !== '') {
    runSearch(prefilled);
  } else {
    promptState.classList.remove('hidden');
  }
})();