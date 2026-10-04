(function () {
  const form = document.getElementById('candidate-budget-form');
  if (!form) return;

  const amountInput = document.getElementById('candidate-budget-amount');
  const typeSelect = document.getElementById('candidate-budget-type');
  const clearBtn = document.getElementById('candidate-budget-clear');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = amountInput.value.trim();
    if (!amount || Number(amount) <= 0) return;

    const url = new URL(window.location.href);
    url.searchParams.set('budgetAmount', amount);
    url.searchParams.set('budgetType', typeSelect.value);
    window.location.href = url.toString();
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('budgetAmount');
      url.searchParams.delete('budgetType');
      window.location.href = url.toString();
    });
  }
})();
