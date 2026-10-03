(function () {
  const form = document.getElementById('candidate-location-form');
  if (!form) return;

  const input = document.getElementById('candidate-location-input');
  const btn = document.getElementById('candidate-location-btn');
  const clearBtn = document.getElementById('candidate-location-clear');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;

    btn.disabled = true;
    btn.textContent = 'Searching...';

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`, {
        headers: { 'Accept': 'application/json' },
      });
      const results = await res.json();

      if (results && results.length > 0) {
        const { lat, lon, display_name } = results[0];
        const url = new URL(window.location.href);
        url.searchParams.set('lat', lat);
        url.searchParams.set('lng', lon);
        url.searchParams.set('label', display_name || query);
        window.location.href = url.toString();
      } else {
        btn.disabled = false;
        btn.textContent = 'Set Location';
        alert("Couldn't find that location. Try a different search.");
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Set Location';
      alert('Location search failed. Try again.');
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('lat');
      url.searchParams.delete('lng');
      url.searchParams.delete('label');
      window.location.href = url.toString();
    });
  }
})();
