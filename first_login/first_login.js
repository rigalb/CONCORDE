/* ============================================================
   first_login.js — Première connexion élève
   Flux : envoi code → saisie code + nouveau MDP → succès
   Règles : 0 style= inline, 0 onclick= inline
   ============================================================ */

// --- Lecture de l'user_id depuis l'URL (?uid=xxx) ---
const urlParams = new URLSearchParams(window.location.search);
const userId    = parseInt(urlParams.get('uid'), 10);

// --- Références DOM ---
const stepSend    = document.getElementById('step-send');
const stepVerify  = document.getElementById('step-verify');
const stepSuccess = document.getElementById('step-success');

const sendError   = document.getElementById('send-error');
const verifyError = document.getElementById('verify-error');

const btnSendCode = document.getElementById('btn-send-code');
const btnVerify   = document.getElementById('btn-verify');
const btnResend   = document.getElementById('btn-resend');

const codeInput    = document.getElementById('code');
const passwordInput = document.getElementById('password');
const confirmInput  = document.getElementById('confirm-password');

// --- Utilitaires ---
function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideError(el) {
  el.textContent = '';
  el.classList.add('hidden');
}

function showStep(step) {
  stepSend.classList.add('hidden');
  stepVerify.classList.add('hidden');
  stepSuccess.classList.add('hidden');
  step.classList.remove('hidden');
}

function setLoading(btn, loading, originalText) {
  btn.disabled = loading;
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = 'Chargement…';
  } else {
    btn.textContent = originalText || btn.dataset.originalText || btn.textContent;
  }
}

// --- Validation au départ ---
if (!userId || isNaN(userId)) {
  stepSend.querySelector('h2').textContent = '⚠ Lien invalide';
  stepSend.querySelector('.subtitle').textContent =
    'Ce lien de première connexion est invalide. Contactez votre établissement.';
  btnSendCode.classList.add('hidden');
}

// --- Validation temps réel du code ---
codeInput.addEventListener('input', () => {
  hideError(verifyError);
  // Forcer chiffres uniquement
  codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
  if (codeInput.value.length === 6) {
    codeInput.classList.add('input-valid');
    codeInput.classList.remove('input-invalid');
  } else if (codeInput.value.length > 0) {
    codeInput.classList.remove('input-valid');
    codeInput.classList.add('input-invalid');
  } else {
    codeInput.classList.remove('input-valid', 'input-invalid');
  }
});

// --- Validation temps réel MDP ---
passwordInput.addEventListener('input', () => {
  hideError(verifyError);
  if (passwordInput.value.length > 0 && passwordInput.value.length < 8) {
    passwordInput.classList.add('input-invalid');
    passwordInput.classList.remove('input-valid');
  } else if (passwordInput.value.length >= 8) {
    passwordInput.classList.add('input-valid');
    passwordInput.classList.remove('input-invalid');
  } else {
    passwordInput.classList.remove('input-valid', 'input-invalid');
  }
  // Mettre à jour la confirmation si déjà remplie
  if (confirmInput.value.length > 0) confirmInput.dispatchEvent(new Event('input'));
});

confirmInput.addEventListener('input', () => {
  hideError(verifyError);
  if (confirmInput.value.length > 0) {
    if (confirmInput.value === passwordInput.value) {
      confirmInput.classList.add('input-valid');
      confirmInput.classList.remove('input-invalid');
    } else {
      confirmInput.classList.add('input-invalid');
      confirmInput.classList.remove('input-valid');
    }
  } else {
    confirmInput.classList.remove('input-valid', 'input-invalid');
  }
});

// --- Étape 1 : Envoyer le code ---
async function sendCode() {
  hideError(sendError);
  setLoading(btnSendCode, true);

  try {
    const res = await fetch('/api/first-login/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ user_id: userId })
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      showError(sendError, data.error || 'Erreur lors de l\'envoi.');
      setLoading(btnSendCode, false);
      return;
    }

    showStep(stepVerify);
    codeInput.focus();

  } catch (e) {
    showError(sendError, 'Erreur réseau. Vérifiez votre connexion.');
    setLoading(btnSendCode, false);
  }
}

// --- Étape 2 : Vérifier le code et changer le MDP ---
async function verifyCode() {
  hideError(verifyError);

  const code    = codeInput.value.trim();
  const pwd     = passwordInput.value;
  const confirm = confirmInput.value;

  if (code.length !== 6) {
    showError(verifyError, 'Le code doit contenir 6 chiffres.');
    codeInput.focus();
    return;
  }
  if (pwd.length < 8) {
    showError(verifyError, 'Le mot de passe doit contenir au moins 8 caractères.');
    passwordInput.focus();
    return;
  }
  if (pwd.length > 200) {
    showError(verifyError, 'Le mot de passe est trop long (max 200 caractères).');
    return;
  }
  if (pwd !== confirm) {
    showError(verifyError, 'Les mots de passe ne correspondent pas.');
    confirmInput.focus();
    return;
  }

  setLoading(btnVerify, true);

  try {
    const res = await fetch('/api/first-login/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        user_id:          userId,
        code:             code,
        password:         pwd,
        confirm_password: confirm
      })
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      showError(verifyError, data.error || 'Code ou mot de passe invalide.');
      setLoading(btnVerify, false);
      return;
    }

    showStep(stepSuccess);

  } catch (e) {
    showError(verifyError, 'Erreur réseau. Vérifiez votre connexion.');
    setLoading(btnVerify, false);
  }
}

// --- Renvoi du code ---
async function resendCode() {
  hideError(verifyError);
  btnResend.disabled = true;
  btnResend.textContent = 'Envoi…';

  try {
    const res = await fetch('/api/first-login/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ user_id: userId })
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      showError(verifyError, data.error || 'Erreur lors du renvoi.');
    } else {
      // Feedback visuel temporaire
      btnResend.textContent = '✓ Envoyé !';
      setTimeout(() => {
        btnResend.textContent = 'Renvoyer';
        btnResend.disabled = false;
      }, 3000);
      return;
    }
  } catch (e) {
    showError(verifyError, 'Erreur réseau.');
  }

  btnResend.textContent = 'Renvoyer';
  btnResend.disabled = false;
}

// --- Liaison des événements (délégation ou addEventListener direct) ---
btnSendCode.addEventListener('click', sendCode);
btnVerify.addEventListener('click', verifyCode);
btnResend.addEventListener('click', resendCode);

// Enter dans les champs
codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') verifyCode();
});
confirmInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') verifyCode();
});