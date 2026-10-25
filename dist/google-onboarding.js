/** @module google-onboarding
 * Google login, code-gated registration, and explicit account linking.
 */
(() => {
  'use strict';

  const root = document.querySelector('[data-google-onboarding]');
  if (!root) return;

  const mode = root.dataset.googleOnboarding;
  const /** Find an authentication interface element by its stable ID. */ find = id => document.getElementById(id);
  const errorMessage = find(mode === 'login' ? 'auth-error' : 'google-onboarding-error');
  const status = find('google-onboarding-status');
  let credential = null;
  let busy = false;

  if (mode === 'signup' && window.location.search === '?google=1') {
    find('auth-form').hidden = true;
  }

  /** Preserve server routing errors while keeping transport failures readable. */
  async function request(path, body, csrf) {
    let response;
    let data;
    try {
      response = await fetch(path, {
        credentials: 'same-origin',
        cache: 'no-store',
        method: body ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...(csrf ? {'X-CSRF-Token': csrf} : {})
        },
        ...(body ? {body: JSON.stringify(body)} : {})
      });
      data = await response.json();
    } catch {
      throw Error('Unable to connect to Predict60. Please try again.');
    }
    if (!response.ok) {
      throw Object.assign(Error(data.error || 'Unable to continue with Google.'), {
        code: data.code,
        status: response.status
      });
    }
    return data;
  }

  /** Obtain a fresh login CSRF cookie before submitting Google credentials. */
  async function googleRequest(path, body) {
    const {csrf} = await request('/api/auth/google/csrf');
    if (!csrf) throw Error('Unable to start Google sign-in.');
    return request(path, body, csrf);
  }

  /** Display an authentication error and offer password login when required. */
  function showError(error) {
    errorMessage.textContent = error.message;
    status.textContent = '';
    if (mode !== 'login' && (error.code === 'LINK_REQUIRED' || (mode === 'link' && error.status === 401))) {
      find('google-link-login').hidden = false;
    }
  }

  /** Retain the credential in memory while collecting the organizer code. */
  function showSignup(selectedCredential) {
    credential = selectedCredential;
    find('auth-form').hidden = true;
    find('google-signup-form').hidden = false;
    status.textContent = 'Google account selected. Enter your name and organizer signup code to create your account.';
    find('google-name').focus();
  }

  /** Sign in returning users or route them to registration or account linking. */
  async function signIn(selectedCredential) {
    try {
      const data = await googleRequest('/api/auth/google', {credential: selectedCredential});
      window.location.assign(data.redirect || '/categories.html');
    } catch (error) {
      if (error.code === 'SIGNUP_REQUIRED') {
        if (mode === 'signup') showSignup(selectedCredential);
        else window.location.assign('/signup.html?google=1');
      } else if (error.code === 'LINK_REQUIRED' && mode === 'login') {
        window.location.assign('/login.html?google=link');
      } else {
        throw error;
      }
    }
  }

  /** Explicitly associate Google with the current authenticated account. */
  async function linkAccount(selectedCredential) {
    // Fetch the current account CSRF token after any prior session rotation.
    const account = await request('/api/account');
    await request('/api/auth/google/link', {credential: selectedCredential}, account.csrf);
    status.textContent = 'Google account linked. Your credits and history are unchanged.';
  }

  if (mode === 'link') {
    request('/api/account').then(account => {
      find('google-account-email').textContent = `Signed in as ${account.user.email}`;
    }).catch(showError);
  }

  window.handleGoogleOnboarding = /** Handle Google account selection while preventing concurrent submissions. */ async response => {
    if (busy) return;
    busy = true;
    credential = null;
    if (mode === 'signup') find('google-signup-form').hidden = true;
    if (mode !== 'login') find('google-link-login').hidden = true;
    errorMessage.textContent = '';
    status.textContent = mode === 'link' ? 'Linking your Google account…' : 'Checking your Google account…';
    try {
      if (mode === 'link') await linkAccount(response.credential);
      else await signIn(response.credential);
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
    }
  };

  if (mode === 'signup') {
    find('google-signup-form').addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      if (!credential) {
        showError(Error('Choose your Google account again before continuing.'));
        return;
      }
      busy = true;
      const button = event.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true;
      errorMessage.textContent = '';
      try {
        const data = await googleRequest('/api/auth/google/signup', {
          credential,
          name: find('google-name').value,
          signupCode: find('google-signup-code').value
        });
        credential = null;
        find('google-signup-code').value = '';
        window.location.assign(data.redirect || '/categories.html');
      } catch (error) {
        showError(error);
      } finally {
        busy = false;
        button.disabled = false;
      }
    });
  }
})();
