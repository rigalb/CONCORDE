/* ============================================================
   forgot_password.js - Réinitialisation du mot de passe
   CONCORDE · static/auth/

   Flux :
     1. L'utilisateur saisit son username ou email
        -> POST /api/forgot-password/request
        (réponse toujours générique pour ne pas révéler si le compte existe)
     2. Il saisit le code reçu + son nouveau mot de passe
        -> POST /api/forgot-password/verify
     3. Succès -> invitation à se connecter

   Dépendances :
     - Input_Comp.js  (chargé avant ce fichier)
     - auth.css

   Note : le champ "code" est désormais un InputComp (harmonisé avec
   first_login.js). La logique de lecture passe donc par fieldGet()
   dans les deux pages.
============================================================ */

'use strict';

/* -- Helpers InputComp -------------------------------------------------------
   Même pattern que first_login.js — voir commentaire là-bas pour l'explication
   détaillée du pourquoi on lit .ic-input et non getValue().                     */

/**
 * Retourne la valeur courante d'un champ InputComp ou natif.
 * @param {string} id
 * @returns {string}
 */
function fieldGet(id) {
  const ic = window._IC_instances?.[id];
  if (ic) {
    const el = ic.wrapper.querySelector('.ic-input');
    return el ? el.value : ic.getValue();
  }
  return document.getElementById(id)?.value ?? '';
}

/**
 * Retourne l'élément focusable d'un champ (pour positionner le curseur
 * après une erreur de validation).
 * @param {string} id
 * @returns {HTMLElement|null}
 */
function fieldGetEl(id) {
  const ic = window._IC_instances?.[id];
  if (ic) return ic.wrapper.querySelector('.ic-input') || document.getElementById(id);
  return document.getElementById(id);
}


/* -- Références DOM ----------------------------------------------------------  */
const stepIdentifier  = document.getElementById('step-identifier');
const stepVerify      = document.getElementById('step-verify');
const stepSuccess     = document.getElementById('step-success');
const identifierError = document.getElementById('identifier-error');
const verifyError     = document.getElementById('verify-error');
const btnSend         = document.getElementById('btn-send');
const btnVerify       = document.getElementById('btn-verify');
const btnResend       = document.getElementById('btn-resend');

// Conservé pour le renvoi de code (on renvoie le même identifiant)
let _lastIdentifier = '';


/* -- Utilitaires UI ----------------------------------------------------------  */

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideError(el) {
  el.textContent = '';
  el.classList.add('hidden');
}

function showStep(step) {
  [stepIdentifier, stepVerify, stepSuccess].forEach(s => s.classList.add('hidden'));
  step.classList.remove('hidden');
}

function setLoading(btn, loading) {
  btn.disabled = loading;
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = 'Chargement…';
  } else {
    btn.textContent = btn.dataset.originalText || btn.textContent;
  }
}


/* -- Validation temps réel (délégation sur document) ------------------------
   Tous les champs de cette page sont des InputComp (y compris "code" désormais),
   donc on filtre sur .ic-input + data-input-id, comme dans first_login.js.      */
