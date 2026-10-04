(function () {
  const form = document.getElementById('candidate-availability-form');
  if (!form) return;

  const startInput = document.getElementById('candidate-avail-start');
  const endInput = document.getElementById('candidate-avail-end');
  const clearBtn = document.getElementById('candidate-availability-clear');

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const checkedDays = Array.from(form.querySelectorAll('input[name="availDay"]:checked')).map((el) => el.value);
    const start = startInput.value;
    const end = endInput.value;

    if (checkedDays.length === 0 || !start || !end) {
      alert('Pick at least one day and both a start and end time.');
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set('availDays', checkedDays.join(','));
    url.searchParams.set('availStart', start);
    url.searchParams.set('availEnd', end);
    window.location.href = url.toString();
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('availDays');
      url.searchParams.delete('availStart');
      url.searchParams.delete('availEnd');
      window.location.href = url.toString();
    });
  }
})();
