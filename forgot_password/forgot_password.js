/* ============================================================
   forgot_password.js — Mot de passe oublié
   Flux : username OU email → code 6 chiffres + nouveau MDP = succès
   ============================================================ */

// --- Références DOM ---
const stepIdentifier = document.getElementById('step-identifier');
const stepVerify     = document.getElementById('step-verify');
const stepSuccess    = document.getElementById('step-success');

const identifierError = document.getElementById('identifier-error');
const verifyError     = document.getElementById('verify-error');

const identifierInput = document.getElementById('identifier');
const codeInput       = document.getElementById('code');
const passwordInput   = document.getElementById('password');
const confirmInput    = document.getElementById('confirm-password');

const btnSend   = document.getElementById('btn-send');
const btnVerify = document.getElementById('btn-verify');
const btnResend = document.getElementById('btn-resend');

// identifiant mémorisé pour le renvoi éventuel
let currentIdentifier = '';

// --- Utilitaires ---
function showError(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }
function hideError(el)      { el.textContent = ''; el.classList.add('hidden'); }
function showStep(step) {
  [stepIdentifier, stepVerify, stepSuccess].forEach(s => s.classList.add('hidden'));
  step.classList.remove('hidden');
}
function setLoading(btn, loading) {
  btn.disabled = loading;
  if (loading) { btn.dataset.originalText = btn.textContent; btn.textContent = 'Chargement...'; }
  else         { btn.textContent = btn.dataset.originalText || btn.textContent; }
}

// --- Validation temps réel code ---
codeInput.addEventListener('input', () => {
  hideError(verifyError);
  codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
  codeInput.classList.toggle('input-valid',   codeInput.value.length === 6);
  codeInput.classList.toggle('input-invalid', codeInput.value.length > 0 && codeInput.value.length < 6);
});

// --- Validation temps réel MDP ---
passwordInput.addEventListener('input', () => {
  hideError(verifyError);
  const l = passwordInput.value.length;
  passwordInput.classList.toggle('input-valid',   l >= 8);
  passwordInput.classList.toggle('input-invalid', l > 0 && l < 8);
  if (confirmInput.value.length > 0) confirmInput.dispatchEvent(new Event('input'));
});
confirmInput.addEventListener('input', () => {
  hideError(verifyError);
  if (confirmInput.value.length > 0) {
    const ok = confirmInput.value === passwordInput.value;
    confirmInput.classList.toggle('input-valid',   ok);
    confirmInput.classList.toggle('input-invalid', !ok);
  } else {
    confirmInput.classList.remove('input-valid', 'input-invalid');
  }
});

// --- Étape 1 : envoyer le code ---
async function sendCode() {
  hideError(identifierError);
  const identifier = identifierInput.value.trim();
  if (!identifier) {
    showError(identifierError, 'Veuillez entrer votre identifiant ou email.');
    identifierInput.focus();
    return;
  }
  currentIdentifier = identifier;
  setLoading(btnSend, true);
  try {
    const res  = await fetch('/api/forgot-password/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ identifier })
    });
    const data = await res.json();
    if (!res.ok) {
      showError(identifierError, data.error || 'Erreur serveur.');
      setLoading(btnSend, false);
      return;
    }
    // Passer à l'étape 2 (réponse générique côté serveur)
    showStep(stepVerify);
    codeInput.focus();
  } catch (e) {
    showError(identifierError, 'Erreur réseau. Vérifiez votre connexion.');
    setLoading(btnSend, false);
  }
}

// --- Étape 2 : vérifier code + changer MDP ---
async function verifyCode() {
  hideError(verifyError);
  const code    = codeInput.value.trim();
  const pwd     = passwordInput.value;
  const confirm = confirmInput.value;

  if (code.length !== 6) { showError(verifyError, 'Le code doit contenir 6 chiffres.'); codeInput.focus(); return; }
  if (pwd.length < 8)    { showError(verifyError, 'Mot de passe trop court (min 8 caractères).'); passwordInput.focus(); return; }
  if (pwd.length > 200)  { showError(verifyError, 'Mot de passe trop long.'); return; }
  if (pwd !== confirm)   { showError(verifyError, 'Les mots de passe ne correspondent pas.'); confirmInput.focus(); return; }

  setLoading(btnVerify, true);
  try {
    const res  = await fetch('/api/forgot-password/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ code, password: pwd, confirm_password: confirm })
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
  btnResend.textContent = 'Envoi...';
  try {
    const res = await fetch('/api/forgot-password/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ identifier: currentIdentifier })
    });
    const data = await res.json();
    if (!res.ok) {
      showError(verifyError, data.error || 'Erreur lors du renvoi.');
    } else {
      btnResend.textContent = 'Envoyé !';
      setTimeout(() => { btnResend.textContent = 'Renvoyer'; btnResend.disabled = false; }, 3000);
      return;
    }
  } catch (e) {
    showError(verifyError, 'Erreur réseau.');
  }
  btnResend.textContent = 'Renvoyer';
  btnResend.disabled = false;
}

// --- Liaison des événements ---
btnSend.addEventListener('click', sendCode);
btnVerify.addEventListener('click', verifyCode);
btnResend.addEventListener('click', resendCode);
identifierInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendCode(); });
codeInput.addEventListener('keydown',       e => { if (e.key === 'Enter') verifyCode(); });
confirmInput.addEventListener('keydown',    e => { if (e.key === 'Enter') verifyCode(); });
