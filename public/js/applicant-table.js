// Click a column heading to sort the applicants table; click again to reverse. Rows with no value sort last.
(function () {
  var table = document.getElementById('ja-table');
  if (!table) return;
  var body = table.tBodies[0];
  var heads = table.tHead.rows[0].cells;
  var state = { col: -1, dir: 1 };
  Array.prototype.forEach.call(heads, function (th, i) {
    if (!th.getAttribute('data-sort')) return;
    th.addEventListener('click', function () {
      var num = th.getAttribute('data-sort') === 'num';
      state.dir = state.col === i ? -state.dir : (num ? -1 : 1);   // numbers start high-to-low, text A-Z
      state.col = i;
      var rows = Array.prototype.slice.call(body.rows);
      function val(r) { var v = r.cells[i].getAttribute('data-v'); return v === null || v === '' ? null : (num ? Number(v) : v); }
      rows.sort(function (a, b) {
        var x = val(a), y = val(b);
        if (x === null && y === null) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * state.dir;
      });
      rows.forEach(function (r) { body.appendChild(r); });
      Array.prototype.forEach.call(heads, function (h, j) { var ar = h.querySelector('.ja-arrow'); if (ar) ar.textContent = j === i ? (state.dir === 1 ? '\u25B2' : '\u25BC') : ''; });
    });
  });
})();
