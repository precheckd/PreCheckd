(function () {
  const signupForm = document.getElementById('signup-form');
  const phoneForm = document.getElementById('phone-form');
  const checkoutButton = document.getElementById('checkout-button');
  const errorEl = document.getElementById('form-error');

  let recruiterId = null;
  let stripeSessionId = null;
  let stripe = null;
  let identityElement = null;

  function showStep(id) {
    document.querySelectorAll('.form-step').forEach((el) => el.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
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

  function initStripe() {
    if (!stripe) {
      stripe = Stripe('pk_live_E1pK6AiEqLaRjlb8MhJ0ixud8p6sH8Dkqwu4a0L7PqJ9oO0rK');
    }
  }

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
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
    errorEl.hidden = true;
    try {
      const code = new FormData(phoneForm).get('code');
      await postJson('/api/founding-recruiter/verify-phone', { code });
      showStep('step-payment');
      setupStripeIdentity();
    } catch (err) {
      showError(err.message);
    }
  });

  async function setupStripeIdentity() {
    try {
      initStripe();

      const sessionResponse = await postJson('/api/founding-recruiter/create-identity-session', {});
      stripeSessionId = sessionResponse.sessionId;
      const clientSecret = sessionResponse.clientSecret;

      const elements = stripe.elements({ clientSecret });
      identityElement = elements.create('identityDocument');
      identityElement.mount('#stripe-element');

      identityElement.on('loaderror', () => {
        showError('Failed to load verification form. Please try again.');
      });
    } catch (err) {
      showError(err.message);
    }
  }

  checkoutButton.addEventListener('click', async () => {
    if (!identityElement) {
      showError('Verification form not loaded. Please refresh and try again.');
      return;
    }

    errorEl.hidden = true;
    checkoutButton.disabled = true;
    checkoutButton.textContent = 'Verifying...';

    try {
      const result = await identityElement.submit();

      if (result.error) {
        showError(result.error.message || 'Verification failed');
        checkoutButton.disabled = false;
        checkoutButton.textContent = 'Complete verification';
        return;
      }

      const response = await postJson('/api/founding-recruiter/verify-identity-session', {
        sessionId: stripeSessionId,
      });

      if (response.success) {
        const firstName = response.recruiter.name.split(' ')[0];
        const lastName = response.recruiter.name.split(' ')[1];
        window.location.href = `/recruiter/${firstName}-${lastName}`;
      } else {
        showError(response.message || 'Verification failed');
        checkoutButton.disabled = false;
        checkoutButton.textContent = 'Complete verification';
      }
    } catch (err) {
      showError(err.message || 'An error occurred during verification');
      checkoutButton.disabled = false;
      checkoutButton.textContent = 'Complete verification';
    }
  });
})();