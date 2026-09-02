(function () {
  const signupForm = document.getElementById('signup-form');
  const phoneForm = document.getElementById('phone-form');
  const checkoutButton = document.getElementById('checkout-button');
  const errorEl = document.getElementById('form-error');

  let recruiterId = null;

  function showStep(id) {
    document.querySelectorAll('.form-step').forEach((el) => (el.hidden = true));
    document.getElementById(id).hidden = false;
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
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
    errorEl.hidden = true;
    try {
      const formData = Object.fromEntries(new FormData(signupForm).entries());
      const { recruiterId: id } = await postJson('/founding-recruiter', formData);
      recruiterId = id;
      await postJson('/founding-recruiter/sms/send-code', { recruiterId });
      showStep('step-phone');
    } catch (err) {
      showError(err.message);
    }
  });

  phoneForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    try {
      const code = new FormData(phoneForm).get('code');
      await postJson('/founding-recruiter/sms/verify-code', { recruiterId, code });
      showStep('step-payment');
    } catch (err) {
      showError(err.message);
    }
  });

  checkoutButton.addEventListener('click', async () => {
    errorEl.hidden = true;
    try {
      const { url } = await postJson('/founding-recruiter/payment/checkout', { recruiterId });
      window.location.href = url;
    } catch (err) {
      showError(err.message);
    }
  });
})();
