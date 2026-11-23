// Suggests schools from the directory while someone types in a School box (any input with class "edu-school").
// Picking one means the exact directory name is saved, which is how a verification request finds the registrar.
(function () {
  var list = document.createElement('datalist');
  list.id = 'school-options';
  document.body.appendChild(list);
  var timer = null;
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el || !el.classList || !el.classList.contains('edu-school')) return;
    el.setAttribute('list', 'school-options');
    var q = el.value.trim();
    clearTimeout(timer);
    if (q.length < 2) return;
    timer = setTimeout(function () {
      fetch('/api/schools?q=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (d) {
        list.innerHTML = '';
        (d.schools || []).forEach(function (s) { var o = document.createElement('option'); o.value = s.name; list.appendChild(o); });
      }).catch(function () {});
    }, 200);
  });
})();
