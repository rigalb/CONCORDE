/* ============================================================
   first_login.js — Première connexion élève
   Flux : envoi code → saisie code + nouveau MDP → succès
   Règles : 0 style= inline, 0 onclick= inline
   ============================================================ */

// --- Lecture de l'user_id depuis l'URL (?uid=xxx) ---
const urlParams = new URLSearchParams(window.location.search);
const userId    = parseInt(urlParams.get('uid'), 10);

/* ── Utilitaire : lit la valeur réelle d'un champ ──────────────────────────
   Pour un InputComp, getValue() retourne _value (état interne) mais celui-ci
   n'est synchronisé que si l'event 'input' passe par _bindInput.
   On lit donc directement l'élément .ic-input (DOM réel) pour être sûr.
   Pour un input natif sans IC, on lit l'élément lui-même.          */
function fieldGet(id) {
  const ic = window._IC_instances?.[id];
  if (ic) {
    // Lire le .ic-input natif à l'intérieur du wrapper
    const el = ic.wrapper.querySelector('.ic-input');
    return el ? el.value : ic.getValue();
  }
  return document.getElementById(id)?.value ?? '';
}

function fieldGetEl(id) {
  const ic = window._IC_instances?.[id];
  if (ic) return ic.wrapper.querySelector('.ic-input') || document.getElementById(id);
  return document.getElementById(id);
}

// --- Références DOM stables (jamais remplacées par InputComp) ---
const stepSend    = document.getElementById('step-send');
const stepVerify  = document.getElementById('step-verify');
const stepSuccess = document.getElementById('step-success');

const sendError   = document.getElementById('send-error');
const verifyError = document.getElementById('verify-error');

const btnSendCode = document.getElementById('btn-send-code');
const btnVerify   = document.getElementById('btn-verify');
const btnResend   = document.getElementById('btn-resend');

// --- Utilitaires ---
function showError(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }
function hideError(el)       { el.textContent = ''; el.classList.add('hidden'); }

function showStep(step) {
  [stepSend, stepVerify, stepSuccess].forEach(s => s.classList.add('hidden'));
  step.classList.remove('hidden');
}

function setLoading(btn, loading) {
  btn.disabled = loading;
  if (loading) { btn.dataset.originalText = btn.textContent; btn.textContent = 'Chargement…'; }
  else         { btn.textContent = btn.dataset.originalText || btn.textContent; }
}

// --- Validation au départ ---
if (!userId || isNaN(userId)) {
  stepSend.querySelector('h2').textContent = '⚠ Lien invalide';
  stepSend.querySelector('.subtitle').textContent =
    'Ce lien de première connexion est invalide. Contactez votre établissement.';
  btnSendCode.classList.add('hidden');
}

// --- Validation temps réel du code (délégation, compatible IC) ---
// Le champ code a un data-input-comp → l'input natif est .ic-input à l'intérieur du wrapper
document.addEventListener('input', (e) => {
  const target = e.target;
  if (!target.classList.contains('ic-input')) return;
  const wrapper = target.closest('[data-input-id]');
  if (!wrapper) return;
  const id = wrapper.dataset.inputId;

  if (id === 'code') {
    hideError(verifyError);
    // Forcer chiffres uniquement directement sur le .ic-input
    target.value = target.value.replace(/\D/g, '').slice(0, 6);
    target.classList.toggle('input-valid',   target.value.length === 6);
    target.classList.toggle('input-invalid', target.value.length > 0 && target.value.length < 6);
  }

  if (id === 'password') {
    hideError(verifyError);
    const l = target.value.length;
    target.classList.toggle('input-valid',   l >= 8);
    target.classList.toggle('input-invalid', l > 0 && l < 8);
    const confirmEl = fieldGetEl('confirm-password');
    if (confirmEl && confirmEl.value.length > 0) confirmEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  if (id === 'confirm-password') {
    hideError(verifyError);
    const pwd = fieldGet('password');
    if (target.value.length > 0) {
      target.classList.toggle('input-valid',   target.value === pwd);
      target.classList.toggle('input-invalid', target.value !== pwd);
    } else {
      target.classList.remove('input-valid', 'input-invalid');
    }
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
    // Focus sur le .ic-input du champ code
    setTimeout(() => fieldGetEl('code')?.focus(), 80);
  } catch (e) {
    showError(sendError, 'Erreur réseau. Vérifiez votre connexion.');
    setLoading(btnSendCode, false);
  }
}

// --- Étape 2 : Vérifier le code et changer le MDP ---
async function verifyCode() {
  hideError(verifyError);

  // Lire directement le .ic-input pour éviter le décalage avec _value interne
  const code    = fieldGet('code').replace(/\D/g, '').trim();
  const pwd     = fieldGet('password');
  const confirm = fieldGet('confirm-password');

  if (code.length !== 6) {
    showError(verifyError, 'Le code doit contenir 6 chiffres.');
    fieldGetEl('code')?.focus();
    return;
  }
  if (pwd.length < 8) {
    showError(verifyError, 'Le mot de passe doit contenir au moins 8 caractères.');
    fieldGetEl('password')?.focus();
    return;
  }
  if (pwd.length > 200) {
    showError(verifyError, 'Le mot de passe est trop long (max 200 caractères).');
    return;
  }
  if (pwd !== confirm) {
    showError(verifyError, 'Les mots de passe ne correspondent pas.');
    fieldGetEl('confirm-password')?.focus();
    return;
  }

  setLoading(btnVerify, true);
  try {
    const res = await fetch('/api/first-login/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ user_id: userId, code, password: pwd, confirm_password: confirm })
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
      btnResend.textContent = '✓ Envoyé !';
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
btnSendCode.addEventListener('click', sendCode);
btnVerify.addEventListener('click', verifyCode);
btnResend.addEventListener('click', resendCode);

// Enter dans les champs IC (délégation)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const wrapper = e.target.closest('[data-input-id]');
  if (!wrapper) return;
  const id = wrapper.dataset.inputId;
  if (id === 'code' || id === 'password' || id === 'confirm-password') {
    e.preventDefault();
    verifyCode();
  }
});
