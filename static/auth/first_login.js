/* ============================================================
   first_login.js - Première connexion élève
   CONCORDE · static/auth/

   Flux :
     1. L'élève arrive sur /first-login?uid=<id>
     2. Il clique "Envoyer le code" -> POST /api/first-login/send-code
     3. Il saisit le code reçu + son nouveau mot de passe
        -> POST /api/first-login/verify
     4. Succès -> redirection vers /

   Dépendances :
     - Input_Comp.js  (doit être chargé avant ce fichier)
     - auth.css       (classes .auth-step, .auth-error, .hidden…)

   On respecte :
     - 0 style= attribut inline
     - 0 onclick= inline
     - Validation côté client AVANT l'appel réseau
       (mais le serveur revalide toujours indépendamment)
============================================================ */

'use strict';

/* -- Lecture de l'user_id depuis l'URL ---------------------------------------
   L'URL est de la forme : /first-login?uid=42
   On récupère l'id ici pour l'envoyer à chaque appel API.
   Si l'id est manquant ou invalide, on affiche un message d'erreur immédiat.    */
const _params = new URLSearchParams(window.location.search);
const userId  = parseInt(_params.get('uid'), 10);


/* -- Helpers InputComp -------------------------------------------------------
   InputComp remplace l'<input> natif par un wrapper .ic-wrapper.
   getValue() lit this._value (état interne du composant), mais cet état peut
   être légèrement désynchronisé avec le DOM si l'utilisateur tape très vite.
   On lit donc toujours le .ic-input natif (l'<input> réel à l'intérieur du
   wrapper) pour avoir la valeur sûre.                                           */

/**
 * Retourne la valeur courante d'un champ, qu'il soit InputComp ou natif.
 * @param {string} id - L'id HTML du champ original (avant remplacement par IC)
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
 * Retourne l'élément DOM focusable d'un champ (le .ic-input ou l'input natif).
 * Utilisé pour positionner le focus après une erreur de validation.
 * @param {string} id
 * @returns {HTMLElement|null}
 */
function fieldGetEl(id) {
  const ic = window._IC_instances?.[id];
  if (ic) return ic.wrapper.querySelector('.ic-input') || document.getElementById(id);
  return document.getElementById(id);
}


/* -- Références DOM ----------------------------------------------------------
   Ces références sont stables (jamais remplacées par InputComp) car elles
   pointent sur des divs et buttons, pas sur des inputs.                         */
const stepSend    = document.getElementById('step-send');
const stepVerify  = document.getElementById('step-verify');
const stepSuccess = document.getElementById('step-success');
const sendError   = document.getElementById('send-error');
const verifyError = document.getElementById('verify-error');
const btnSendCode = document.getElementById('btn-send-code');
const btnVerify   = document.getElementById('btn-verify');
const btnResend   = document.getElementById('btn-resend');


/* -- Utilitaires UI ----------------------------------------------------------  */

/** Affiche un message d'erreur dans un élément .auth-error */
function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

/** Masque un message d'erreur */
function hideError(el) {
  el.textContent = '';
  el.classList.add('hidden');
}

/** Affiche une étape, masque les autres */
function showStep(step) {
  [stepSend, stepVerify, stepSuccess].forEach(s => s.classList.add('hidden'));
  step.classList.remove('hidden');
}

/**
 * Active/désactive l'état "chargement" d'un bouton.
 * Conserve le texte original pour le restaurer après.
 */
function setLoading(btn, loading) {
  btn.disabled = loading;
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = 'Chargement…';
  } else {
    btn.textContent = btn.dataset.originalText || btn.textContent;
  }
}


/* -- Validation immédiate au chargement -------------------------------------
   Si l'URL ne contient pas d'uid valide, on affiche un message clair
   et on masque le bouton d'envoi pour éviter un appel API inutile.              */
if (!userId || isNaN(userId)) {
  const h2 = stepSend.querySelector('h2');
  const sub = stepSend.querySelector('.auth-subtitle');
  if (h2)  h2.textContent = '⚠ Lien invalide';
  if (sub) sub.textContent = 'Ce lien de première connexion est invalide. Contactez votre établissement.';
  btnSendCode.classList.add('hidden');
}


