/* ============================================================
   prof_signup.js - Inscription professeur
   CONCORDE · static/auth/

   Flux :
     1. Chargement de la page : validation du token d'invitation
        -> GET /api/invitation-info?token=<token>
        Si le token est invalide/expiré : message d'erreur, formulaire masqué.
        Si le token est valide : pré-remplissage username, affichage du formulaire.
     2. Chargement parallèle des classes : GET /classes
     3. L'utilisateur remplit et soumet le formulaire
        -> POST /inscription
     4. Succès -> redirection vers / après 2 secondes

   Dépendances :
     - Input_Comp.js  (chargé avant ce fichier - auto-init via data-input-comp)
     - auth.css

   Changements vs version précédente :
     - Suppression du <form> + event.preventDefault() -> bouton + fetch()
       (cohérent avec le reste du projet)
     - Récupération des instances InputComp via window._IC_instances
       (API publique, fiable) au lieu de 3 stratégies imbriquées fragiles
     - Suppression des style= inline dans showMessage
     - Classe .hidden sur #signup-form au lieu de style="display:none"
============================================================ */

'use strict';

/* -- Token d'invitation (URL) ------------------------------------------------
   L'URL est de la forme : /inscription?token=<token_urlsafe_32>
   Sans token valide, le formulaire reste masqué.                                */
const _token = new URLSearchParams(window.location.search).get('token');

/* -- Références DOM ----------------------------------------------------------  */
const welcomeInfo = document.getElementById('welcome-info');
const messageEl   = document.getElementById('message');
const signupForm  = document.getElementById('signup-form');
const btnSubmit   = document.getElementById('btn-submit');


/* -- Utilitaires UI ----------------------------------------------------------  */

/**
 * Affiche un message global (succès ou erreur).
 * Utilise les classes CSS auth.css (.auth-message.error / .success)
 * sans aucun style= inline.
 * @param {string} text
 * @param {'error'|'success'} type
 */
function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className   = `auth-message ${type}`;
  messageEl.style.display = 'block';  // nécessaire car .auth-message a display:none par défaut
  messageEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function setLoading(loading) {
  btnSubmit.disabled    = loading;
  btnSubmit.textContent = loading ? 'Création en cours…' : 'Créer mon compte';
}


/* -- Helpers InputComp -------------------------------------------------------
   Après DOMContentLoaded, InputComp auto-init peuple window._IC_instances
   avec une entrée par id de champ original (ex: _IC_instances['password']).
   On les lit ici pour récupérer les valeurs des selects et des inputs gérés
   par IC, car leur élément natif peut ne plus être directement accessible.

   Pour les inputs simples (text, password), on peut lire directement
   document.getElementById(id).value car InputComp conserve l'input natif
   dans le wrapper.                                                               */

/**
 * Retourne la valeur d'un champ InputComp (select ou input).
 * Pour un select IC, la valeur est dans l'input[type=hidden] du wrapper.
 * @param {string} id - id du champ original
 * @returns {string}
 */
function icGetValue(id) {
  const ic = window._IC_instances?.[id];
  if (!ic) return document.getElementById(id)?.value ?? '';
  // Pour select, getValue() retourne la valeur de l'input hidden
  return ic.getValue() ?? '';
}


/* -- Jauge de force du mot de passe -----------------------------------------
   Calcule un score 0–100 et met à jour la barre + le texte indicatif.
   Attaché sur l'input natif (conservé dans le wrapper IC) après DOMContentLoaded. */

function evalPasswordStrength(pwd) {
  let score = 0;
  if (pwd.length >= 8)  score += 25;
  if (pwd.length >= 12) score += 25;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score += 25;
  if (/[0-9]/.test(pwd) && /[^a-zA-Z0-9]/.test(pwd)) score += 25;
  return score;
}

function updateStrengthUI(score) {
  const fill = document.getElementById('strength-fill');
  const text = document.getElementById('strength-text');
  if (!fill || !text) return;

  fill.style.width = score + '%';

  if (score < 25) {
    fill.style.background = '#dc2626';
    text.textContent      = 'Trop faible';
    text.style.color      = '#dc2626';
  } else if (score < 50) {
    fill.style.background = '#f97316';
    text.textContent      = 'Faible';
    text.style.color      = '#f97316';
  } else if (score < 75) {
    fill.style.background = '#0ea5e9';
    text.textContent      = 'Moyen';
    text.style.color      = '#0ea5e9';
  } else {
    fill.style.background = '#059669';
    text.textContent      = 'Fort';
    text.style.color      = '#059669';
  }
}


