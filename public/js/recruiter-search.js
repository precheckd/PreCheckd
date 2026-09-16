(function () {
  const searchInput = document.getElementById('recruiter-search-input');
  if (!searchInput) return;

  const cards = document.querySelectorAll('.recruiter-card');

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase();

    cards.forEach((card) => {
      const searchable = card.getAttribute('data-search') || '';
      if (searchable.includes(query)) {
        card.classList.remove('hidden');
      } else {
        card.classList.add('hidden');
      }
    });
  });
})();