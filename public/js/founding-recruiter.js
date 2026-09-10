(function () {
  const signupForm = document.getElementById('signup-form');
  const phoneForm = document.getElementById('phone-form');
  const checkoutButton = document.getElementById('checkout-button');
  const errorEl = document.getElementById('form-error');

  let recruiterId = null;
  let stripeSessionId = null;
  let stripeClientSecret = null;
  let stripe = null;

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

  function initStripe() {
    if (!stripe) {
      stripe = Stripe('pk_live_E1pK6AiEqLaRjlb8MhJ0ixud8p6sH8Dkqwu4a0L7PqJ9oO0rK');
    }
  }

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    try {
      const formData = Object.fromEntries(new FormData(signupForm).entries());
      const response = await postJson('/api/founding-recruiter/signup', formData);
      recruiterId = response.recruiterId;
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
      await postJson('/api/founding-recruiter/verify-phone', { code });
      showStep('step-payment');
      await prepareIdentitySession();
    } catch (err) {
      showError(err.message);
    }
  });

  async function prepareIdentitySession() {
    try {
      initStripe();
      const sessionResponse = await postJson('/api/founding-recruiter/create-identity-session', {});
      stripeSessionId = sessionResponse.sessionId;
      stripeClientSecret = sessionResponse.clientSecret;
    } catch (err) {
      showError(err.message);
    }
  }

  checkoutButton.addEventListener('click', async () => {
    if (!stripeClientSecret) {
      showError('Verification session not ready. Please refresh and try again.');
      return;
    }

    hideError();
    checkoutButton.disabled = true;
    checkoutButton.textContent = 'Opening verification...';

    try {
      const result = await stripe.verifyIdentity(stripeClientSecret);

      checkoutButton.disabled = false;
      checkoutButton.textContent = 'Complete verification';

      if (result.error) {
        showError(result.error.message || 'Verification was not completed.');
        return;
      }

      // Verification modal closed successfully; confirm status with backend
      const response = await postJson('/api/founding-recruiter/verify-identity-session', {
        sessionId: stripeSessionId,
      });

      if (response.success) {
        window.location.href = `/recruiter/${response.recruiter.slug}`;
      } else {
        showError(response.message || 'Verification is still processing. Please check back shortly.');
      }
    } catch (err) {
      checkoutButton.disabled = false;
      checkoutButton.textContent = 'Complete verification';
      showError(err.message || 'An error occurred during verification');
    }
  });
})();