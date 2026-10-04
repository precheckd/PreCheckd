(function () {
  const form = document.getElementById('candidate-arrangement-form');
  if (!form) return;

  const select = document.getElementById('candidate-arrangement-select');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = new URL(window.location.href);

    if (select.value) {
      url.searchParams.set('workArrangement', select.value);
    } else {
      url.searchParams.delete('workArrangement');
    }

    window.location.href = url.toString();
  });
})();
