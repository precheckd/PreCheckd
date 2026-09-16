(function () {
  const searchForm = document.getElementById('recruiter-search-form');
  const searchInput = document.getElementById('recruiter-search-input');
  const promptState = document.getElementById('prompt-state');
  const emptyState = document.getElementById('empty-state');
  const grid = document.getElementById('recruiter-grid');

  if (!searchForm) return;

  const cards = document.querySelectorAll('.recruiter-card');

  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const query = searchInput.value.trim().toLowerCase();

    if (query === '') {
      promptState.classList.remove('hidden');
      emptyState.classList.add('hidden');
      grid.classList.add('hidden');
      return;
    }

    let visibleCount = 0;

    cards.forEach((card) => {
      const searchable = card.getAttribute('data-search') || '';
      if (searchable.includes(query)) {
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
  });
})();