/* -- Chargement des infos d'invitation --------------------------------------
   GET /api/invitation-info?token=<token>
   Si valide : pré-remplit le champ username et affiche le formulaire.
   Si invalide : affiche un message d'erreur.                                    */
async function loadInvitationInfo() {
  if (!_token) {
    welcomeInfo.innerHTML = '<span class="auth-error" style="display:block">Token manquant dans l\'URL.</span>';
    return;
  }

  try {
    const res  = await fetch(`/api/invitation-info?token=${encodeURIComponent(_token)}`);
    const data = await res.json();

    if (data.error || !res.ok) {
      welcomeInfo.innerHTML = `<span style="color:#dc2626">❌ ${data.error || 'Invitation invalide ou expirée.'}</span>`;
      return;
    }

    // Pré-remplir le username avec la partie locale de l'email
    const usernameInput = document.getElementById('username');
    if (usernameInput) {
      usernameInput.value = data.email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
    }

    welcomeInfo.innerHTML = `
      <strong>Bienvenue !</strong><br>
      Email : <strong>${data.email}</strong><br>
      Complétez vos informations ci-dessous.
    `;

    // Afficher le formulaire en retirant .hidden
    signupForm.classList.remove('hidden');

  } catch {
    welcomeInfo.innerHTML = '<span style="color:#dc2626">❌ Erreur de chargement.</span>';
  }
}


/* -- Chargement des classes disponibles -------------------------------------
   GET /classes
   Peuple le select "classe" via l'API InputComp setOptions().                   */
async function loadClasses() {
  try {
    const res     = await fetch('/classes');
    const classes = await res.json();

    // Récupérer l'instance IC du select "classe"
    const classeIC = window._IC_instances?.['classe'];
    if (classeIC) {
      classeIC.setOptions([
        { value: '', label: '- Aucune classe principale -' },
        ...classes.map(c => ({ value: String(c.id), label: c.nom })),
      ]);
    }
  } catch (e) {
    console.warn('[prof_signup] Impossible de charger les classes :', e);
  }
}


/* -- Soumission du formulaire ------------------------------------------------
   POST /inscription
   Toutes les lectures se font via document.getElementById() pour les inputs
   natifs et icGetValue() pour les selects InputComp.                            */
async function submitForm() {
  // Lecture des valeurs
  const username     = (document.getElementById('username')?.value ?? '').trim();
  const prenom       = (document.getElementById('prenom')?.value   ?? '').trim();
  const nom          = (document.getElementById('nom')?.value       ?? '').trim();
  const password     =  document.getElementById('password')?.value  ?? '';
  const passwordConf =  document.getElementById('password-confirm')?.value ?? '';
  const matiere      = icGetValue('matiere');
  const classeId     = icGetValue('classe') || null;

  // Validation côté client
  if (!prenom || !nom) {
    showMessage('❌ Prénom et nom sont obligatoires.', 'error');
    return;
  }
  if (!matiere) {
    showMessage('❌ Veuillez sélectionner une matière.', 'error');
    return;
  }
  if (password.length < 8) {
    showMessage('❌ Mot de passe trop court (min 8 caractères).', 'error');
    return;
  }
  if (password.length > 200) {
    showMessage('❌ Mot de passe trop long.', 'error');
    return;
  }
  if (password !== passwordConf) {
    showMessage('❌ Les mots de passe ne correspondent pas.', 'error');
    return;
  }

  setLoading(true);
  try {
    const res  = await fetch('/inscription', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token: _token, username, prenom, nom, matiere, password, classe_id: classeId }),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      showMessage(`❌ ${data.error || 'Erreur lors de la création du compte.'}`, 'error');
      setLoading(false);
      return;
    }

    showMessage('✅ Compte créé ! Redirection…', 'success');
    signupForm.classList.add('hidden');
    setTimeout(() => { window.location.href = '/'; }, 2000);

  } catch {
    showMessage('❌ Erreur réseau. Vérifiez votre connexion.', 'error');
    setLoading(false);
  }
}


/* -- Initialisation après DOMContentLoaded -----------------------------------
   On attend DOMContentLoaded pour que InputComp auto-init ait eu le temps
   de créer window._IC_instances et de remplacer les éléments natifs.            */
document.addEventListener('DOMContentLoaded', () => {

  // Attacher la jauge de force sur l'input password natif
  const passwordInput = document.getElementById('password');
  if (passwordInput) {
    passwordInput.addEventListener('input', (e) => {
      updateStrengthUI(evalPasswordStrength(e.target.value));
    });
  }

  // Charger les données distantes en parallèle
  Promise.all([loadInvitationInfo(), loadClasses()]);

  // Bouton soumettre
  btnSubmit.addEventListener('click', submitForm);
});
