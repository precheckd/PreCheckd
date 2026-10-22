(function () {
  var el = document.getElementById('jl-map');
  var data = document.getElementById('jl-pins');
  if (!el || !data || typeof L === 'undefined') return;
  var pins = [];
  try { pins = JSON.parse(data.textContent); } catch (e) { pins = []; }
  var map = L.map(el).setView([39.5, -98.35], 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 14, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  var group = [];
  pins.forEach(function (p) {
    var c = L.circle([p.circle.lat, p.circle.lng], { radius: p.circle.radiusMiles * 1609.34, color: '#2ECC71', weight: 2, fillColor: '#2ECC71', fillOpacity: 0.18 }).addTo(map);
    var a = document.createElement('a');
    a.href = p.path; a.textContent = p.title;
    var box = document.createElement('div');
    box.appendChild(a); box.appendChild(document.createElement('br')); box.appendChild(document.createTextNode(p.company));
    c.bindPopup(box);
    group.push(c);
  });
  if (group.length) map.fitBounds(L.featureGroup(group).getBounds().pad(0.3), { maxZoom: 10 });
})();