/* -- Validation temps réel des champs (délégation sur document) -------------
   On utilise la délégation d'événement plutôt que d'attacher des listeners
   sur chaque champ, car InputComp crée ses wrappers après DOMContentLoaded
   et les inputs natifs peuvent être remplacés.

   Le wrapper InputComp porte un attribut data-input-id qui correspond à l'id
   du champ original - c'est la clé de discrimination.                           */
document.addEventListener('input', (e) => {
  const target = e.target;

  // On ne traite que les .ic-input (champs pilotés par InputComp)
  if (!target.classList.contains('ic-input')) return;

  const wrapper = target.closest('[data-input-id]');
  if (!wrapper) return;
  const id = wrapper.dataset.inputId;

  // NOTE : le champ "code" est un input natif (pas d'InputComp),
  // sa validation temps réel est gérée par le listener dédié ci-dessous.

  if (id === 'password') {
    hideError(verifyError);
    const len = target.value.length;
    target.classList.toggle('input-valid',   len >= 8);
    target.classList.toggle('input-invalid', len > 0 && len < 8);
    // Mettre à jour la confirmation si elle a déjà été touchée
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
   POST /api/first-login/send-code
   Le serveur vérifie que la session "pending_first_login_user_id" correspond
   à l'uid envoyé, génère un code haché en base, et envoie l'email.              */
async function sendCode() {
  hideError(sendError);
  setLoading(btnSendCode, true);
  try {
    const res  = await fetch('/api/first-login/send-code', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ user_id: userId }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      showError(sendError, data.error || 'Erreur lors de l\'envoi.');
      setLoading(btnSendCode, false);
      return;
    }
    showStep(stepVerify);
    // Délai court pour laisser InputComp finir son rendu avant le focus
    setTimeout(() => fieldGetEl('code')?.focus(), 80);
  } catch {
    showError(sendError, 'Erreur réseau. Vérifiez votre connexion.');
    setLoading(btnSendCode, false);
  }
}


/* -- Étape 2 : vérification code + définition du mot de passe ----------------
   POST /api/first-login/verify
   Le serveur valide le code haché, met à jour le mot de passe (bcrypt),
   invalide le token et ouvre la session normale.                                 */
async function verifyCode() {
  hideError(verifyError);

  const code    = (document.getElementById('code')?.value ?? '').replace(/\D/g, '').trim();
  const pwd     = fieldGet('password');
  const confirm = fieldGet('confirm-password');

  // Validation côté client - le serveur revalide aussi, mais ceci évite
  // un aller-retour réseau inutile pour des erreurs évidentes.
  if (code.length !== 6) {
    showError(verifyError, 'Le code doit contenir 6 chiffres.');
    document.getElementById('code')?.focus();
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
    const res  = await fetch('/api/first-login/verify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ user_id: userId, code, password: pwd, confirm_password: confirm }),
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
   Même endpoint que sendCode. Le bouton est désactivé 3 secondes après succès
   pour éviter le spam.                                                          */
async function resendCode() {
  hideError(verifyError);
  btnResend.disabled = true;
  btnResend.textContent = 'Envoi…';
  try {
    const res  = await fetch('/api/first-login/send-code', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ user_id: userId }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
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

/* -- Validation temps réel du champ code (input natif) ----------------------
   Le champ code n'est pas un InputComp - on lui attache un listener direct.
   On filtre les caractères non numériques et on met à jour les classes CSS.    */
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
btnSendCode.addEventListener('click', sendCode);
btnVerify.addEventListener('click', verifyCode);
btnResend.addEventListener('click', resendCode);

// Touche Entrée dans les champs de l'étape 2 -> soumettre verifyCode
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  // Champ code : input natif
  if (e.target.id === 'code') { e.preventDefault(); verifyCode(); return; }
  // Champs password / confirm-password : InputComp
  const wrapper = e.target.closest('[data-input-id]');
  if (!wrapper) return;
  const id = wrapper.dataset.inputId;
  if (id === 'password' || id === 'confirm-password') {
    e.preventDefault();
    verifyCode();
  }
});
