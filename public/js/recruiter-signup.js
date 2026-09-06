// Recruiter Signup Flow - Step 1, 2, 3

let currentStep = 1;
let phoneNumber = '';

// Step 1: Form Submission
document.getElementById('recruiter-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const firstName = document.querySelector('input[name="firstName"]')?.value;
  const lastName = document.querySelector('input[name="lastName"]')?.value;
  const email = document.querySelector('input[name="email"]')?.value;
  const phone = document.querySelector('input[name="phone"]')?.value;
  const company = document.querySelector('input[name="company"]')?.value;

  if (!firstName || !lastName || !email || !phone) {
    alert('Please fill in all required fields');
    return;
  }

  phoneNumber = phone;

  try {
    const response = await fetch('/api/founding-recruiter/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        firstName,
        lastName,
        email,
        phone,
        company
      })
    });

    const result = await response.json();

    if (result.success) {
      // Move to Step 2: Phone Verification
      currentStep = 2;
      document.querySelector('.step-1')?.style.display = 'none';
      document.querySelector('.step-2')?.style.display = 'block';
      updateProgressBar(67);
    } else {
      alert(result.error || 'Signup failed');
    }
  } catch (error) {
    console.error('Error during signup:', error);
    alert('An error occurred during signup');
  }
});

// Step 2: Verify Phone Code
document.getElementById('verify-code-btn')?.addEventListener('click', async () => {
  const code = document.querySelector('input[name="verificationCode"]')?.value;

  if (!code) {
    alert('Please enter the verification code');
    return;
  }

  try {
    const response = await fetch('/api/founding-recruiter/verify-phone', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ code })
    });

    const result = await response.json();

    if (result.success) {
      // Move to Step 3: Identity Verification
      currentStep = 3;
      document.querySelector('.step-2')?.style.display = 'none';
      document.querySelector('.step-3')?.style.display = 'block';
      updateProgressBar(100);
    } else {
      alert(result.message || 'Invalid verification code');
    }
  } catch (error) {
    console.error('Error verifying code:', error);
    alert('An error occurred');
  }
});

// Step 2: Resend Code
document.getElementById('resend-code-btn')?.addEventListener('click', async () => {
  try {
    const response = await fetch('/api/founding-recruiter/resend-code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();

    if (result.success) {
      alert(result.message);
    } else {
      alert(result.error || 'Failed to resend code');
    }
  } catch (error) {
    console.error('Error resending code:', error);
    alert('An error occurred');
  }
});

// Step 3: Complete Verification
document.getElementById('complete-verification-btn')?.addEventListener('click', async () => {
  try {
    const response = await fetch('/api/founding-recruiter/create-identity-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();

    if (result.success) {
      alert('Congratulations! Your profile is verified.');
      // Redirect or show success message
      window.location.href = `/recruiter/${result.recruiter.id}`;
    } else {
      alert(result.error || 'Verification failed');
    }
  } catch (error) {
    console.error('Error completing verification:', error);
    alert('An error occurred');
  }
});

// Update progress bar
function updateProgressBar(percentage) {
  const progressBar = document.querySelector('.progress-bar');
  if (progressBar) {
    progressBar.style.width = percentage + '%';
  }
}