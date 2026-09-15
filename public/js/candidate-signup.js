(function () {
  const signupForm = document.getElementById('candidate-signup-form');
  const phoneForm = document.getElementById('candidate-phone-form');
  const errorEl = document.getElementById('form-error');

  function showStep(id) {
    document.querySelectorAll('.form-step').forEach((el) => el.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }

  function hideError() {
    errorEl.classList.add('hidden');
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error((data.error || (data.errors && data.errors[0].msg)) || 'Something went wrong');
    }
    return data;
  }

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const formData = Object.fromEntries(new FormData(signupForm).entries());

    try {
      await postJson('/api/candidate/signup', formData);
      showStep('step-phone');
    } catch (err) {
      showError(err.message);
    }
  });

  phoneForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    try {
      const code = new FormData(phoneForm).get('code');
      await postJson('/api/candidate/verify-phone', { code });
      showStep('step-done');
    } catch (err) {
      showError(err.message);
    }
  });
})();