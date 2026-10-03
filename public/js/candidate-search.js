(function () {
  const searchForm = document.getElementById('candidate-search-form');
  const searchInput = document.getElementById('candidate-search-input');
  const promptState = document.getElementById('prompt-state');
  const emptyState = document.getElementById('empty-state');
  const grid = document.getElementById('candidate-grid');

  if (!searchForm) return;

  const cards = document.querySelectorAll('.candidate-card');

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
  // A location pin (filtered server-side already) should also show
  // results immediately rather than waiting on a text query — the pin
  // itself is the filter in that case.
  const prefilled = window.PRECHECKD_PREFILLED_QUERY || '';
  const hasLocationPin = window.PRECHECKD_HAS_LOCATION_PIN || false;

  if (prefilled.trim() !== '') {
    runSearch(prefilled);
  } else if (hasLocationPin) {
    promptState.classList.add('hidden');
    emptyState.classList.toggle('hidden', cards.length > 0);
    grid.classList.toggle('hidden', cards.length === 0);
  } else {
    promptState.classList.remove('hidden');
  }
})();
