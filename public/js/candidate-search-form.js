(function () {
  const form = document.getElementById('candidate-search-form');
  if (!form) return;

  const locationInput = document.getElementById('filter-location');
  const latInput = document.getElementById('filter-lat');
  const lngInput = document.getElementById('filter-lng');
  const daysInput = document.getElementById('filter-avail-days');
  const startInput = document.getElementById('filter-avail-start');
  const endInput = document.getElementById('filter-avail-end');
  const budgetAmount = document.getElementById('filter-budget-amount');
  const budgetType = document.getElementById('filter-budget-type');
  const submitBtn = document.getElementById('filter-submit');
  const errorEl = document.getElementById('filter-error');

  function showError(message) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }

  function clearError() {
    errorEl.classList.add('hidden');
  }

  function setBusy(busy) {
    submitBtn.disabled = busy;
    submitBtn.textContent = busy ? 'Searching...' : 'Search Candidates';
  }

  // Looks up the typed location only when it's new or changed — an
  // unchanged location reuses the lat/lng already in the hidden fields.
  async function geocodeLocation(query) {
    // A bare US zip code (12345 or 12345-6789) geocodes unreliably as
    // free text, so it goes through Nominatim's dedicated postalcode lookup.
    const zipMatch = query.match(/^(\d{5})(?:-\d{4})?$/);
    const searchParams = zipMatch
      ? `postalcode=${zipMatch[1]}&countrycodes=us`
      : `q=${encodeURIComponent(query)}`;
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&${searchParams}`, {
      headers: { 'Accept': 'application/json' },
    });
    const results = await res.json();
    if (!results || results.length === 0) return null;
    return { lat: results[0].lat, lng: results[0].lon };
  }

  let submitting = false;

  form.addEventListener('submit', async (e) => {
    if (submitting) return; // second pass, after geocoding — let it through
    e.preventDefault();
    clearError();

    const checkedDays = Array.from(form.querySelectorAll('.filter-day:checked')).map((el) => el.value);
    const hasAnyAvailability = checkedDays.length > 0 || startInput.value || endInput.value;
    if (hasAnyAvailability && (checkedDays.length === 0 || !startInput.value || !endInput.value)) {
      showError('For required hours, pick at least one day and both a start and end time — or clear them.');
      return;
    }
    daysInput.value = checkedDays.join(',');

    const locationText = locationInput.value.trim();
    if (!locationText) {
      latInput.value = '';
      lngInput.value = '';
    } else if (!latInput.value || locationText !== (locationInput.dataset.geocodedLabel || '')) {
      setBusy(true);
      try {
        const point = await geocodeLocation(locationText);
        if (!point) {
          showError("Couldn't find that location. Try a different city or address.");
          setBusy(false);
          return;
        }
        latInput.value = point.lat;
        lngInput.value = point.lng;
      } catch (err) {
        showError('Location lookup failed. Try again.');
        setBusy(false);
        return;
      }
    }

    // Keep the URL tidy: don't send fields that were left blank.
    if (!budgetAmount.value) budgetType.disabled = true;
    [budgetAmount, startInput, endInput, daysInput, locationInput, latInput, lngInput].forEach((el) => {
      if (!el.value) el.disabled = true;
    });
    const arrangement = document.getElementById('filter-arrangement');
    if (!arrangement.value) arrangement.disabled = true;
    const keywordInput = form.querySelector('input[name="q"]');
    if (!keywordInput.value.trim()) keywordInput.disabled = true;

    submitting = true;
    form.submit();
  });

  // Back/forward cache can restore the page with the button stuck busy
  // and fields disabled — reset both.
  window.addEventListener('pageshow', () => {
    submitting = false;
    setBusy(false);
    Array.from(form.elements).forEach((el) => { el.disabled = false; });
  });
})();