document.addEventListener('input', (e) => {
  const target = e.target;
  if (!target.classList.contains('ic-input')) return;

  const wrapper = target.closest('[data-input-id]');
  if (!wrapper) return;
  const id = wrapper.dataset.inputId;

  if (id === 'code') {
    hideError(verifyError);
    target.value = target.value.replace(/\D/g, '').slice(0, 6);
    target.classList.toggle('input-valid',   target.value.length === 6);
    target.classList.toggle('input-invalid', target.value.length > 0 && target.value.length < 6);
    return;
  }

  if (id === 'password') {
    hideError(verifyError);
    const len = target.value.length;
    target.classList.toggle('input-valid',   len >= 8);
    target.classList.toggle('input-invalid', len > 0 && len < 8);
    const confirmEl = fieldGetEl('confirm-password');
    if (confirmEl && confirmEl.value.length > 0) {
      confirmEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return;
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


/* -- Étape 1 : envoi du code -------------------------------------------------
   POST /api/forgot-password/request
   Le serveur répond toujours avec succès=true même si l'identifiant n'existe
   pas (anti-énumération de comptes). On passe à l'étape 2 dans tous les cas.   */
async function sendCode() {
  hideError(identifierError);

  const identifier = fieldGet('identifier').trim();
  if (!identifier) {
    showError(identifierError, 'Veuillez entrer votre identifiant ou email.');
    fieldGetEl('identifier')?.focus();
    return;
  }

  _lastIdentifier = identifier;
  setLoading(btnSend, true);

  try {
    const res  = await fetch('/api/forgot-password/request', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ identifier }),
    });
    const data = await res.json();
    if (!res.ok) {
      showError(identifierError, data.error || 'Erreur serveur.');
      setLoading(btnSend, false);
      return;
    }
    // Toujours afficher l'étape 2 (même si le compte n'existe pas)
    showStep(stepVerify);
    setTimeout(() => document.getElementById('code')?.focus(), 80);
  } catch {
    showError(identifierError, 'Erreur réseau. Vérifiez votre connexion.');
    setLoading(btnSend, false);
  }
}


/* -- Étape 2 : vérification code + changement de mot de passe ---------------
   POST /api/forgot-password/verify
   Le serveur lit le pending_reset_user_id depuis la session Flask
   (posé lors de l'étape 1 côté serveur).                                        */
async function verifyCode() {
  hideError(verifyError);

  const code    = (document.getElementById('code')?.value ?? '').replace(/\D/g, '').trim();
  const pwd     = fieldGet('password');
  const confirm = fieldGet('confirm-password');

  if (code.length !== 6) {
    showError(verifyError, 'Le code doit contenir 6 chiffres.');
    document.getElementById('code')?.focus();
    return;
  }
  if (pwd.length < 8) {
    showError(verifyError, 'Mot de passe trop court (min 8 caractères).');
    fieldGetEl('password')?.focus();
    return;
  }
  if (pwd.length > 200) {
    showError(verifyError, 'Mot de passe trop long.');
    return;
  }
  if (pwd !== confirm) {
    showError(verifyError, 'Les mots de passe ne correspondent pas.');
    fieldGetEl('confirm-password')?.focus();
    return;
  }

  setLoading(btnVerify, true);
  try {
    const res  = await fetch('/api/forgot-password/verify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ code, password: pwd, confirm_password: confirm }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      showError(verifyError, data.error || 'Code ou mot de passe invalide.');
      setLoading(btnVerify, false);
      return;
    }
    showStep(stepSuccess);
  } catch {
    showError(verifyError, 'Erreur réseau. Vérifiez votre connexion.');
    setLoading(btnVerify, false);
  }
}


/* -- Renvoi du code ----------------------------------------------------------
   On renvoie le même identifiant (_lastIdentifier) à l'endpoint de l'étape 1.  */
async function resendCode() {
  hideError(verifyError);
  btnResend.disabled = true;
  btnResend.textContent = 'Envoi…';
  try {
    const res  = await fetch('/api/forgot-password/request', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ identifier: _lastIdentifier }),
    });
    const data = await res.json();
    if (!res.ok) {
      showError(verifyError, data.error || 'Erreur lors du renvoi.');
    } else {
      btnResend.textContent = '✓ Envoyé !';
      setTimeout(() => {
        btnResend.textContent = 'Renvoyer';
        btnResend.disabled = false;
      }, 3000);
      return;
    }
  } catch {
    showError(verifyError, 'Erreur réseau.');
  }
  btnResend.textContent = 'Renvoyer';
  btnResend.disabled = false;
}



/* -- Gestion des états du wrapper IC statique pour le champ code ------------
   Le wrapper .ic-otp-wrap est un HTML statique (pas généré par InputComp),
   donc on gère manuellement ic-focused et ic-has-value pour que le label
   flottant et la bordure bleue fonctionnent comme sur les autres champs IC.   */
const otpInput   = document.getElementById('code');
const otpWrapper = otpInput?.closest('.ic-otp-wrap');
if (otpInput && otpWrapper) {
  // Mettre à jour ic-has-value dès qu'il y a du contenu
  const updateOtpValue = () => {
    otpWrapper.classList.toggle('ic-has-value', otpInput.value.length > 0);
  };
  otpInput.addEventListener('focus', () => {
    otpWrapper.classList.add('ic-focused');
    updateOtpValue();
  });
  otpInput.addEventListener('blur', () => {
    otpWrapper.classList.remove('ic-focused');
    updateOtpValue();
  });
  otpInput.addEventListener('input', updateOtpValue);
}

/* -- Validation temps réel du champ code (input natif) ----------------------  */
const codeInput = document.getElementById('code');
if (codeInput) {
  codeInput.addEventListener('input', () => {
    hideError(verifyError);
    codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
    codeInput.classList.toggle('input-valid',   codeInput.value.length === 6);
    codeInput.classList.toggle('input-invalid', codeInput.value.length > 0 && codeInput.value.length < 6);
  });
}

/* -- Liaison des événements --------------------------------------------------  */
btnSend.addEventListener('click', sendCode);
btnVerify.addEventListener('click', verifyCode);
btnResend.addEventListener('click', resendCode);

// Entrée dans les champs -> action correspondante à l'étape courante
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const wrapper = e.target.closest('[data-input-id]');
  if (!wrapper) return;
  const id = wrapper.dataset.inputId;
  if (id === 'identifier') {
    e.preventDefault();
    sendCode();
  } else if (id === 'code' || id === 'password' || id === 'confirm-password') {
    e.preventDefault();
    verifyCode();
  }
});
