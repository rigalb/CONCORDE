/* ============================================================
   forgot_password.js — Mot de passe oublié
   Flux : username OU email → code 6 chiffres + nouveau MDP = succès
   ============================================================ */

/* ── Utilitaire : lit la valeur réelle d'un champ ─────────────────────────
   Pour un InputComp, getValue() peut être désynchronisé avec le DOM.
   On lit directement le .ic-input natif du wrapper pour être sûr.    */
function fieldGet(id) {
  const ic = window._IC_instances?.[id];
  if (ic) {
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

// --- Références DOM stables ---
const stepIdentifier = document.getElementById('step-identifier');
const stepVerify     = document.getElementById('step-verify');
const stepSuccess    = document.getElementById('step-success');

const identifierError = document.getElementById('identifier-error');
const verifyError     = document.getElementById('verify-error');

const btnSend   = document.getElementById('btn-send');
const btnVerify = document.getElementById('btn-verify');
const btnResend = document.getElementById('btn-resend');

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

// --- Validation temps réel via délégation ---
document.addEventListener('input', (e) => {
  const target = e.target;

  // Champ code : input NATIF (pas de data-input-comp dans forgot_password.html)
  if (target.id === 'code') {
    hideError(verifyError);
    target.value = target.value.replace(/\D/g, '').slice(0, 6);
    target.classList.toggle('input-valid',   target.value.length === 6);
    target.classList.toggle('input-invalid', target.value.length > 0 && target.value.length < 6);
    return;
  }

  // Champs IC : identifier, password, confirm-password
  if (!target.classList.contains('ic-input')) return;
  const wrapper = target.closest('[data-input-id]');
  if (!wrapper) return;
  const id = wrapper.dataset.inputId;

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

// --- Étape 1 : envoyer le code ---
async function sendCode() {
  hideError(identifierError);
  const identifier = fieldGet('identifier').trim();
  if (!identifier) {
    showError(identifierError, 'Veuillez entrer votre identifiant ou email.');
    fieldGetEl('identifier')?.focus();
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
    showStep(stepVerify);
    setTimeout(() => document.getElementById('code')?.focus(), 80);
  } catch (e) {
    showError(identifierError, 'Erreur réseau. Vérifiez votre connexion.');
    setLoading(btnSend, false);
  }
}

// --- Étape 2 : vérifier code + changer MDP ---
async function verifyCode() {
  hideError(verifyError);
  // code : input natif
  const code    = (document.getElementById('code')?.value || '').replace(/\D/g, '').trim();
  const pwd     = fieldGet('password');
  const confirm = fieldGet('confirm-password');

  if (code.length !== 6) { showError(verifyError, 'Le code doit contenir 6 chiffres.'); document.getElementById('code')?.focus(); return; }
  if (pwd.length < 8)    { showError(verifyError, 'Mot de passe trop court (min 8 caractères).'); fieldGetEl('password')?.focus(); return; }
  if (pwd.length > 200)  { showError(verifyError, 'Mot de passe trop long.'); return; }
  if (pwd !== confirm)   { showError(verifyError, 'Les mots de passe ne correspondent pas.'); fieldGetEl('confirm-password')?.focus(); return; }

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

// Enter : délégation
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  // input natif code
  if (e.target.id === 'code') { e.preventDefault(); verifyCode(); return; }
  // champs IC
  const wrapper = e.target.closest('[data-input-id]');
  if (!wrapper) return;
  const id = wrapper.dataset.inputId;
  if (id === 'identifier') { e.preventDefault(); sendCode(); }
  else if (id === 'password' || id === 'confirm-password') { e.preventDefault(); verifyCode(); }
});
