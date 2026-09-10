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
    console.error('showError called:', message);
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
      console.log('Initializing Stripe...');
      stripe = Stripe('pk_live_E1pK6AiEqLaRjlb8MhJ0ixud8p6sH8Dkqwu4a0L7PqJ9oO0rK');
      console.log('Stripe initialized:', stripe);
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
      setupStripeIdentity();
    } catch (err) {
      showError(err.message);
    }
  });

  async function setupStripeIdentity() {
    console.log('setupStripeIdentity called');
    try {
      initStripe();

      console.log('Requesting identity session...');
      const sessionResponse = await postJson('/api/founding-recruiter/create-identity-session', {});
      console.log('Session response:', sessionResponse);
      stripeSessionId = sessionResponse.sessionId;
      const clientSecret = sessionResponse.clientSecret;

      console.log('Creating elements with clientSecret:', clientSecret);
      const elements = stripe.elements({ clientSecret });
      console.log('Elements created:', elements);

      identityElement = elements.create('identityDocument');
      console.log('identityDocument element created:', identityElement);

      identityElement.mount('#stripe-element');
      console.log('identityElement.mount() called');

      identityElement.on('loaderror', (event) => {
        console.error('loaderror event:', event);
        showError('Failed to load verification form. Please try again.');
      });

      identityElement.on('ready', () => {
        console.log('identityElement ready event fired');
      });
    } catch (err) {
      console.error('setupStripeIdentity error:', err);
      showError(err.message);
    }
  }

  checkoutButton.addEventListener('click', async () => {
    console.log('checkoutButton clicked, identityElement is:', identityElement);
    if (!identityElement) {
      showError('Verification form not loaded. Please refresh and try again.');
      return;
    }

    hideError();
    checkoutButton.disabled = true;
    checkoutButton.textContent = 'Verifying...';

    try {
      const result = await identityElement.submit();
      console.log('identityElement.submit() result:', result);

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
      console.error('checkoutButton click error:', err);
      showError(err.message || 'An error occurred during verification');
      checkoutButton.disabled = false;
      checkoutButton.textContent = 'Complete verification';
    }
  });
})();