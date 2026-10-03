(function () {
  const mapEl = document.getElementById('wa-map');
  if (!mapEl) return;

  const saveUrl = window.PRECHECKD_WORK_AREAS_SAVE_URL;
  const existing = window.PRECHECKD_EXISTING_WORK_AREAS;
  const statusEl = document.getElementById('wa-status');
  const citySearchInput = document.getElementById('wa-city-search');
  const citySearchBtn = document.getElementById('wa-city-search-btn');
  const saveBtn = document.getElementById('wa-save-btn');
  const clearBtn = document.getElementById('wa-clear-btn');

  // Default view: continental US, zoomed out. Re-centered on load if the
  // candidate already has saved shapes, or whenever they search a city.
  const map = L.map('wa-map').setView([39.8283, -98.5795], 4);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map);

  const drawnItems = new L.FeatureGroup();
  map.addLayer(drawnItems);

  const drawControl = new L.Control.Draw({
    draw: {
      polygon: {
        allowIntersection: true,
        showArea: false,
      },
      polyline: false,
      rectangle: false,
      circle: false,
      marker: false,
      circlemarker: false,
    },
    edit: {
      featureGroup: drawnItems,
    },
  });
  map.addControl(drawControl);

  // Rehydrate any previously-saved MultiPolygon. GeoJSON order is
  // [lng, lat]; Leaflet wants [lat, lng].
  if (existing && existing.coordinates && existing.coordinates.length > 0) {
    existing.coordinates.forEach((polygon) => {
      // polygon[0] is the outer ring; we don't support holes in the UI.
      const outerRing = polygon[0] || [];
      const latlngs = outerRing.map((pt) => [pt[1], pt[0]]);
      if (latlngs.length >= 3) {
        const layer = L.polygon(latlngs);
        drawnItems.addLayer(layer);
      }
    });

    try {
      map.fitBounds(drawnItems.getBounds(), { padding: [30, 30] });
    } catch (e) {
      // getBounds() can throw if a layer's bounds are degenerate — fall
      // back to the default view rather than breaking the page.
    }
  }

  map.on(L.Draw.Event.CREATED, (e) => {
    drawnItems.addLayer(e.layer);
  });

  function showStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.className = 'wa-status' + (isError ? ' error' : '');
    statusEl.classList.remove('hidden');
  }

  function layersToMultiPolygonCoordinates() {
    const coordinates = [];
    drawnItems.eachLayer((layer) => {
      if (!layer.getLatLngs) return;
      const rings = layer.getLatLngs(); // array of rings for a polygon
      const polygonRings = rings.map((ring) => {
        const points = ring.map((latlng) => [latlng.lng, latlng.lat]);
        // Close the ring if Leaflet didn't already repeat the first point.
        if (points.length > 0) {
          const first = points[0];
          const last = points[points.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) {
            points.push([first[0], first[1]]);
          }
        }
        return points;
      });
      coordinates.push(polygonRings);
    });
    return coordinates;
  }

  saveBtn.addEventListener('click', async () => {
    const coordinates = layersToMultiPolygonCoordinates();

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      const res = await fetch(saveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coordinates }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        showStatus(coordinates.length === 0 ? 'Cleared — no work areas saved.' : 'Saved.', false);
      } else {
        showStatus(data.error || 'Something went wrong. Please try again.', true);
      }
    } catch (err) {
      showStatus('Something went wrong. Please try again.', true);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Work Areas';
    }
  });

  clearBtn.addEventListener('click', () => {
    drawnItems.clearLayers();
    showStatus('Shapes cleared from the map — click "Save Work Areas" to make this permanent.', false);
  });

  citySearchBtn.addEventListener('click', async () => {
    const query = citySearchInput.value.trim();
    if (!query) return;

    citySearchBtn.disabled = true;
    citySearchBtn.textContent = '...';

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`, {
        headers: { 'Accept': 'application/json' },
      });
      const results = await res.json();

      if (results && results.length > 0) {
        const { lat, lon } = results[0];
        map.setView([parseFloat(lat), parseFloat(lon)], 11);
      } else {
        showStatus('Couldn\'t find that location. Try a different search.', true);
      }
    } catch (err) {
      showStatus('Location search failed. Try again.', true);
    } finally {
      citySearchBtn.disabled = false;
      citySearchBtn.textContent = 'Go';
    }
  });

  citySearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      citySearchBtn.click();
    }
  });
})();
