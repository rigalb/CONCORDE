/* ===========================
    Configuration & Variables
    =========================== */
let currentUser = null;
let users = [];
let classes = [];
let activites = [];
let currentWeekOffsetProf = 0;
let currentWeekOffsetEleve = 0;
let groupes = [];
// Variable globale pour stocker l'instance Select_Comp
let classeMultiSelect = null;

/* -- InputComp helpers --------------------------------------------
   Permettent de lire/écrire les valeurs des InputComp depuis script.js
   sans casser les accès getElementById existants.
   _IC_instances est peuplé par InputComp.js via un hook DOMContentLoaded.
-------------------------------------------------------------------- */
function icGet(id) {
    return window._IC_instances?.[id]?.getValue() ?? document.getElementById(id)?.value ?? '';
}
function icSet(id, val) {
    if (window._IC_instances?.[id]) window._IC_instances[id].setValue(val);
    else { const el = document.getElementById(id); if (el) el.value = val; }
}
function icSetError(id, msg) {
    if (window._IC_instances?.[id]) window._IC_instances[id].setError(msg);
    else { const el = document.getElementById(id); if (el) el.classList.toggle('error', !!msg); }
}

let groupeClasses = [];
let groupeClasseMultiSelect = null; // Instance Select_Comp pour les classes de groupe
let groupeEditMode = false;
let currentEditGroupeId = null;

let isSyncingClasses = false; //flag global
let editingActivityId = null;

// SSE Connection
let sseConnection = null;
let sseReconnectTimeout = null;
let sseReconnectDelay = 3000; // backoff exponentiel

// Verrou pour éviter les actions simultanées (inscription/désinscription)
const _pendingActions = new Set();
// Timestamps par clé d'action pour filtrer les echos SSE de nos propres actions
const _lastActionTsByKey = new Map();

// Identifiant de l'activité actuellement affichée dans le modal de détail.
// Indispensable pour que les handlers SSE rafraîchissent uniquement LE bon modal
// et non le modal de la dernière activité modifiée/créée côté serveur.
// Mis à jour par showActivityDetails / showActivityDetailsEleve.
// Remis à null par closeActivityModal.
let _currentModalActivityId = null;

// Debounce boutons d'inscription : bloque les re-clics pendant 800ms
// apres la FIN de chaque action (en plus du verrou _pendingActions pendant l'action).
const _btnDebounce = new Map();
const BTN_DEBOUNCE_MS = 800;

function _debouncedAction(key, fn) {
    const last = _btnDebounce.get(key) || 0;
    if (Date.now() - last < BTN_DEBOUNCE_MS) return;
    _btnDebounce.set(key, Date.now());
    fn();
}

/**
 * Retourne le nombre d'inscrits pour une activite.
 * Prefer _serverNbInscrits (valeur authoritative du serveur, poussee par SSE)
 * sur inscriptions.length (valeur locale, peut etre en avance sur le serveur).
 * Pour les activites separables, inscriptions.length reste la reference
 * car chaque seance a son propre compteur.
 */
function getInscritsCount(act) {
    if (!act.separable && act._serverNbInscrits !== undefined) {
        return act._serverNbInscrits;
    }
    return act.inscriptions?.length || 0;
}

function getSeanceInscritsCount(seance) {
    if (seance._serverNbInscrits !== undefined) return seance._serverNbInscrits;
    return seance.inscriptions?.length || 0;
}



// -- Heure serveur ------------------------------------------------
// _serverTimeOffset = différence (ms) entre l'heure serveur et Date.now() local.
// Calculé au démarrage et après chaque reconnexion SSE.
// Utilisé par nowServer() partout où on compare avec date_ouverture/fermeture.
let _serverTimeOffset = 0;

async function syncServerTime() {
    try {
        const t0 = Date.now();
        const res = await fetch('/api/server-time', { credentials: 'same-origin' });
        const { now: serverNow } = await res.json();
        const t1 = Date.now();
        const rtt = t1 - t0;
        // On estime que le message serveur a été émis à mi-parcours du RTT
        const serverMs = new Date(serverNow).getTime() + rtt / 2;
        _serverTimeOffset = serverMs - t1;
    } catch(e) {
        _serverTimeOffset = 0; // fallback silencieux : heure locale
    }
}

/** Retourne un Date représentant l'heure serveur estimée. */
function nowServer() {
    return new Date(Date.now() + _serverTimeOffset);
}

/* ===========================
    MODAL CUSTOM — remplace await showAlert() et await showConfirm()
    =========================== */

/**
 * Remplace await showAlert() — retourne une Promise<void>
 * Affiche un modal non-bloquant avec un bouton "OK".
 */
function showAlert(message, title = 'Information') {
    return new Promise((resolve) => {
        // Supprimer un éventuel modal en cours
        document.getElementById('custom-modal-root')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'custom-modal-root';
        overlay.className = 'modal-overlay visible custom-modal-overlay';

        overlay.innerHTML = `
            <div class="modal-content modal-sm custom-modal-content" role="alertdialog" aria-modal="true" aria-labelledby="cmodal-title" aria-describedby="cmodal-msg">
                <div class="modal-header">
                    <h3 id="cmodal-title">${title}</h3>
                </div>
                <div class="modal-body cmodal-msg" id="cmodal-msg">${message}</div>
                <div class="custom-modal-footer">
                    <button id="cmodal-ok" class="btn" autofocus>OK</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const close = () => { overlay.remove(); resolve(); };
        overlay.querySelector('#cmodal-ok').addEventListener('click', (e) => { e.stopPropagation(); close(); });
        // Fermer avec Entrée ou Échap
        const onKey = (e) => {
            if (e.key === 'Enter' || e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(); }
        };
        document.addEventListener('keydown', onKey);
        overlay.querySelector('#cmodal-ok').focus();
    });
}

/**
 * Remplace await showConfirm() — retourne une Promise<boolean>
 * Affiche un modal avec boutons "Confirmer" / "Annuler".
 */
function showConfirm(message, title = 'Confirmation', confirmLabel = 'Confirmer', cancelLabel = 'Annuler') {
    return new Promise((resolve) => {
        document.getElementById('custom-modal-root')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'custom-modal-root';
        overlay.className = 'modal-overlay visible custom-modal-overlay';

        overlay.innerHTML = `
            <div class="modal-content modal-sm custom-modal-content" role="alertdialog" aria-modal="true" aria-labelledby="cmodal-title" aria-describedby="cmodal-msg">
                <div class="modal-header">
                    <h3 id="cmodal-title">${title}</h3>
                </div>
                <div class="modal-body cmodal-msg" id="cmodal-msg">${message}</div>
                <div class="custom-modal-footer">
                    <button id="cmodal-cancel" class="btn secondary">${cancelLabel}</button>
                    <button id="cmodal-confirm" class="btn" autofocus>${confirmLabel}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const close = (result) => { overlay.remove(); resolve(result); };
        overlay.querySelector('#cmodal-confirm').addEventListener('click', (e) => { e.stopPropagation(); close(true); });
        overlay.querySelector('#cmodal-cancel').addEventListener('click', (e) => { e.stopPropagation(); close(false); });
        // Entrée = confirmer, Échap = annuler
        const onKey = (e) => {
            if (e.key === 'Enter')  { document.removeEventListener('keydown', onKey); close(true); }
            if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(false); }
        };
        document.addEventListener('keydown', onKey);
        overlay.querySelector('#cmodal-confirm').focus();
    });
}





/* ===========================
    DELEGATION D'EVENEMENTS CENTRALE
    =========================== */
function setupEventDelegation() {
    // Délégation sur le document pour tous les clics
    document.addEventListener('click', (e) => {
        const target = e.target;
        const btn = target.closest('button');
        const card = target.closest('.activity-card');

        // === ACTIONS ÉCHANGES (délégation data-action) ===
        if (btn && btn.dataset.action) {
            const action = btn.dataset.action;
            if (action === 'ouvrir-voeu') {
                e.stopPropagation();
                ouvrirModalVoeu(parseInt(btn.dataset.groupeId));
                return;
            }
            if (action === 'retirer-voeu') {
                e.stopPropagation();
                retirerVoeu(parseInt(btn.dataset.voeuId));
                return;
            }
            if (action === 'filtre-echanges') {
                e.stopPropagation();
                setFiltreEchanges(btn.dataset.filtre, parseInt(btn.dataset.groupeId));
                return;
            }
            if (action === 'proposer-echange') {
                e.stopPropagation();
                proposerEchange(parseInt(btn.dataset.voeuAId), parseInt(btn.dataset.voeuBId));
                return;
            }
            if (action === 'repondre-echange') {
                e.stopPropagation();
                repondreEchange(parseInt(btn.dataset.procId), btn.dataset.reponse);
                return;
            }
            if (action === 'valider-echange') {
                e.stopPropagation();
                validerEchange(parseInt(btn.dataset.procId));
                return;
            }
            if (action === 'annuler-echange') {
                e.stopPropagation();
                annulerEchangeProf(parseInt(btn.dataset.procId));
                return;
            }
        }

        // === BOUTON GÉRER GROUPES ===
        if (btn && btn.id === 'btn-ouvrir-groupes') {
            e.stopPropagation();
            ouvrirModalGroupes();
            return;
        }

        // === BOUTON RAFRAÎCHIR ÉCHANGES PROF ===
        if (btn && btn.id === 'btn-rafraichir-echanges-prof') {
            e.stopPropagation();
            chargerPendingProcedures();
            return;
        }

        // === BOUTONS D'ACTION DANS LES CARDS ===
        if (btn && btn.classList.contains('btn-action')) {
            e.stopPropagation();

            const activityCard = btn.closest('.activity-card');
            if (!activityCard) return;

            const activityId = parseInt(activityCard.dataset.activityId);

            if (btn.classList.contains('edit')) {
                ouvrirModalEdition(activityId);
            } else if (btn.classList.contains('delete')) {
                const titre = activityCard.querySelector('.activity-title').textContent;
                supprimerActivite(activityId, titre);
            }
            return;
        }

        // === BOUTONS DÉSINSCRIRE (ADMIN/PROF) - PRIORITÉ HAUTE ===
        if (btn && btn.classList.contains('btn-unregister')) {
            e.stopPropagation();
            const eleveId = parseInt(btn.dataset.eleveId);
            const seanceId = parseInt(btn.dataset.seanceId);
            console.log(btn.dataset.activiteSeparable);
            const isSeparable = btn.dataset.activiteSeparable === '1';

            console.log('Désinscription demandée:', { eleveId, seanceId, isSeparable });
            desinscrireEleve(eleveId, seanceId, isSeparable);
            return;
        }

        // === BOUTONS DE SÉANCE (ÉLÈVE) ===
        if (btn && btn.classList.contains('seance-btn')) {
            e.stopPropagation();
            const seanceId = parseInt(btn.dataset.seanceId);
            const action = btn.dataset.action;

            if (action === 'inscrire') {
                inscrireSeance(seanceId);
            } else if (action === 'desinscrire') {
                desinscrireSeance(seanceId);
            }
            return;
        }

        // === BOUTONS MINI DANS MODAL ===
        if (btn && btn.classList.contains('btn-mini') && !btn.classList.contains('btn-unregister')) {
            e.stopPropagation();
            const action = btn.dataset.action;
            const seanceId = parseInt(btn.dataset.seanceId);

            if (action === 'inscrire') inscrireSeance(seanceId);
            else if (action === 'desinscrire') desinscrireSeance(seanceId);
            return;
        }

        // === BOUTONS D'APPEL (PROF) ===
        if (btn && btn.classList.contains('appel-btn')) {
            e.stopPropagation();
            const seanceId = parseInt(btn.dataset.seanceId);
            const consultation = btn.classList.contains('fait');
            ouvrirModalAppel(seanceId, consultation);
            return;
        }

        // === BOUTONS IMPRIMER PDF ===
        if (btn && btn.classList.contains('btn-print')) {
            e.stopPropagation();
            const seanceId = parseInt(btn.dataset.seanceId);
            ouvrirModalPDF(seanceId);
            return;
        }

        // === BOUTONS RAPPEL INSCRIPTION ===
        if (btn && btn.classList.contains('btn-rappel')) {
            e.stopPropagation();
            const groupeId = parseInt(btn.dataset.groupeId);
            const eleveId = parseInt(btn.dataset.eleveId);
            envoyerRappelInscription(groupeId, eleveId, btn);
            return;
        }

        // === BOUTONS INSCRIPTION MANUELLE ===
        if (btn && btn.classList.contains('btn-inscription-manuelle')) {
            e.stopPropagation();
            const eleveId = parseInt(btn.dataset.eleveId);
            const groupeId = parseInt(btn.dataset.groupeId);
            ouvrirModalInscriptionManuelle(eleveId, groupeId);
            return;
        }

        // === BLOCS DE SÉANCE DANS EDT ===
        if (target.closest('.seance-block-prof, .seance-block-eleve')) {
            const block = target.closest('.seance-block-prof, .seance-block-eleve');
            const activityId = parseInt(block.dataset.activityId);
            const activite = activites.find(a => a.id === activityId);

            if (activite) {
                if (currentUser.role === 'eleve') {
                    showActivityDetailsEleve(activite);
                } else {
                    showActivityDetails(activite);
                    highlightActiviteInScheduleProf(activite);
                }
            }
            return;
        }

        // === CARTES D'ACTIVITÉ (CLIC GLOBAL) ===
        // Ne pas ouvrir le modal si le clic vient d'un bouton ou d'un enfant de bouton
        if (card && !btn && !e.target.closest('button, .btn, .seance-btn, .btn-mini, .btn-action')) {
            const activityId = parseInt(card.dataset.activityId);
            const activite = activites.find(a => a.id === activityId);

            if (activite) {
                document.querySelectorAll('.activity-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');

                if (currentUser.role === 'eleve') {
                    showActivityDetailsEleve(activite);
                } else {
                    highlightActiviteInScheduleProf(activite);
                    showActivityDetails(activite);
                }
            }
        }
    });
}

function setupCreationFormEvents() {
    // Trouver le BON container (celui avec class="full" ET qui contient les boutons principaux)
    const btnContainer = document.querySelector('#prof-tab-creation .full:last-of-type');

    if (btnContainer) {
        const buttons = btnContainer.querySelectorAll('.btn:not(.ghost)');

        console.log('Attachement des listeners sur', buttons.length, 'boutons');

        // Premier bouton = Créer/Modifier
        if (buttons[0]) {
            buttons[0].addEventListener('click', (e) => {
                e.preventDefault();
                console.log('>Clic sur bouton principal, editingActivityId =', editingActivityId);
                creerActivite();
            });
            console.log('[OK] Listener attaché au bouton 1 (Créer/Enregistrer)');
        }

        // Deuxième bouton = Reset/Annuler
        if (buttons[1]) {
            buttons[1].addEventListener('click', (e) => {
                e.preventDefault();
                console.log('>Clic sur bouton secondaire, editingActivityId =', editingActivityId);

                if (editingActivityId) {
                    annulerEdition();
                } else {
                    resetForm();
                }
            });
            console.log('[OK] Listener attaché au bouton 2 (Réinitialiser/Annuler)');
        }
    } else {
        console.error('[KO] Container des boutons introuvable !');
    }
}
/* ===========================
    Helpers & Utils
    =========================== */
function $(s){ return document.querySelector(s); }
function $all(s){ return Array.from(document.querySelectorAll(s)); }

function formatDateLocal(str){
    if (!str) return '—';
    try {
        const d = new Date(str); // interprète ISO 8601
        if (isNaN(d)) return str; // fallback si invalide
        return d.toLocaleString('fr-FR', { hour12: false });
    } catch (e) {
        return str;
    }
}

function formatDateInputLocal(date){
    if(!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    const pad = n => n.toString().padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getUserById(id){ return users.find(u=>u.id===Number(id)) || null; }
function getUserName(id){
    const u=getUserById(id);
    return u ? `${u.prenom} ${u.nom||''}` : '—';
}
function getClassById(id){
    return classes.find(c => c.id === Number(id)) || null;
}

function getUserNameWithClass(id) {
    const u = getUserById(id);
    if (!u) return '—';

    let className = '';
    if (u.classe_id) {
        const classe = getClassById(u.classe_id);
        if (classe) {
            className = ` (${classe.nom})`;
        }
    }
    return `${u.prenom} ${u.nom||''}${className}`;
}

function getMonday(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
}

function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    return Math.ceil((((d - yearStart) / 86400000) + 1)/7);
}

/**
 * Retourne la hauteur en pixels d'une case horaire.
 * Miroir exact des valeurs définies dans styles.css / design_tokens.css.
 * C'est la source de vérité JS — modifier ici ET dans le CSS ensemble.
 *
 * Breakpoints CSS -> --hour-height :
 *   base (<480px)  : 35px
 *   480px+         : 40px
 *   768px+         : 50px
 *   1024px+        : 55px
 *   1280px+        : 60px
 */
function getHourHeight() {
    const w = window.innerWidth;
    if (w >= 1280) return 60;
    if (w >= 1024) return 55;
    if (w >= 768)  return 50;
    if (w >= 480)  return 40;
    return 35;
}

const SCHEDULE_START_HOUR = 7;
const SCHEDULE_END_HOUR   = 20; // inclus — label de fin
const SCHEDULE_HOURS      = SCHEDULE_END_HOUR - SCHEDULE_START_HOUR; // 13 tranches

function timeToMinutes(dateTime) {
    const date = new Date(dateTime);
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const baseMinutes = (hours - SCHEDULE_START_HOUR) * 60 + minutes;
    return (baseMinutes / 60) * getHourHeight();
}

/* ===========================
    API helpers
    =========================== */

/** Gère les réponses d'erreur communes (401, 429, autres). */
async function _handleApiError(res) {
    if (res.status === 401) {
        currentUser = null;
        onAuthChange();
        throw new Error('Session expirée');
    }
    if (res.status === 429) {
        await showAlert('Trop de tentatives infructueuses. Veuillez réessayer dans quelques minutes.', 'Limite atteinte');
        throw new Error('Trop de tentatives');
    }
    const errorData = await res.json().catch(() => ({ error: `Erreur HTTP ${res.status}` }));
    throw new Error(errorData.error || `HTTP ${res.status}`);
}

async function apiGet(url) {
    try {
        const res = await fetch(url, {
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        });
        if (!res.ok) await _handleApiError(res);
        return res.json();
    } catch(e) {
        console.error('API GET Error:', e);
        throw e;
    }
}

async function apiPost(url, data) {
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(data)
        });
        if (!res.ok) await _handleApiError(res);
        return res.json();
    } catch(e) {
        console.error('API POST Error:', e);
        throw e;
    }
}

async function apiPut(url, data) {
    try {
        const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(data)
        });
        if (!res.ok) await _handleApiError(res);
        return res.json();
    } catch(e) {
        console.error('API PUT Error:', e);
        throw e;
    }
}

async function apiDelete(url, data) {
    try {
        const res = await fetch(url, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(data)
        });
        if (!res.ok) await _handleApiError(res);
        return res.json();
    } catch(e) {
        console.error('API DELETE Error:', e);
        throw e;
    }
}

/* ===========================
    Authentification
    =========================== */
async function login(){
    const username = $('#username').value.trim();
    const password = $('#password').value.trim();

    if(!username || !password) {
        $('#login-msg').textContent = 'Veuillez remplir tous les champs';
        return;
    }

    try{
        const data = await apiPost('/login', {username,password});

        if(!data.success) {
            $('#login-msg').textContent = data.error || 'Erreur de connexion';
            return;
        }

        // Première connexion élève = redirection vers la page dédiée
        if(data.first_login) {
            window.location.href = `/first-login?uid=${data.user_id}`;
            return;
        }

        currentUser = data;

        $('#login-msg').textContent='';
        $('#username').value='';
        $('#password').value='';
        await fetchAllData();
        onAuthChange();
    } catch(e){
        // Le 429 affiche déjà un showAlert via _handleApiError — pas de doublon dans #login-msg
        if (!e.message.includes('Trop de tentatives')) {
            $('#login-msg').textContent = 'Erreur de connexion : ' + e.message;
        }
    }
}

async function logout(){
    try{
        closeSSE();

        await apiPost('/logout',{});
        currentUser = null;
        onAuthChange();
    } catch(e){
        currentUser = null;
        onAuthChange();
    }
}

async function checkAuthStatus() {
    try {
        const userData = await apiGet('/me');
        if (userData && userData.id) {
            currentUser = userData;
            return true;
        }
    } catch (e) {
        currentUser = null;
    }
    return false;
}

/* ===========================
    Récupération des données
    =========================== */
/**
 * Charge toutes les pages d'un endpoint paginé.
 * Supporte : réponse tableau brut OU { data, has_more, page }
 */
async function _fetchAllPages(url) {
    const first = await apiGet(url).catch(() => ({ data: [] }));
    // Réponse non paginée (tableau brut) -> retour direct
    if (Array.isArray(first)) return first;

    let results = first.data ?? [];
    let page = first.page ?? 1;
    let hasMore = first.has_more ?? false;

    while (hasMore) {
        page++;
        const next = await apiGet(`${url}?page=${page}`).catch(() => ({ data: [], has_more: false }));
        const nextData = Array.isArray(next) ? next : (next.data ?? []);
        results = results.concat(nextData);
        hasMore = Array.isArray(next) ? false : (next.has_more ?? false);
    }

    return results;
}

async function fetchAllData() {
    try {
        if (!currentUser) {
            classes = await apiGet('/classes');
            users = [];
            activites = [];
            groupes = [];
            groupeClasses = [];
            return;
        }

        // Toutes les requêtes en parallèle — plus de cascade séquentielle
        const isStaff = currentUser.role === 'prof' || currentUser.role === 'admin';
        const [
            rawClasses,
            rawUsers,
            rawGroupes,
            rawGroupeClasses,
            rawActivites,
            rawActiviteClasses,
            rawSeances,
        ] = await Promise.all([
            apiGet('/classes'),
            isStaff ? apiGet('/users').catch(() => []) : Promise.resolve([currentUser]),
            apiGet('/groupes').catch(() => []),
            apiGet('/groupe_classes').catch(() => []),
            apiGet('/activites'),
            apiGet('/activite_classes'),
            apiGet('/seances'),
        ]);

        classes       = rawClasses;
        users         = rawUsers;
        groupes       = rawGroupes;
        groupeClasses = rawGroupeClasses;

        // Charger TOUTES les pages d'inscriptions (endpoint paginé)
        const inscriptionsData        = await _fetchAllPages('/inscriptions');
        const inscriptionsSeancesData = await _fetchAllPages('/inscriptions/seances');

        // Enrichir chaque activité
        activites = rawActivites.map(act => {
            act.classe_ids = rawActiviteClasses
                .filter(ac => ac.activite_id === act.id)
                .map(ac => Number(ac.classe_id));

            act.seances = rawSeances
                .filter(s => s.activite_id === act.id)
                .map(s => {
                    const seanceInscriptions = inscriptionsSeancesData
                        .filter(ins => ins.seance_id === s.id)
                        .map(ins => ins.eleve_id);

                    return {
                        id: s.id,
                        date_heure: s.date_heure,
                        duree: s.duree || 60,
                        inscriptions: seanceInscriptions
                    };
                });

            if (!act.separable) {
                act.inscriptions = inscriptionsData
                    .filter(i => i.activite_id === act.id)
                    .map(i => i.eleve_id);
            } else {
                const elevesInscrits = new Set();
                act.seances.forEach(seance => {
                    if (seance.inscriptions) {
                        seance.inscriptions.forEach(eleveId => elevesInscrits.add(eleveId));
                    }
                });
                act.inscriptions = Array.from(elevesInscrits);
            }

            return act;
        });

        // Autorise un recalcul des timers d'ouverture au prochain rendu
        majListeActivitesEleve._timerScheduled = false;

    } catch(e) {
        console.error('Erreur lors du fetch des données:', e);
        if (e.message.includes('Session expirée') || e.message.includes('Non autorisé')) {
            return;
        }
        throw e;
    }
}

/* ===========================
    Mise à jour de l'UI
    =========================== */
function onAuthChange(){
    if(currentUser){
        $('#user-badge').style.display='inline-flex';
        $('#user-name').textContent=`${currentUser.prenom} ${currentUser.nom||''}`;
        $('#logout-btn').classList.remove('hidden');
        const lc = $('#login-card');
        if (lc) { lc.classList.add('hidden'); lc.style.visibility = ''; }
        afficherPageRole(currentUser.role);

        initSSE();
        majVisibiliteTabEchanges();
    } else {
        $('#user-badge').style.display='none';
        $('#logout-btn').classList.add('hidden');
        const lc = $('#login-card');
        if (lc) { lc.classList.remove('hidden'); lc.style.visibility = ''; }
        cacherToutesPages();

        closeSSE();
    }
}

function cacherToutesPages(){
    $('#eleve-page').classList.add('hidden');
    $('#prof-page').classList.add('hidden');
}

function afficherPageRole(role){
    cacherToutesPages();
    if(role==='prof' || role==='admin'){
        $('#prof-page').classList.remove('hidden');
        populateSelects();
        majListeActivitesProf();
        initEmploiDuTempsProf();
        initElevesNonInscrits();
        chargerPendingProcedures();
        setupCreationFormEvents();

    } else if(role==='eleve'){
        $('#eleve-page').classList.remove('hidden');
        majListeActivitesEleve();
        initEmploiDuTempsEleve();
    }
}

function populateSelects(){
    // -- classe-select : InputComp multiselect ------------------
    if (!classeMultiSelect) {
        classeMultiSelect = window._IC_instances?.['classe-select'] || null;
    }

    // Préparer les données pour MultiSelect
    const classesData = classes.map(cl => ({ value: cl.id.toString(), label: cl.nom }));
    // Initialiser MultiSelect
    if (classeMultiSelect) {
        classeMultiSelect.setOptions(classesData);
        classeMultiSelect.clearSelection();
        classeMultiSelect.enable();
        classeMultiSelect.opts.onChange = function() {
                if (isSyncingClasses) return;
                if (classeMultiSelect.selectedItems.length > 0) classeMultiSelect.setError('');
                verifierCoherenceGroupeClasses();
            };
    }

    // InputComp select animateur
    const animComp = window._IC_instances?.['animateur-select'];
    if (animComp) {
        const profs = users.filter(u => u.role === 'prof' || u.role === 'admin');
        animComp.setOptions(profs.map(p => ({
            value: String(p.id),
            label: `${p.prenom} ${p.nom || ''}`.trim()
        })));
        const defaultId = (currentUser && currentUser.role === 'prof') ? currentUser.id : (profs[0]?.id || '');
        if (defaultId) animComp.setValue(String(defaultId));
    }

    // InputComp select groupe
    const groupeComp = window._IC_instances?.['groupe-select'];
    if (groupeComp) {
        groupeComp.setOptions([
            ...groupes.map(g => ({ value: String(g.id), label: g.nom }))
        ]);

        // Écouteur pour synchroniser les classes
        groupeComp.opts.onChange = () => { synchroniserClassesAvecGroupe(); };
    }
}

async function verifierCoherenceGroupeClasses() {
    const groupeComp3 = window._IC_instances?.['groupe-select'];
    if (!groupeComp3 || !groupeComp3.getValue()) return;

    const groupeId = parseInt(groupeComp3.getValue());
    const classesGroupe = groupeClasses
        .filter(gc => gc.groupe_id === groupeId)
        .map(gc => gc.classe_id);

    const classesSelectionnees = classeMultiSelect.selectedItems.map(item => parseInt(item.value));

    // Vérifier que toutes les classes sélectionnées sont dans le groupe
    const classesInvalides = classesSelectionnees.filter(cid => !classesGroupe.includes(cid));

    if (classesInvalides.length > 0) {
        const nomGroupe = groupes.find(g => g.id === groupeId)?.nom || 'ce groupe';
        const nomsClassesInvalides = classesInvalides
            .map(cid => classes.find(c => c.id === cid)?.nom)
            .join(', ');

        await showAlert(`[WARN] Incohérence détectée !\n\nLes classes suivantes ne font pas partie du groupe "${nomGroupe}" :\n${nomsClassesInvalides}\n\nVeuillez ajuster votre sélection.`);

        // Désélectionner les classes invalides
        classesInvalides.forEach(cid => {
            classeMultiSelect.unselect(cid.toString());
        });
    }
}

function synchroniserClassesAvecGroupe() {
    const groupeComp2 = window._IC_instances?.['groupe-select'];
    if (!groupeComp2 || !classeMultiSelect) return;

    const groupeId = groupeComp2.getValue();

    if(!groupeId) {
        // Aucun groupe sélectionné : réactiver le MultiSelect
        classeMultiSelect.enable();
        isSyncingClasses = true;
        // déselectionner toutes les classes
        classeMultiSelect.selectedItems.forEach(item => {
            classeMultiSelect.unselect(item.value);
        });
        isSyncingClasses= false;
        return;
    }

    // Un groupe est sélectionné : syncroniser puis désactiver
    const groupeIdInt = parseInt(groupeId);
    const classesGroupe = groupeClasses
        .filter(gc => gc.groupe_id === groupeIdInt)
        .map(gc => gc.classe_id.toString());

    // activer avant de modifier la sélection
    classeMultiSelect.enable();
    isSyncingClasses = true;

    // vider l'ancienne sélection
    classeMultiSelect.selectedItems.forEach(item => {
        classeMultiSelect.unselect(item.value);
    });

    // Sélectionner uniquement les classes du groupe
    classesGroupe.forEach(cid => {
        classeMultiSelect.select(cid.toString());
    });

    isSyncingClasses = false;
    // Désactive apreès la syncro
    classeMultiSelect.disable();
}


/* ===========================
    GESTION DES BOUTONS CRÉATION/ÉDITION
    =========================== */
function passerEnModeEdition() {
    console.log('> Passage en mode édition');

    // Modifier le titre
    const title = document.querySelector('#prof-tab-creation h4');
    if (title) {
        const activite = activites.find(a => a.id === editingActivityId);
        title.innerHTML = `Modifier l'activité "<span class="text-primary">${activite?.titre || ''}</span>"`;
    }

    // Trouver le container avec les VRAIS boutons Créer/Réinitialiser
    const btnContainer = document.querySelector('#prof-tab-creation .full:last-of-type');
    if (!btnContainer) {
        console.error('[KO] Container des boutons introuvable');
        return;
    }

    // Sélectionner les boutons DANS ce container spécifique
    const buttons = btnContainer.querySelectorAll('.btn:not(.ghost)');
    console.log('- Boutons trouvés:', buttons.length);

    // Premier bouton = Créer --> Enregistrer
    const btnCreate = buttons[0];
    if (btnCreate) {
        btnCreate.innerHTML = `
            <svg class="icon" viewBox="0 0 24 24">
                <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" fill="currentColor"/>
            </svg>
            Enregistrer les modifications
        `;
        console.log('[OK] Bouton Créer modifié');
    }

    // Deuxième bouton = Réinitialiser --> Annuler
    const btnReset = buttons[1];
    if (btnReset) {
        btnReset.className = 'btn secondary btn-cancel-edit';
        btnReset.innerHTML = `
            <svg class="icon" viewBox="0 0 24 24">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>
            </svg>
            Annuler l'édition
        `;
        console.log('[OK] Bouton Réinitialiser modifié');
    }

    // Désactiver le checkbox séparable
    const separableCheckbox = $('#separable');
    if (separableCheckbox) {
        separableCheckbox.disabled = true;
        separableCheckbox.classList.add('disabled-field');

        const label = document.querySelector('label[for="separable"]');
        if (label) {
            label.classList.add('disabled-label');
            label.title = '[WARN] Le type (sécable/non-sécable) ne peut pas être modifié';
        }
    }

    console.log('[OK] Mode édition activé');
}

function passerEnModeCreation() {
    console.log('> Passage en mode création');

    // Réinitialiser le titre
    const title = document.querySelector('#prof-tab-creation h4');
    if (title) {
        title.textContent = 'Créer une nouvelle activité';
    }

    // Trouver le container avec les VRAIS boutons
    const btnContainer = document.querySelector('#prof-tab-creation .full:last-of-type');
    if (!btnContainer) {
        console.error('[KO] Container des boutons introuvable');
        return;
    }

    const buttons = btnContainer.querySelectorAll('.btn:not(.ghost)');

    // Restaurer le bouton Créer
    const btnCreate = buttons[0];
    if (btnCreate) {
        btnCreate.innerHTML = `Créer l'activité`;
        console.log('[OK] Bouton Créer restauré');
    }

    // Restaurer le bouton Réinitialiser
    const btnReset = buttons[1];
    if (btnReset) {
        btnReset.className = 'btn secondary';
        btnReset.innerHTML = `Réinitialiser`;
        console.log('[OK] Bouton Réinitialiser restauré');
    }

    // Réactiver le checkbox séparable
    const separableCheckbox = $('#separable');
    if (separableCheckbox) {
        separableCheckbox.disabled = false;
        separableCheckbox.classList.remove('disabled-field');

        const label = document.querySelector('label[for="separable"]');
        if (label) {
            label.classList.remove('disabled-label');
            label.title = '';
        }
    }

    console.log('[OK] Mode création restauré');
}

/* ===========================
    NOUVELLE FONCTIONNALITÉ: Élèves non inscrits
    =========================== */
function initElevesNonInscrits() {
    const groupeFilterComp = window._IC_instances?.['groupe-filter-select'];
    if (!groupeFilterComp) return;

    const userId = currentUser.id;
    let groupesProf;
    if (currentUser.role === 'admin') {
        groupesProf = groupes; // Tous les groupes pour l'admin
    } else {
        // Pour les profs, filtrer comme avant
        // Récupérer toutes les activités du prof (créées OU animées)
        const activitesProf = activites.filter(a =>
        a.prof_id === userId || a.animateur_id === userId
        );

        // Extraire les groupes uniques de ces activités
        const groupeIds = [...new Set(
            activitesProf.filter(a => a.groupe_id != null).map(a => a.groupe_id)
        )];

        // Filtrer les groupes correspondants
        groupesProf = groupes.filter(g => groupeIds.includes(g.id));
    }

    const msgNoGroupe = $('#msg-no-groupe');
    // Remplir le sélecteur de groupes UNIQUEMENT avec les groupes du prof
    if (groupesProf.length === 0) {
        groupeFilterComp.setOptions([{ value: '', label: 'Aucun groupe disponible' }]);
        groupeFilterComp.disable();
        if (msgNoGroupe) {
            msgNoGroupe.textContent = "Aucune de vos activités n\'est associée à un groupe";
            msgNoGroupe.style.display = 'block';
        }
    } else {
        groupeFilterComp.setOptions([
            ...groupesProf.map(g => ({ value: String(g.id), label: g.nom }))
        ]);
        groupeFilterComp.enable();
        if (msgNoGroupe) {
            msgNoGroupe.textContent = 'Sélectionnez un groupe pour voir les élèves non inscrits';
            msgNoGroupe.style.display = 'block';
        }
    }
    console.log(`[OK] ${groupesProf.length} groupe(s) disponible(s) pour le prof`);

    // Écouteur de changement
    groupeFilterComp.opts.onChange = (groupeId) => {
        if (groupeId) {
            chargerElevesNonInscrits(groupeId);
        } else {
            const container = $('#liste-eleves-non-inscrits');
            if (container) container.innerHTML = '';
            if (msgNoGroupe) msgNoGroupe.style.display = 'block';
        }
    };
}

async function chargerElevesNonInscrits(groupeId) {
    try {
        $('#msg-no-groupe').style.display = 'none';
        const container = $('#liste-eleves-non-inscrits');
        if (!container) return;

        container.innerHTML = '<p class="muted small text-center">Chargement...</p>';

        const data = await apiGet(`/groupes/${groupeId}/eleves-non-inscrits`);

        if (!data.eleves || data.eleves.length === 0) {
            container.innerHTML = '<p class="muted small text-center p-12">✓ Tous les élèves sont inscrits !</p>';
            return;
        }

        container.innerHTML = `
            <div class="warning-banner">
                <strong>⚠️ ${data.eleves.length} élève(s) non inscrit(s)</strong>
            </div>
        `;

        data.eleves.forEach(eleve => {
            const eleveDiv = document.createElement('div');
            eleveDiv.className = 'eleve-non-inscrit-item';

            let mailInfo = '';
            if (eleve.dernier_mail) {
                mailInfo = `<div class="eleve-non-inscrit-mail-info">✉️ Mail envoyé le ${formatDateLocal(eleve.dernier_mail)}</div>`;
            }

            eleveDiv.innerHTML = `
                <div class="eleve-non-inscrit-info">
                    <div class="eleve-non-inscrit-nom">${eleve.prenom} ${eleve.nom}</div>
                    <div class="eleve-non-inscrit-classe">${eleve.classe_nom || 'Sans classe'}</div>
                    ${mailInfo}
                </div>
                <div class="flex gap-8">
                    <button class="btn-inscription-manuelle"
                            data-eleve-id="${eleve.id}"
                            data-groupe-id="${groupeId}"
                            title="Inscrire manuellement">
                        Inscrire
                    </button>
                    <button class="btn-rappel"
                            data-groupe-id="${groupeId}"
                            data-eleve-id="${eleve.id}"
                            ${!eleve.email ? 'disabled title="Pas d\'email"' : ''}>
                        📧 Rappel
                    </button>
                </div>
            `;

            container.appendChild(eleveDiv);
        });

    } catch(e) {
        console.error('Erreur chargement élèves non inscrits:', e);
        const container = $('#liste-eleves-non-inscrits');
        if (container) {
            container.innerHTML = '<p class="muted small text-error p-12">Erreur lors du chargement</p>';
        }
    }
}

async function envoyerRappelInscription(groupeId, eleveId, btn) {
    if (!await showConfirm('Envoyer un mail de rappel à cet élève ?')) return;

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Envoi...';

    try {
        await apiPost(`/groupes/${groupeId}/rappel-inscription`, { eleve_id: eleveId });
        btn.textContent = '✓ Envoyé';
        btn.classList.add('btn-sent');

        setTimeout(() => {
            chargerElevesNonInscrits(groupeId);
        }, 2000);
    } catch(e) {
        await showAlert('Erreur: ' + e.message);
        btn.disabled = false;
        btn.textContent = originalText;
    }
}


async function ouvrirModalInscriptionManuelle(eleveId, groupeId) {
    try {
        const eleve = getUserById(eleveId);
        if (!eleve) {
            await showAlert('Élève introuvable');
            return;
        }

        // Récupérer les activités du groupe
        const activitesGroupe = activites.filter(a => a.groupe_id === groupeId);

        if (activitesGroupe.length === 0) {
            await showAlert('Aucune activité dans ce groupe');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'modal-overlay visible';
        modal.id = 'inscription-manuelle-modal';

        let activitesHtml = '';

        activitesGroupe.forEach(act => {
            const inscritsCount = getInscritsCount(act);
            const classesText = act.classe_ids
                .map(id => classes.find(c => c.id === id)?.nom || '')
                .join(', ');

            const animateurNom = act.animateur_prenom && act.animateur_nom
                ? `${act.animateur_prenom} ${act.animateur_nom}`
                : 'Animateur non défini';

            activitesHtml += `
                <div class="activity-card inscription-manuelle-card">
                    <div class="activity-card-header">
                        <h5 class="activity-title">${act.titre}</h5>
                        <span class="activity-room">${act.salle}</span>
                    </div>
                    <div class="activity-details mb-4">
                        👤 ${animateurNom}
                    </div>
                    <div class="activity-details">
                        Classes: ${classesText}
                    </div>
                    <div class="activity-details">
                        <strong>${inscritsCount}/${act.effectif_max}</strong> inscrit${inscritsCount > 1 ? 's' : ''}
                    </div>
                    <div class="activity-meta mb-8">
                        ${act.seances?.length || 0} séance(s) • ${act.separable ? 'Sécable' : 'Non sécable'}
                    </div>
                    <div class="activity-actions">
                        <button class="btn-action inscrire"
                                data-eleve-id="${eleveId}"
                                data-activite-id="${act.id}">
                            <svg viewBox="0 0 24 24" class="icon-inline">
                                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                            </svg>
                            Inscrire manuellement
                        </button>
                    </div>
                </div>
            `;
        });

        modal.innerHTML = `
            <div class="modal-content modal-large">
                <div class="modal-header">
                    <h3>Inscrire ${eleve.prenom} ${eleve.nom}</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <p class="muted mb-16">
                        Choisissez une activité du groupe pour inscrire cet élève :
                    </p>
                    <div class="inscription-manuelle-grid">
                        ${activitesHtml}
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Gestionnaire pour les boutons inscrire
        modal.addEventListener('click', async (e) => {
            const btn = e.target.closest('.btn-action.inscrire');
            if (btn) {
                e.stopPropagation();
                const eleveId = parseInt(btn.dataset.eleveId);
                const activiteId = parseInt(btn.dataset.activiteId);
                await inscrireManuel(eleveId, activiteId);
            }

            // Fermer au clic sur la croix
            const closeBtn = e.target.closest('.modal-close');
            if (closeBtn) {
                fermerModalInscriptionManuelle();
            }

            // Fermer au clic extérieur
            if (e.target.classList.contains('modal-overlay')) {
                fermerModalInscriptionManuelle();
            }
        });

    } catch(e) {
        console.error('Erreur modal inscription manuelle:', e);
        await showAlert('Erreur lors de l\'ouverture du modal');
    }
}

function fermerModalInscriptionManuelle() {
    const modal = document.getElementById('inscription-manuelle-modal');
    if (modal) {
        modal.remove();
    }
}

async function inscrireManuel(eleveId, activiteId) {
    const eleve = getUserById(eleveId);
    const activite = activites.find(a => a.id === activiteId);

    if (!eleve || !activite) {
        await showAlert('Données introuvables');
        return;
    }

    const message = `Confirmer l'inscription de ${eleve.prenom} ${eleve.nom} à "${activite.titre}" ?`;

    if (!await showConfirm(message)) return;

    try {
        await apiPost('/inscriptions/manuel', {
            eleve_id: eleveId,
            activite_id: activiteId
        });

        await fetchAllData();
        fermerModalInscriptionManuelle();

        // Rafraîchir la liste des élèves non inscrits
        { const gfv = icGet('groupe-filter-select'); if (gfv) chargerElevesNonInscrits(gfv); }

        // Rafraîchir les listes et emploi du temps
        majListeActivitesProf();
        updateScheduleViewProf();

        console.log('[SSE] [OK] Élève inscrit avec succès');
        // SSE va broadcaster aux autres sessions
        showToast('Élève inscrit avec succès !');

    } catch(e) {
        await showAlert('Erreur lors de l\'inscription : ' + e.message);
    }
}

/* ===========================
    Interface Élève
    =========================== */

// Timers pour rafraîchir automatiquement quand une période d'inscription ouvre
let inscriptionOpenTimers = [];

function clearInscriptionOpenTimers() {
    inscriptionOpenTimers.forEach(t => clearTimeout(t));
    inscriptionOpenTimers = [];
}

function scheduleInscriptionOpenTimers() {
    clearInscriptionOpenTimers();
    if (!currentUser || currentUser.role !== 'eleve') return;

    const now = nowServer();
    const classeId = Number(currentUser.classe_id);

    activites.forEach(act => {
        if (!act.classe_ids.includes(classeId)) return;
        const ouverture = new Date(act.date_ouverture_inscriptions);
        const delay = ouverture - now;

        // Si la période d'inscription ouvre dans le futur (max 24h pour éviter des timers trop lointains)
        if (delay > 0 && delay < 24 * 60 * 60 * 1000) {
            console.log(`[Timer] Rafraîchissement prévu dans ${Math.round(delay/1000)}s pour "${act.titre}"`);
            const t = setTimeout(() => {
                console.log(`[Timer] Période d'inscription ouverte pour "${act.titre}", rafraîchissement...`);
                majListeActivitesEleve();
            }, delay);
            inscriptionOpenTimers.push(t);
        }
    });
}

function majListeActivitesEleve() {
    const container = $('#liste-activites-eleve');
    if (!container) return;

    // Sauvegarder l'état ouvert/fermé des groupes avant de re-rendre
    const etatGroupes = {};
    container.querySelectorAll('details[data-groupe-nom]').forEach(d => {
        etatGroupes[d.dataset.groupeNom] = d.open;
    });

    container.innerHTML = '';

    if(!currentUser) return;

    const classeId = Number(currentUser.classe_id);
    if(!classeId || isNaN(classeId)) {
        container.innerHTML = '<p class="muted text-center p-20">Classe non définie</p>';
        return;
    }

    const now = nowServer();
    let totalAct = 0, totalIns = 0;

    // Filtrer activités pour cette classe
    const activitesEleve = activites.filter(act => {
        // Mauvaise classe = activitées masquées
        if(!act.classe_ids.includes(classeId)) return false;

        const ouverture = new Date(act.date_ouverture_inscriptions);
        const fermeture = new Date(act.date_fermeture_inscriptions);

        // Pas encore visible (visible_avant désactivé et période pas ouverte)
        if(!(act.visible_avant*1) && now < ouverture) return false;

        // Masquer si période fermée ET toutes les séances sont passées
        const allPassed = (act.seances || []).every(s => new Date(s.date_heure) < now);
        if(now > fermeture && allPassed) return false;

        return true;
    });

    if (activitesEleve.length === 0) {
        container.innerHTML = '<p class="muted text-center p-20">Aucune activité disponible</p>';
        $('#stat-act-eleve').textContent = '0';
        $('#stat-insc-eleve').textContent = '0';
        return;
    }

    // Organiser les activités par groupe
    const activitesParGroupe = {};

    activitesEleve.forEach(act => {
        const groupeId = act.groupe_id;

        if (groupeId) {
            // Activité avec groupe
            const groupe = groupes.find(g => g.id === groupeId);
            const groupeNom = groupe ? groupe.nom : `Groupe #${groupeId}`;

            if (!activitesParGroupe[groupeNom]) {
                activitesParGroupe[groupeNom] = [];
            }
            activitesParGroupe[groupeNom].push(act);
        } else {
            // Activité sans groupe -> DIVERS
            if (!activitesParGroupe['DIVERS']) {
                activitesParGroupe['DIVERS'] = [];
            }
            activitesParGroupe['DIVERS'].push(act);
        }
    });

    // Trier les noms de groupes : alphabétique, puis DIVERS en dernier
    const nomsGroupes = Object.keys(activitesParGroupe).sort((a, b) => {
        if (a === 'DIVERS') return 1;
        if (b === 'DIVERS') return -1;
        return a.localeCompare(b);
    });

    // Trier les activités dans chaque groupe par ordre alphabétique de titre
    Object.keys(activitesParGroupe).forEach(groupeNom => {
        activitesParGroupe[groupeNom].sort((a, b) => a.titre.localeCompare(b.titre));
    });

    // Créer les menus déroulants par groupe
    nomsGroupes.forEach(groupeNom => {
        const activitesGroupe = activitesParGroupe[groupeNom];

        // Créer le conteneur details
        const detailsEl = document.createElement('details');
        detailsEl.className = 'panel-collapsible mt-16';
        detailsEl.dataset.groupeNom = groupeNom;
        // Restaurer l'état si connu, sinon replié par défaut
        detailsEl.open = groupeNom in etatGroupes ? etatGroupes[groupeNom] : false;

        // Header du groupe
        const summary = document.createElement('summary');
        summary.className = 'panel-header';

        const icone = groupeNom === 'DIVERS'
            ? `<svg viewBox="0 0 24 24" class="w-16 h-16 svg-fill-current mr-8">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
               </svg>`
            : `<svg viewBox="0 0 24 24" class="w-16 h-16 svg-fill-current mr-8">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/>
                <circle cx="12" cy="12" r="6" stroke="currentColor" stroke-width="2" fill="none"/>
                <circle cx="12" cy="12" r="2" fill="currentColor"/>
               </svg>`;

        summary.innerHTML = `<h4>${icone}${groupeNom} (${activitesGroupe.length})</h4>`;
        detailsEl.appendChild(summary);

        // Conteneur des activités
        const contentDiv = document.createElement('div');
        contentDiv.className = 'panel-content';

        activitesGroupe.forEach(act => {
            totalAct++;

            const inscritsCount = getInscritsCount(act);

            const classesText = act.classe_ids
                .map(id => classes.find(c => c.id === id)?.nom || '')
                .join(', ');

            let inscriptionsEleve = false;

            if (act.separable) {
                inscriptionsEleve = act.seances.some(seance =>
                    seance.inscriptions?.includes(currentUser.id)
                );
            } else {
                inscriptionsEleve = act.inscriptions?.includes(currentUser.id) || false;
            }

            if(inscriptionsEleve) totalIns++;

            const actCard = document.createElement('div');
            actCard.className = 'activity-card' + (inscriptionsEleve ? ' selected inscrit' : '');
            actCard.dataset.activityId = act.id;  // FIX doublons: id unique pour majComptesActivitesEleve

            const animateurNom = act.animateur_prenom && act.animateur_nom
                ? `${act.animateur_prenom} ${act.animateur_nom}`
                : 'Animateur non défini';

            actCard.innerHTML = `
                <div class="activity-card-header">
                    <h5 class="activity-title">${act.titre}</h5>
                    <span class="activity-room">${act.salle}</span>
                    ${inscriptionsEleve ? '<span class="seance-status inscrit">\u2713 Inscrit(e)</span>' : ''}
                </div>
                <div class="activity-details small muted mb-1">
                    👤 ${animateurNom}
                </div>
                <div class="activity-details">Classes: ${classesText}</div>
                <div class="activity-details" data-inscrits-counter>
                    ${act.separable
                        ? `Inscriptions : ${inscritsCount} élève${inscritsCount > 1 ? 's' : ''} (effectif max par séance: ${act.effectif_max})`
                        : `<strong>${inscritsCount}/${act.effectif_max}</strong> inscrit${inscritsCount > 1 ? 's' : ''}`
                    }
                </div>
                <div class="activity-meta">
                    ${act.seances?.length || 0} séance(s) • ${act.separable ? 'Sécable' : 'Non sécable'}
                </div>
                ${act.separable ? '<div class="activity-seances" id="seances-' + act.id + '"></div>' : ''}
            `;

            const ouverture = new Date(act.date_ouverture_inscriptions);
            const fermeture = new Date(act.date_fermeture_inscriptions);
            const inscriptionsOuvertes = now >= ouverture && now <= fermeture;

            if (act.separable) {
                const seancesContainer = actCard.querySelector('.activity-seances');
                act.seances?.forEach(seance => {
                    const seanceDate = new Date(seance.date_heure);
                    const seancePassee = seanceDate < now;

                    const seanceItem = document.createElement('div');
                    seanceItem.className = 'seance-item-eleve';

                    const dateSpan = document.createElement('span');
                    dateSpan.className = 'seance-date';
                    dateSpan.textContent = formatDateLocal(seance.date_heure);

                    const inscritsSeance = getInscritsCount(act);
                    const effectifInfo = document.createElement('span');
                    effectifInfo.className = 'seance-effectif';
                    effectifInfo.textContent = `${inscritsSeance}/${act.effectif_max}`;
                    effectifInfo.classList.toggle('seance-effectif--full', inscritsSeance >= act.effectif_max);

                    const btn = document.createElement('button');
                    btn.className = 'seance-btn';
                    btn.dataset.seanceId = seance.id;

                    const estInscritSeance = seance.inscriptions?.includes(currentUser.id) || false;

                    if (seancePassee) {
                        btn.textContent = 'Passée';
                        btn.className += ' ferme';
                        btn.disabled = true;
                    } else if (!inscriptionsOuvertes) {
                        btn.textContent = 'Fermée';
                        btn.className += ' ferme';
                        btn.disabled = true;
                    } else if (estInscritSeance) {
                        btn.textContent = 'Inscrit ✓';
                        btn.className += ' inscrit';
                        btn.dataset.action = 'desinscrire';
                    } else if (inscritsSeance >= act.effectif_max) {
                        btn.textContent = 'Complète';
                        btn.className += ' ferme';
                        btn.disabled = true;
                    } else {
                        btn.textContent = 'S\'inscrire';
                        btn.className += ' libre';
                        btn.dataset.action = 'inscrire';
                    }

                    seanceItem.appendChild(dateSpan);
                    seanceItem.appendChild(effectifInfo);
                    seanceItem.appendChild(btn);
                    seancesContainer.appendChild(seanceItem);
                });
            } else {
                const btnContainer = document.createElement('div');
                btnContainer.className = 'seance-btn-container';

                const btn = document.createElement('button');
                btn.className = 'btn btn--full';

                if (!inscriptionsOuvertes) {
                    btn.textContent = 'Inscriptions fermées';
                    btn.disabled = true;
                    btn.classList.add('ghost');
                } else if (inscriptionsEleve) {
                    btn.textContent = 'Se désinscrire (toutes séances)';
                    btn.classList.add('secondary');
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        desinscrireActivite(act.id);
                    };
                } else if (inscritsCount >= act.effectif_max) {
                    btn.textContent = 'Activité complète';
                    btn.disabled = true;
                    btn.classList.add('ghost');
                } else {
                    btn.textContent = "S'inscrire (toutes séances)";
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        inscrireActivite(act.id);
                    };
                }

                btnContainer.appendChild(btn);
                actCard.appendChild(btnContainer);
            }

            actCard.addEventListener('click', (e) => {
                if (!e.target.closest('button')) {
                    showActivityDetailsEleve(act);
                }
            });

            contentDiv.appendChild(actCard);
        });

        detailsEl.appendChild(contentDiv);
        container.appendChild(detailsEl);
    });

    $('#stat-act-eleve').textContent = totalAct;
    $('#stat-insc-eleve').textContent = totalIns;
    // Ne replanifie les timers qu'une seule fois par fetchAllData, pas à chaque inscription/désinscription
    if (!majListeActivitesEleve._timerScheduled) {
        majListeActivitesEleve._timerScheduled = true;
        scheduleInscriptionOpenTimers();
    }
}

/**
 * Mise à jour légère : ne rafraîchit que les compteurs d'inscrits
 * et les boutons d'inscription, sans recréer tout le DOM.
 * Utilisée par le SSE pour éviter de réinitialiser les sliders.
 */
function majComptesActivitesEleve() {
    const now = nowServer();
    const classeId = Number(currentUser?.classe_id);
    if (!classeId || isNaN(classeId)) return;

    let needsFullRender = false;

    // Vérifier si une activité vient de devenir inscriptible (période qui vient d'ouvrir)
    activites.forEach(act => {
        if (!act.classe_ids.includes(classeId)) return;
        const ouverture = new Date(act.date_ouverture_inscriptions);
        // Si la période vient d'ouvrir (dans les 10 dernières secondes) -> re-render complet
        if (ouverture <= now && (now - ouverture) < 10000) {
            needsFullRender = true;
        }
    });

    if (needsFullRender) {
        majListeActivitesEleve();
        return;
    }

    // Mettre à jour les compteurs activity-details et boutons existants
    activites.forEach(act => {
        if (!act.classe_ids.includes(classeId)) return;

        const ouverture = new Date(act.date_ouverture_inscriptions);
        const fermeture = new Date(act.date_fermeture_inscriptions);
        const inscriptionsOuvertes = now >= ouverture && now <= fermeture;
        const inscritsCount = getInscritsCount(act);

        // FIX doublons : chercher directement par data-activity-id (majListeActivitesEleve le définit maintenant)
        const card = document.querySelector(`#liste-activites-eleve .activity-card[data-activity-id="${act.id}"]`);
        if (!card) return; // card absente = activité non visible

        {
                // Mettre à jour le compteur inscrits via data-inscrits-counter (évite les doublons)
                const counter = card.querySelector('[data-inscrits-counter]');
                if (counter) {
                    if (act.separable) {
                        counter.innerHTML = `Inscriptions : ${inscritsCount} élève${inscritsCount > 1 ? 's' : ''} (effectif max par séance: ${act.effectif_max})`;
                    } else {
                        counter.innerHTML = `<strong>${inscritsCount}/${act.effectif_max}</strong> inscrit${inscritsCount > 1 ? 's' : ''}`;
                    }
                }

                // Mettre à jour le badge "Inscrit(e)" dans le header de la card (non-séparable)
                if (!act.separable) {
                    const isInscrit = act.inscriptions?.includes(currentUser.id);
                    card.classList.toggle('selected', isInscrit);
                    card.classList.toggle('inscrit', isInscrit);
                    const header = card.querySelector('.activity-card-header');
                    if (header) {
                        let badge = header.querySelector('.seance-status.inscrit');
                        if (isInscrit && !badge) {
                            badge = document.createElement('span');
                            badge.className = 'seance-status inscrit';
                            badge.textContent = '✓ Inscrit(e)';
                            header.appendChild(badge);
                        } else if (!isInscrit && badge) {
                            badge.remove();
                        }
                    }
                    // Mettre à jour le bouton d'inscription non-séparable
                    const btn = card.querySelector('.btn:not(.ghost)');
                    if (btn && inscriptionsOuvertes) {
                        if (isInscrit) {
                            btn.textContent = 'Se désinscrire (toutes séances)';
                            btn.classList.remove('ghost');
                            btn.classList.add('secondary');
                            btn.disabled = false;
                            btn.onclick = (e) => { e.stopPropagation(); desinscrireActivite(act.id); };
                        } else if (inscritsCount >= act.effectif_max) {
                            btn.textContent = 'Activité complète';
                            btn.disabled = true;
                            btn.classList.add('ghost');
                        } else {
                            btn.textContent = "S'inscrire (toutes séances)";
                            btn.classList.remove('secondary', 'ghost');
                            btn.disabled = false;
                            btn.onclick = (e) => { e.stopPropagation(); inscrireActivite(act.id); };
                        }
                    }
                }

                // Mettre à jour la classe inscrit sur la card (séparable)
                if (act.separable) {
                    const isInscritSeparable = act.seances?.some(s => s.inscriptions?.includes(currentUser.id));
                    card.classList.toggle('inscrit', !!isInscritSeparable);
                }

                // Mettre à jour les compteurs et boutons par séance (separable)
                if (act.separable) {
                    act.seances?.forEach(seance => {
                        const inscritsSeance = getInscritsCount(act);
                        const estInscritSeance = seance.inscriptions?.includes(currentUser.id) || false;
                        const items = card.querySelectorAll('.seance-item-eleve');
                        // Match par data-seance-id sur le bouton (plus fiable que le texte de date)
                        items.forEach(item => {
                            const btn = item.querySelector('.seance-btn[data-seance-id]');
                            if (btn && parseInt(btn.dataset.seanceId) === seance.id) {
                                // Mettre à jour le compteur effectif
                                const effectifSpan = item.querySelector('.seance-effectif');
                                if (effectifSpan) {
                                    effectifSpan.textContent = `${inscritsSeance}/${act.effectif_max}`;
                                    effectifSpan.classList.toggle('seance-effectif--full', inscritsSeance >= act.effectif_max);
                                }
                                // Mettre à jour l'état du bouton (si la séance n'est pas passée/fermée)
                                if (!btn.disabled || btn.classList.contains('inscrit') || btn.classList.contains('libre')) {
                                    const seanceDate = new Date(seance.date_heure);
                                    const seancePassee = seanceDate < now;
                                    if (!seancePassee && inscriptionsOuvertes) {
                                        if (estInscritSeance) {
                                            btn.textContent = 'Inscrit ✓';
                                            btn.className = 'seance-btn inscrit';
                                            btn.dataset.action = 'desinscrire';
                                            btn.disabled = false;
                                        } else if (inscritsSeance >= act.effectif_max) {
                                            btn.textContent = 'Complète';
                                            btn.className = 'seance-btn ferme';
                                            btn.disabled = true;
                                            delete btn.dataset.action;
                                        } else {
                                            btn.textContent = "S'inscrire";
                                            btn.className = 'seance-btn libre';
                                            btn.dataset.action = 'inscrire';
                                            btn.disabled = false;
                                        }
                                    }
                                }
                            }
                        });
                    });
                }
            }
    });

    // Mettre à jour les stats globales
    let totalAct = 0, totalIns = 0;
    activites.forEach(act => {
        if (!act.classe_ids.includes(classeId)) return;
        const ouverture = new Date(act.date_ouverture_inscriptions);
        const fermeture = new Date(act.date_fermeture_inscriptions);
        if (!(act.visible_avant*1) && now < ouverture) return;
        const allPassed = (act.seances || []).every(s => new Date(s.date_heure) < now);
        if (now > fermeture && allPassed) return;
        totalAct++;
        const inscrit = act.separable
            ? act.seances?.some(s => s.inscriptions?.includes(currentUser.id))
            : act.inscriptions?.includes(currentUser.id);
        if (inscrit) totalIns++;
    });
    $('#stat-act-eleve').textContent = totalAct;
    $('#stat-insc-eleve').textContent = totalIns;
}

function fixShowActivityDetailsEleve() {
    // Cette fonction doit être appelée après la génération du HTML du modal
    // pour remplacer les attributs onclick par des événements

    const modalBody = document.getElementById('modal-body');
    if (!modalBody) return;

    // Trouver tous les boutons avec onclick dans le modal
    const buttonsWithOnclick = modalBody.querySelectorAll('button[onclick]');

    buttonsWithOnclick.forEach(btn => {
        const onclickAttr = btn.getAttribute('onclick');
        btn.removeAttribute('onclick');

        // Parser l'attribut onclick pour extraire la fonction et les paramètres
        const match = onclickAttr.match(/(inscrireSeance|desinscrireSeance)\((\d+)\)/);
        if (match) {
            const funcName = match[1];
            const seanceId = parseInt(match[2]);

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (funcName === 'inscrireSeance') {
                    inscrireSeance(seanceId);
                } else if (funcName === 'desinscrireSeance') {
                    desinscrireSeance(seanceId);
                }
            });
        }
    });
}

function showActivityDetailsEleve(activite) {
    const modal = $('#activity-modal');
    const title = $('#modal-title');
    const body = $('#modal-body');

    // Enregistrer quelle activité est ouverte pour que les handlers SSE
    // rafraîchissent uniquement ce modal et non celui d'une autre activité.
    _currentModalActivityId = activite.id;

    title.textContent = activite.titre;

    const classesText = activite.classe_ids
        .map(id => classes.find(c => c.id === id)?.nom || '')
        .join(', ');

    const animateur = activite.animateur_prenom && activite.animateur_nom
        ? `${activite.animateur_prenom} ${activite.animateur_nom}`
        : 'Animateur non défini';

    const now = nowServer();
    const ouverture = new Date(activite.date_ouverture_inscriptions);
    const fermeture = new Date(activite.date_fermeture_inscriptions);
    const inscriptionsOuvertes = now >= ouverture && now <= fermeture;

    // Construction de l'affichage des séances
    let seancesHtml = '<div class="detail-value">';

    if (activite.seances && activite.seances.length > 0) {
        activite.seances.forEach(seance => {
            const seanceDate = new Date(seance.date_heure);
            const seanceDateStr = formatDateLocal(seance.date_heure);
            const seancePassee = seanceDate < now;

            // Vérifier si l'élève est inscrit à CETTE séance
            let estInscritSeance = false;
            if (activite.separable) {
                estInscritSeance = seance.inscriptions?.includes(currentUser.id) || false;
            } else {
                estInscritSeance = activite.inscriptions?.includes(currentUser.id) || false;
            }

            // Compter les inscrits pour cette séance
            const inscritsSeance = getSeanceInscritsCount(seance);
            const seanceComplete = inscritsSeance >= activite.effectif_max;

            // Définir le statut et le style
            let statutBadge = '';
            let btnAction = '';

            if (seancePassee) {
                statutBadge = '<span class="seance-status past">Passée</span>';
            } else if (!inscriptionsOuvertes) {
                statutBadge = '<span class="seance-status closed">Inscriptions fermées</span>';
            } else if (estInscritSeance) {
                statutBadge = '<span class="seance-status inscrit">✓ Inscrit(e)</span>';
                if (activite.separable) {
                    btnAction = `<button class="btn-mini secondary" data-action="desinscrire" data-seance-id="${seance.id}">Se désinscrire</button>`;
                }
            } else if (seanceComplete) {
                statutBadge = '<span class="seance-status full">Complète</span>';
            } else {
                statutBadge = '<span class="seance-status available">Places disponibles</span>';
                if (activite.separable) {
                    btnAction = `<button class="btn-mini primary" data-action="inscrire" data-seance-id="${seance.id}">S'inscrire</button>`;
                }
            }

            seancesHtml += `
                <div class="seance-detail-item-eleve ${estInscritSeance ? 'inscrit' : ''}">
                    <div class="seance-detail-info">
                        <div class="seance-detail-date">📅 ${seanceDateStr}</div>
                        <div class="seance-detail-count">${inscritsSeance}/${activite.effectif_max} inscrit(s)</div>
                    </div>
                    <div class="seance-action-container">
                        ${statutBadge}
                        ${btnAction}
                    </div>
                </div>
            `;
        });
    } else {
        seancesHtml += '<div class="inscription-item muted">Aucune séance</div>';
    }

    seancesHtml += '</div>';

    body.innerHTML = `
        <div class="detail-row">
            <span class="detail-label">Description:</span>
            <span class="detail-value">${activite.description || '—'}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Salle:</span>
            <span class="detail-value">${activite.salle}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Animateur:</span>
            <span class="detail-value">${animateur}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Classes:</span>
            <span class="detail-value">${classesText}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Effectif ${activite.separable ? 'par séance' : 'total'}:</span>
            <span class="detail-value">${activite.effectif_max} place(s)</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Type:</span>
            <span class="detail-value">${activite.separable ? 'Sécable (inscription par séance)' : 'Non sécable (toutes séances)'}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Ouverture:</span>
            <span class="detail-value">${formatDateLocal(activite.date_ouverture_inscriptions)}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Fermeture:</span>
            <span class="detail-value">${formatDateLocal(activite.date_fermeture_inscriptions)}</span>
        </div>
        <div class="detail-row detail-row--top">
            <span class="detail-label">Séances:</span>
            ${seancesHtml}
        </div>
        ${activite.groupe_id ? `
        <div class="detail-row">
            <span class="detail-label">Groupe exclusif:</span>
            <span class="detail-value detail-value--accent">
                ${groupes.find(g => g.id === activite.groupe_id)?.nom || `Groupe #${activite.groupe_id}`}
            </span>
        </div>
        ` : ''}
    `;

    modal.classList.add('visible');
    fixShowActivityDetailsEleve();
}

async function inscrireActivite(activiteId) {
    const lockKey = `inscr-act-${activiteId}`;
    // Double protection : debounce 800ms + verrou pendant la requete
    if (Date.now() - (_btnDebounce.get(lockKey) || 0) < BTN_DEBOUNCE_MS) return;
    if (_pendingActions.has(lockKey)) return;
    _pendingActions.add(lockKey);
    _btnDebounce.set(lockKey, Date.now());

    // Feedback immédiat : désactiver le bouton
    const btn = document.querySelector(`#liste-activites-eleve .activity-card[data-activity-id="${activiteId}"] .btn:not(.ghost)`);
    if (btn) { btn.disabled = true; btn.textContent = 'En cours…'; }

    try {
        const activite = activites.find(a => a.id === activiteId);

        // Vérification groupe d'exclusivité côté client
        if (activite && activite.groupe_id) {
            // Chercher si déjà inscrit à une autre activité du même groupe
            const conflit = activites.find(a => {
                if (a.groupe_id !== activite.groupe_id || a.id === activiteId) return false;
                // Vérifier inscription selon le type d'activité

                // Pour activité séparable, vérifier chaque séance
                if (a.separable) return a.seances?.some(seance => seance.inscriptions?.includes(currentUser.id));
                // Pour activité non séparable, vérifier inscription globale
                return a.inscriptions?.includes(currentUser.id);
            });
            if (conflit) {
                await showAlert(`Impossible : vous êtes déjà inscrit à "${conflit.titre}" du même groupe d'activité.`);
                return;
            }
        }

        // Mise à jour optimiste du modèle local (feedback instantané)
        if (activite && !activite.separable) {
            if (!activite.inscriptions.includes(currentUser.id)) {
                activite.inscriptions.push(currentUser.id);
                // Sync _serverNbInscrits avec l'etat optimiste
                if (activite._serverNbInscrits !== undefined) activite._serverNbInscrits++;
            }
        }
        majComptesActivitesEleve();
        updateEmploiDuTempsEleve();

        await apiPost('/inscriptions', {activite_id: activiteId});
        // Le SSE echo va confirmer nb_inscrits depuis le serveur.
    } catch(e) {
        if (e.message?.includes('Déjà inscrit')) {
            // Désynchronisation : corriger le modèle local sans re-render brutal
            const activite = activites.find(a => a.id === activiteId);
            if (activite && !activite.separable && !activite.inscriptions.includes(currentUser.id)) {
                activite.inscriptions.push(currentUser.id);
            }
            majComptesActivitesEleve();
            updateEmploiDuTempsEleve();
        } else {
            // Rollback si erreur : resynchronisation complète
            await fetchAllData();
            majListeActivitesEleve();
            updateEmploiDuTempsEleve();
            await showAlert('Erreur: ' + e.message);
        }
    } finally {
        _lastActionTsByKey.set(`inscr-act-${activiteId}`, Date.now());
        _btnDebounce.set(lockKey, Date.now());
        _pendingActions.delete(lockKey);
    }
}

async function desinscrireActivite(activiteId) {
    if(!await showConfirm('Veux-tu te désinscrire de cette activité ?')) return;

    const lockKey = `desinscr-act-${activiteId}`;
    if (Date.now() - (_btnDebounce.get(lockKey) || 0) < BTN_DEBOUNCE_MS) return;
    if (_pendingActions.has(lockKey)) return;
    _pendingActions.add(lockKey);
    _btnDebounce.set(lockKey, Date.now());

    try {
        // Mise à jour optimiste
        const activite = activites.find(a => a.id === activiteId);
        if (activite && !activite.separable) {
            activite.inscriptions = activite.inscriptions.filter(id => id !== currentUser.id);
            if (activite._serverNbInscrits !== undefined) activite._serverNbInscrits = Math.max(0, activite._serverNbInscrits - 1);
        }
        majComptesActivitesEleve();
        updateEmploiDuTempsEleve();

        await apiDelete('/inscriptions', {activite_id: activiteId});
        // Le SSE confirmera le vrai nb_inscrits. Pas de fetchAllData() ici.
    } catch(e) {
        // Rollback
        await fetchAllData();
        majListeActivitesEleve();
        updateEmploiDuTempsEleve();
        await showAlert('Erreur: ' + e.message);
    } finally {
        _lastActionTsByKey.set(`desinscr-act-${activiteId}`, Date.now());
        _btnDebounce.set(lockKey, Date.now());
        _pendingActions.delete(lockKey);
    }
}

async function inscrireSeance(seanceId) {
    const lockKey = `inscr-seance-${seanceId}`;
    if (Date.now() - (_btnDebounce.get(lockKey) || 0) < BTN_DEBOUNCE_MS) return;
    if (_pendingActions.has(lockKey)) return;
    _pendingActions.add(lockKey);
    _btnDebounce.set(lockKey, Date.now());

    // Feedback immédiat : désactiver le bouton dans les listes
    document.querySelectorAll(`.seance-btn[data-seance-id="${seanceId}"], .btn-mini[data-seance-id="${seanceId}"]`).forEach(b => {
        b.disabled = true;
        b.textContent = '…';
    });

    try {
        // Trouver l'activité correspondante
        const seance = activites.flatMap(a =>
            a.seances.map(s => ({...s, activite_id: a.id, groupe_id: a.groupe_id, separable: a.separable}))
        ).find(s => s.id === seanceId);

        if (!seance) {
            await showAlert('Séance introuvable');
            return;
        }

        // Vérification du groupe d'activité côté client (AMÉLIORÉE)
        if (seance.groupe_id) {
            const conflit = activites.find(a => {
                if (a.groupe_id !== seance.groupe_id || a.id === seance.activite_id) {
                    return false;
                }

                // Vérifier inscription selon le type d'activité
                if (a.separable) {
                    return a.seances?.some(s => s.inscriptions?.includes(currentUser.id));
                } else {
                    return a.inscriptions?.includes(currentUser.id);
                }
            });

            if (conflit) {
                await showAlert(`Impossible : vous êtes déjà inscrit à "${conflit.titre}" du même groupe exclusif.`);
                return;
            }
        }

        // Mise à jour optimiste du modèle local
        const act = activites.find(a => a.id === seance.activite_id);
        const seanceObj = act?.seances?.find(s => s.id === seanceId);
        if (seanceObj && !seanceObj.inscriptions.includes(currentUser.id)) {
            seanceObj.inscriptions.push(currentUser.id);
            if (seanceObj._serverNbInscrits !== undefined) seanceObj._serverNbInscrits++;
            if (act.separable && !act.inscriptions.includes(currentUser.id)) {
                act.inscriptions.push(currentUser.id);
            }
        }

        majComptesActivitesEleve();
        const actActualisee = activites.find(a => a.id === seance.activite_id);
        if (actActualisee && _currentModalActivityId === actActualisee.id) showActivityDetailsEleve(actActualisee);
        updateEmploiDuTempsEleve();

        await apiPost('/inscriptions/seance', {seance_id: seanceId});
        // L'update optimiste est déjà en place. Le SSE confirmera les vrais compteurs.
        // On ne fait pas fetchAllData() ici pour éviter les race conditions en cas d'actions rapides.
    } catch(e) {
        // Rollback : resynchronisation complète
        await fetchAllData();
        majListeActivitesEleve();
        updateEmploiDuTempsEleve();
        await showAlert('Erreur lors de l\'inscription : ' + e.message);
    } finally {
        _lastActionTsByKey.set(`inscr-seance-${seanceId}`, Date.now());
        _btnDebounce.set(lockKey, Date.now());
        _pendingActions.delete(lockKey);
    }
}

async function desinscrireSeance(seanceId) {
    if (!await showConfirm('Veux-tu te désinscrire de cette séance ?')) return;

    const lockKey = `desinscr-seance-${seanceId}`;
    if (Date.now() - (_btnDebounce.get(lockKey) || 0) < BTN_DEBOUNCE_MS) return;
    if (_pendingActions.has(lockKey)) return;
    _pendingActions.add(lockKey);
    _btnDebounce.set(lockKey, Date.now());

    try {
        // Trouver l'activité avant désinscription
        const seance = activites.flatMap(a =>
            a.seances.map(s => ({...s, activite_id: a.id}))
        ).find(s => s.id === seanceId);

        // Mise à jour optimiste
        if (seance) {
            const act = activites.find(a => a.id === seance.activite_id);
            const seanceObj = act?.seances?.find(s => s.id === seanceId);
            if (seanceObj) {
                seanceObj.inscriptions = seanceObj.inscriptions.filter(id => id !== currentUser.id);
                if (seanceObj._serverNbInscrits !== undefined) seanceObj._serverNbInscrits = Math.max(0, seanceObj._serverNbInscrits - 1);
                if (act.separable) {
                    const encoreInscrit = act.seances.some(s => s.inscriptions.includes(currentUser.id));
                    if (!encoreInscrit) act.inscriptions = act.inscriptions.filter(id => id !== currentUser.id);
                }
            }
        }

        // Rafraîchir immédiatement (update ciblé)
        majComptesActivitesEleve();
        if (seance) {
            const actLocale = activites.find(a => a.id === seance.activite_id);
            if (actLocale && _currentModalActivityId === actLocale.id) showActivityDetailsEleve(actLocale);
        }
        updateEmploiDuTempsEleve();

        await apiDelete('/inscriptions/seance', {seance_id: seanceId});
        // L'update optimiste est déjà en place. Le SSE confirmera les vrais compteurs.
        // On ne fait pas fetchAllData() ici pour éviter les race conditions en cas d'actions rapides.
    } catch(e) {
        // Rollback : resynchronisation complète
        await fetchAllData();
        majListeActivitesEleve();
        updateEmploiDuTempsEleve();
        await showAlert('Erreur lors de la désinscription : ' + e.message);
    } finally {
        _lastActionTsByKey.set(`desinscr-seance-${seanceId}`, Date.now());
        _btnDebounce.set(lockKey, Date.now());
        _pendingActions.delete(lockKey);
    }
}

/* ===========================
    Interface Professeur
    =========================== */
function majListeActivitesProf() {
    const container = $('#liste-activites-prof-groupes');
    if (!container) return;

    const userId  = currentUser?.id;
    const isAdmin = currentUser?.role === 'admin';

    // Activités visibles par cet utilisateur
    const mesActivites = isAdmin
        ? activites
        : activites.filter(a => a.prof_id === userId || a.animateur_id === userId);

    if (mesActivites.length === 0) {
        container.innerHTML = '<p class="muted small text-center p-20">Aucune activité</p>';
        return;
    }

    // Grouper par groupe_id (null -> "Sans groupe")
    const parGroupe = new Map();
    // D'abord les groupes connus dans l'ordre
    groupes.forEach(g => parGroupe.set(g.id, { groupe: g, actes: [] }));
    parGroupe.set(null, { groupe: { id: null, nom: 'Sans groupe' }, actes: [] });

    mesActivites.forEach(act => {
        const key = act.groupe_id ?? null;
        if (!parGroupe.has(key)) parGroupe.set(key, { groupe: { id: key, nom: `Groupe #${key}` }, actes: [] });
        parGroupe.get(key).actes.push(act);
    });

    container.innerHTML = '';

    parGroupe.forEach(({ groupe, actes }) => {
        if (actes.length === 0) return;

        const details = document.createElement('details');
        details.className = 'panel-collapsible mt-16';
        // Fermé par défaut

        const nbBadge = `<span class="nb-badge">(${actes.length})</span>`;

        const summary = document.createElement('summary');
        summary.className = 'panel-header';
        summary.innerHTML = `<h4 class="flex items-center gap-8 flex-wrap">
            <svg viewBox="0 0 24 24" class="w-18 h-18 svg-fill-current"><path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm0 18a8 8 0 110-16 8 8 0 010 16zm-1-5h2v2h-2zm0-8h2v6h-2z"/></svg>
            ${groupe.nom}${nbBadge}
        </h4>`;
        details.appendChild(summary);

        const listDiv = document.createElement('div');

        actes.forEach(act => {
            const inscritsCount = getInscritsCount(act);
            const classesText   = (act.classe_ids || [])
                .map(id => classes.find(c => c.id === id)?.nom || '').join(', ');

            const isCree  = act.prof_id === userId;
            const isAnime = act.animateur_id === userId;
            const isCreator = isCree || isAdmin;

            // Pastilles (admin voit toujours les deux si pertinent)
            let pastilles = '';
            if (isAdmin) {
                const creeePar = getUserName(act.prof_id);
                const animePar = act.animateur_id ? getUserName(act.animateur_id) : null;
                pastilles += `<span class="act-pastille act-pastille-cree">✏ ${creeePar}</span>`;
                if (animePar && act.animateur_id !== act.prof_id) {
                    pastilles += `<span class="act-pastille act-pastille-anime">▶ ${animePar}</span>`;
                }
            } else {
                if (isCree)  pastilles += `<span class="act-pastille act-pastille-cree">✏ Je crée</span>`;
                if (isAnime && act.animateur_id !== act.prof_id)
                    pastilles += `<span class="act-pastille act-pastille-anime">▶ J'anime</span>`;
                if (isCree && act.animateur_id === userId)
                    pastilles = `<span class="act-pastille act-pastille-cree">✏ Je crée</span><span class="act-pastille act-pastille-anime">▶ J'anime</span>`;
            }

            const actCard = document.createElement('div');
            actCard.className = 'activity-card';
            actCard.dataset.activityId = act.id;
            actCard.innerHTML = `
                <div class="activity-card-header">
                    <h5 class="activity-title">${act.titre}</h5>
                    <span class="activity-room">${act.salle || ''}</span>
                </div>
                ${pastilles ? `<div class="pastille-wrap">${pastilles}</div>` : ''}
                <div class="activity-details">Classes : ${classesText || '—'}</div>
                <div class="activity-details" data-inscrits-counter>Inscrits : ${inscritsCount}/${act.effectif_max || '?'}</div>
                <div class="activity-meta">${act.seances?.length || 0} séance(s) • ${act.separable ? 'Sécable' : 'Non sécable'}</div>
                ${isCreator ? `
                <div class="activity-actions">
                    <button class="btn-action edit" title="Modifier">
                        <svg viewBox="0 0 24 24" class="w-14 h-14 svg-fill-current"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                    </button>
                    <button class="btn-action delete" title="Supprimer">
                        <svg viewBox="0 0 24 24" class="w-14 h-14 svg-fill-current"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    </button>
                </div>` : ''}
            `;
            listDiv.appendChild(actCard);
        });

        details.appendChild(listDiv);
        container.appendChild(details);
    });
}



async function populerSelectGroupesProf() {
    try {
        const userId = currentUser.id;
        const groupeFilterComp = window._IC_instances?.['groupe-filter-select'];
        if (!groupeFilterComp) return;

        // Récupérer toutes les activités du prof (créées OU animées)
        const activitesProf = activites.filter(a =>
            a.prof_id === userId || a.animateur_id === userId
        );

        // Extraire les groupes uniques de ces activités
        const groupeIds = [...new Set(
            activitesProf.filter(a => a.groupe_id != null).map(a => a.groupe_id)
        )];

        // Filtrer les groupes correspondants
        const groupesProf = groupes.filter(g => groupeIds.includes(g.id));

        // Peupler le select
        if (groupesProf.length === 0) {
            groupeFilterComp.setOptions([{ value: '', label: 'Aucun groupe disponible' }]);
            groupeFilterComp.disable();
            const m = $('#msg-no-groupe'); if (m) m.textContent = "Aucune de vos activités n\'est associée à un groupe";
        } else {
            groupeFilterComp.setOptions([
                ...groupesProf.map(g => ({ value: String(g.id), label: g.nom }))
            ]);
            groupeFilterComp.enable();
            const m = $('#msg-no-groupe'); if (m) m.textContent = 'Sélectionnez un groupe pour voir les élèves non inscrits';
        }
        console.log(`[OK] ${groupesProf.length} groupe(s) disponible(s) pour le prof`);
    } catch(e) {
        console.error('Erreur population select groupes prof:', e);
    }
}

function showActivityDetails(activite) {
    const modal = $('#activity-modal');
    const title = $('#modal-title');
    const body = $('#modal-body');

    // Enregistrer quelle activité est ouverte pour que les handlers SSE
    // rafraîchissent uniquement ce modal et non celui d'une autre activité.
    _currentModalActivityId = activite.id;

    title.textContent = activite.titre;

    const classesText = activite.classe_ids
        .map(id => classes.find(c => c.id === id)?.nom || '')
        .join(', ');

    const animateur = getUserName(activite.animateur_id || activite.prof_id);
    const inscriptions = activite.inscriptions || [];

    const now = nowServer();

    let inscriptionsHtml = '<div class="detail-value">';

    if (activite.seances && activite.seances.length > 0) {
        activite.seances.forEach(seance => {
            const seanceInscrits = activite.separable
                ? (seance.inscriptions || [])
                : inscriptions;

            const seanceDate = new Date(seance.date_heure);
            const seanceDateStr = formatDateLocal(seance.date_heure);
            const duree = seance.duree || 60;
            const seanceFin = new Date(seanceDate.getTime() + duree * 60000);

            const btnPrint = `<button class="btn-print faire" data-seance-id=${seance.id}">
                <svg class="icon icon-print" viewBox="0 0 24 24">
                    <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" fill="currentColor"/>
                </svg>
                Imprimer
            </button>`;

            // Logique des boutons d'appel
            let btnAppel = '';
            const seanceCommencee = now >= seanceDate;
            const seanceTerminee = now > seanceFin;

            if (!seanceCommencee) {
                // Séance pas encore commencée
                btnAppel = '<button class="appel-btn bientot" disabled>Bientôt disponible</button>';
            } else {
                // Séance commencée - vérifier si appel fait
                btnAppel = `<button class="appel-btn loading" data-seance-id="${seance.id}">Vérification...</button>`;

                // Vérifier l'état de l'appel de manière asynchrone
                checkAppelStatus(seance.id, seanceTerminee);
            }

            inscriptionsHtml += `
                <div class="seance-detail-item">
                    <div class="seance-detail-info">
                        <div class="seance-detail-date">📅 ${seanceDateStr}</div>
                        <div class="seance-detail-count">${seanceInscrits.length}/${activite.effectif_max} inscrit(s)</div>
                    </div>
                    ${btnPrint}
                    ${btnAppel}
                </div>
                <div class="inscriptions-list"">
                    ${seanceInscrits.length > 0
                        ? seanceInscrits.map(eleveId => {
                            const eleve = getUserById(eleveId);
                            const userName = eleve ? getUserNameWithClass(eleveId) : `ID: ${eleveId}`;

                            // Vérifier si l'utilisateur peut désinscrire
                            const canUnregister = currentUser.role === 'admin' ||
                                                    activite.prof_id === currentUser.id;
                            let btnHtml = '';
                            if (canUnregister) {
                            btnHtml = `<button class="btn-mini secondary btn-unregister"
                                                data-eleve-id="${eleveId}"
                                                data-seance-id="${seance.id}"
                                                data-activite-separable="${activite.separable}">
                                            ✖ Désinscrire
                                        </button>`;
                            }

                            return `<div class="inscription-item flex justify-between items-center">
                                        <span>${userName} </span>
                                        ${btnHtml}
                                    </div>`;
                            }).join('')
                        : '<div class="inscription-item muted">Aucune inscription</div>'
                    }
                </div>
            `;
        });
    } else {
        inscriptionsHtml += '<div class="inscription-item muted">Aucune séance</div>';
    }

    inscriptionsHtml += '</div>';

    body.innerHTML = `
        <div class="detail-row">
            <span class="detail-label">Description:</span>
            <span class="detail-value">${activite.description || '—'}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Salle:</span>
            <span class="detail-value">${activite.salle}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Animateur:</span>
            <span class="detail-value">${animateur}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Classes:</span>
            <span class="detail-value">${classesText}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Effectif ${activite.separable ? 'par séance' : 'total'}:</span>
            <span class="detail-value">${activite.effectif_max} place(s)</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Type:</span>
            <span class="detail-value">${activite.separable ? 'Sécable (inscription par séance)' : 'Non sécable (toutes séances)'}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Ouverture:</span>
            <span class="detail-value">${formatDateLocal(activite.date_ouverture_inscriptions)}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Fermeture:</span>
            <span class="detail-value">${formatDateLocal(activite.date_fermeture_inscriptions)}</span>
        </div>
        <div class="detail-row detail-row--top">
            <span class="detail-label">Séances & Appel:</span>
            ${inscriptionsHtml}
        </div>
        ${activite.groupe_id ? `
        <div class="detail-row">
            <span class="detail-label">Groupe exclusif:</span>
            <span class="detail-value detail-value--accent">
                ${groupes.find(g => g.id === activite.groupe_id)?.nom || `Groupe #${activite.groupe_id}`}
            </span>
        </div>
        ` : ''}
    `;

    modal.classList.add('visible');
}

function closeActivityModal() {
    $('#activity-modal').classList.remove('visible');
    // Remettre à null pour éviter des rafraîchissements parasites
    // si un SSE arrive après la fermeture du modal.
    _currentModalActivityId = null;
}

/* ===========================
    GESTION DE L'APPEL - LOGIQUE COMPLÈTE
    =========================== */
async function checkAppelStatus(seanceId, seanceTerminee) {
    try {
        // Récupération du statut de l'appel depuis l'API
        const status = await apiGet(`/seances/${seanceId}/appel-status`);
        const btn = document.querySelector(`.appel-btn[data-seance-id="${seanceId}"]`);
        if (!btn) return;

        // Retirer l'état de chargement
        btn.classList.remove('loading');

        // --- LOGIQUE CORRIGÉE DES BOUTONS ---
        if (status.appel_fait) {
            //Appel déjà fait -> bouton vert
            btn.textContent = 'Appel fait ✓';
            btn.className = 'appel-btn fait'; // classe verte
            btn.disabled = false;
            btn.onclick = () => ouvrirModalAppel(seanceId, true);
        } else if (!status.appel_fait && !seanceTerminee) {
            //Séance en cours et appel non fait -> bouton bleu
            btn.textContent = 'Faire l\'appel';
            btn.className = 'appel-btn faire'; // classe bleu (primary)
            btn.disabled = false;
            btn.onclick = () => ouvrirModalAppel(seanceId, false);
        } else if (!status.appel_fait && seanceTerminee) {
            //Séance terminée et appel non fait -> bouton rouge/gris
            btn.textContent = 'Appel manqué';
            btn.className = 'appel-btn non-fait';
            btn.disabled = false;
            btn.onclick = () => ouvrirModalAppel(seanceId, false);
        }
    } catch(e) {
        console.error('Erreur vérification appel:', e);
        const btn = document.querySelector(`.appel-btn[data-seance-id="${seanceId}"]`);
        if (btn) {
            btn.textContent = 'Erreur';
            btn.className = 'appel-btn bientot';
            btn.disabled = true;
        }
    }
}

async function ouvrirModalAppel(seanceId, consultation) {
    try {
        const data = await apiGet(`/seances/${seanceId}/appel`);

        const modal = $('#appel-modal');
        const title = $('#appel-modal-title');
        const body = $('#appel-modal-body');

        title.textContent = `Appel - ${data.seance.titre} (${formatDateLocal(data.seance.date_heure)})`;

        if (data.presences.length === 0) {
            body.innerHTML = '<p class="muted text-center p-20">Aucun élève inscrit</p>';
            modal.classList.add('visible');
            return;
        }

        // Tri initial par nom
        //let presences = data.presences.sort((a, b) => a.nom.localeCompare(b.nom));
        let presences = data.presences.map(p => ({
            ...p,
            present: p.present ?? 0
        })).sort((a, b) => a.nom.localeCompare(b.nom));
        let triActuel = 'nom';


        const renderAppel = () => {
            const { triActuel } = window.currentAppelData;
            body.innerHTML = `
                <div class="appel-header">
                    <div>
                        <strong>${data.presences.length}</strong> élève(s) inscrit(s)
                    </div>
                    <div class="appel-tri-actions">
                        <button class="btn-tri ${triActuel === 'nom' ? 'active' : ''}" data-tri="nom">
                            Trier par nom
                        </button>
                        <button class="btn-tri ${triActuel === 'classe' ? 'active' : ''}" data-tri="classe">
                            Trier par classe
                        </button>
                    </div>
                </div>
                <div class="appel-list">
                    ${presences.map(p => `
                        <div class="appel-item ${p.present ? 'present' : 'absent'}">
                            <div class="appel-eleve-info">
                                <div class="appel-eleve-nom">${p.prenom} ${p.nom}</div>
                                <div class="appel-eleve-classe">${p.classe_nom || 'Sans classe'}</div>
                            </div>
                            <div class="flex gap-8 items-center">
                                <button class="btn-presence ${p.present ? 'active' : ''}"
                                        data-eleve-id="${p.eleve_id}"
                                        data-present="true"
                                        ${consultation ? 'disabled' : ''}>
                                    Présent
                                </button>
                                <button class="btn-absence ${!p.present ? 'active' : ''}"
                                        data-eleve-id="${p.eleve_id}"
                                        data-present="false"
                                        ${consultation ? 'disabled' : ''}>
                                    Absent
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
                ${!consultation ? `
                    <div class="flex gap-12 mt-16 pt-16 border-top">
                        <button class="btn btn-save-appel" data-seance-id="${seanceId}">
                            <svg class="icon" viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" fill="currentColor"/></svg>
                            Enregistrer l'appel
                        </button>
                        <button class="btn secondary btn-close-appel">Annuler</button>
                    </div>
                ` : `
                    <div class="mt-16 pt-16 border-top">
                        <button class="btn secondary btn-close-appel">Fermer</button>
                    </div>
                `}
            `;
        };

        // Stocker les données dans une variable globale pour y accéder depuis les autres fonctions
        window.currentAppelData = {
            seanceId: seanceId,
            presences: presences,
            triActuel: triActuel,
            render: renderAppel
        };

        renderAppel();
        modal.classList.add('visible');

        // Gestion pour les boutons de tri
        body.addEventListener('click', (e) => {
            const btnTri = e.target.closest('.btn-tri');
            if (btnTri) {
                e.preventDefault();
                trierAppel(btnTri.dataset.tri);
            }

        // Gestion pour présence/absence
            const btn = e.target.closest('.btn-presence, .btn-absence');
            if (btn && !btn.disabled) {
                e.preventDefault();
                const eleveId = parseInt(btn.dataset.eleveId);
                const present = btn.dataset.present === 'true';
                togglePresence(eleveId, present);
            }

            // Gestionnaire pour sauvegarder l'appel
            const btnSave = e.target.closest('.btn-save-appel');
            if (btnSave) {
                e.preventDefault();
                enregistrerAppel(parseInt(btnSave.dataset.seanceId));
            }

            // Gestionnaire pour fermer
            const btnClose = e.target.closest('.btn-close-appel');
            if (btnClose) {
                e.preventDefault();
                fermerModalAppel();
            }
        });

    } catch(e) {
        await showAlert('Erreur lors du chargement de l\'appel: ' + e.message);
    }
}

function trierAppel(type) {
    if (!window.currentAppelData) return;

    window.currentAppelData.triActuel = type;

    if (type === 'nom') {
        window.currentAppelData.presences.sort((a, b) => a.nom.localeCompare(b.nom));
    } else if (type === 'classe') {
        window.currentAppelData.presences.sort((a, b) => {
            const classeA = a.classe_nom || 'ZZZ';
            const classeB = b.classe_nom || 'ZZZ';
            if (classeA === classeB) {
                return a.nom.localeCompare(b.nom);
            }
            return classeA.localeCompare(classeB);
        });
    }

    window.currentAppelData.render();
}


function togglePresence(eleveId, present) {
    if (!window.currentAppelData) return;

    const presence = window.currentAppelData.presences.find(p => p.eleve_id === eleveId);
    if (presence) {
        presence.present = present ? 1 : 0;
        window.currentAppelData.render();
    }
}

async function enregistrerAppel(seanceId) {
    if (!window.currentAppelData) return;

    try {
        const presencesData = window.currentAppelData.presences.map(p => ({
            eleve_id: p.eleve_id,
            present: p.present,
            commentaire: p.commentaire || ''
        }));

        await apiPost(`/seances/${seanceId}/appel`, {
            presences: presencesData
        });

        await showAlert('Appel enregistré avec succès !');
        fermerModalAppel();

        // Rafraîchir l'affichage si le modal de détails est ouvert
        const modalDetails = $('#activity-modal');
        if (modalDetails.classList.contains('visible')) {
            // Recharger les données et ré-afficher
            await fetchAllData();
            const activite = activites.find(a => a.seances.some(s => s.id === seanceId));
            if (activite) {
                showActivityDetails(activite);
            }
        }

    } catch(e) {
        await showAlert('Erreur lors de l\'enregistrement: ' + e.message);
    }
}

function fermerModalAppel() {
    $('#appel-modal').classList.remove('visible');
    window.currentAppelData = null;
}

/* ===========================
    Emploi du temps Professeur
    =========================== */
// Palette de couleurs pour les activités
const ACTIVITY_COLORS = [
    ['#0b72ff', '#0052cc'], // Bleu
    ['#d63384', '#a02560'], // Rose
    ['#ff8a00', '#cc6e00'], // Orange
    ['#00b5cc', '#0090a3'], // Cyan
    ['#8b5cf6', '#6d28d9'], // Violet
    ['#10b981', '#059669'], // Vert
    ['#f59e0b', '#d97706'], // Ambre
    ['#ef4444', '#dc2626'], // Rouge
    ['#06b6d4', '#0891b2'], // Turquoise
    ['#ec4899', '#db2777'], // Pink
];

// Cache pour les couleurs par activité
const activityColorCache = new Map();

function getActivityColors(activityId) {
    if (!activityColorCache.has(activityId)) {
    const colorIndex = activityId % ACTIVITY_COLORS.length;
    activityColorCache.set(activityId, ACTIVITY_COLORS[colorIndex]);
    }
    return activityColorCache.get(activityId);
}

function initEmploiDuTempsProf() {
    updateWeekDisplayProf();

    $('#prev-week-prof').onclick = () => {
        currentWeekOffsetProf--;
        updateWeekDisplayProf();
        updateScheduleViewProf();
    };

    $('#next-week-prof').onclick = () => {
        currentWeekOffsetProf++;
        updateWeekDisplayProf();
        updateScheduleViewProf();
    };

    $('#today-prof').onclick = () => {
        currentWeekOffsetProf = 0;
        updateWeekDisplayProf();
        updateScheduleViewProf();
    };

    updateScheduleViewProf();
}

function updateWeekDisplayProf() {
    const today = new Date();
    const monday = getMonday(today);
    monday.setDate(monday.getDate() + (currentWeekOffsetProf * 7));

    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);

    const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    const weekText = `${monday.getDate()} ${monthNames[monday.getMonth()]} - ${sunday.getDate()} ${monthNames[sunday.getMonth()]} ${sunday.getFullYear()}`;
    $('#current-week-prof').textContent = weekText;

    const weekNumber = getWeekNumber(monday);
    document.querySelector('#prof-page .schedule-week-number').textContent = `(Semaine ${weekNumber})`;
}

function createScheduleGridProf() {
    // Cibler les éléments existants dans le HTML statique
    const timeSlots = $('#time-slots-prof');
    const daysGrid  = $('#days-grid-prof');
    if (!timeSlots || !daysGrid) return;

    timeSlots.innerHTML = '';
    daysGrid.innerHTML  = '';

    const monday = getMonday(new Date());
    monday.setDate(monday.getDate() + (currentWeekOffsetProf * 7));

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    // — Colonne des heures (7h à 20h) —
    // 13 cellules normales + 1 label de fin à hauteur 0
    for (let hour = SCHEDULE_START_HOUR; hour <= SCHEDULE_END_HOUR; hour++) {
        const hourCell = document.createElement('div');
        hourCell.className = 'schedule-cell';
        if (hour === SCHEDULE_END_HOUR) {
            hourCell.classList.add('schedule-cell--end');
        } else {
            hourCell.style.height = 'var(--hour-height)';
        }
        hourCell.textContent = `${hour.toString().padStart(2, '0')}:00`;
        timeSlots.appendChild(hourCell);
    }

    // — Grille des 7 jours —
    const dayLabels  = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    const dayKeys    = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
    const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

    for (let i = 0; i < 7; i++) {
        const currentDay = new Date(monday);
        currentDay.setDate(currentDay.getDate() + i);
        currentDay.setHours(0, 0, 0, 0);

        const isToday = currentDay.getTime() === todayDate.getTime();

        const dayCol = document.createElement('div');
        dayCol.className = 'day-column';

        // En-tête du jour
        const header = document.createElement('div');
        header.className = `schedule-header-cell${isToday ? ' today' : ''}`;
        header.innerHTML = `<span class="day-name">${dayLabels[i]}</span><span class="day-number">${currentDay.getDate()} ${monthNames[currentDay.getMonth()]}</span>`;
        dayCol.appendChild(header);

        // Contenu du jour (hauteur gérée par CSS : calc(var(--hour-height) * 13))
        const content = document.createElement('div');
        content.className = `day-content${isToday ? ' today-column' : ''}`;
        content.dataset.day = dayKeys[i];

        for (let j = 0; j < SCHEDULE_HOURS; j++) {
            const line = document.createElement('div');
            line.className = 'hour-line';
            line.style.top = `calc(var(--hour-height) * ${j})`;
            content.appendChild(line);

            const halfLine = document.createElement('div');
            halfLine.className = 'half-hour-line';
            halfLine.style.top = `calc(var(--hour-height) * ${j} + var(--hour-height) / 2)`;
            content.appendChild(halfLine);
        }

        dayCol.appendChild(content);
        daysGrid.appendChild(dayCol);
    }
}

function updateScheduleViewProf() {
    createScheduleGridProf();

    const monday = getMonday(new Date());
    monday.setDate(monday.getDate() + (currentWeekOffsetProf * 7));
    monday.setHours(0, 0, 0, 0); // Normaliser à minuit

    const now = nowServer();

    activites.forEach(act => {
        if (act.prof_id !== currentUser?.id && act.animateur_id !== currentUser?.id) return;

        const colors = getActivityColors(act.id);

        act.seances?.forEach(seance => {
            const seanceDate = new Date(seance.date_heure.replace(' ', 'T'));
            const duree = seance.duree || 60;

            // Normaliser la date de la séance à minuit pour le calcul
            const seanceDateNormalized = new Date(seanceDate);
            seanceDateNormalized.setHours(0, 0, 0, 0);

            const daysDiff = Math.round((seanceDateNormalized - monday) / (1000 * 60 * 60 * 24));

            if (daysDiff >= 0 && daysDiff < 7) {
                const dayName = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'][daysDiff];
                const dayContent = document.querySelector(`#emploi-du-temps-prof .day-content[data-day="${dayName}"]`);

                if (dayContent) {
                    const inscritsCount = seance.inscriptions?.length || 0;

                    const endDate = new Date(seanceDate.getTime() + duree * 60000);
                    const isPast = now > endDate;

                    // Calculer position depuis 7h
                    const topMinutes = timeToMinutes(seance.date_heure);

                    const seanceBlock = document.createElement('div');
                    seanceBlock.className = `seance-block-prof activity-color-${act.id % 8} ${isPast ? 'past' : ''}`;
                    seanceBlock.dataset.activityId = act.id;

                    const pixelsPerMinute = getHourHeight() / 60;

                    seanceBlock.style.top = `${topMinutes}px`;
                    seanceBlock.style.height = `${duree * pixelsPerMinute}px`;

                    const startStr = `${seanceDate.getHours().toString().padStart(2,'0')}:${seanceDate.getMinutes().toString().padStart(2,'0')}`;
                    const endStr = `${endDate.getHours().toString().padStart(2,'0')}:${endDate.getMinutes().toString().padStart(2,'0')}`;

                    seanceBlock.innerHTML = `
                        <div class="seance-header">
                            <div class="seance-time">${startStr} - ${endStr}</div>
                            ${act.salle ? `<div class="seance-room">${act.salle}</div>` : ''}
                        </div>
                        <div class="seance-title">${act.titre}</div>
                        <div class="seance-animateur">${inscritsCount}/${act.effectif_max} inscrits</div>
                    `;

                    seanceBlock.addEventListener('click', (e) => {
                        e.stopPropagation();
                        showActivityDetails(act);
                        highlightActiviteInScheduleProf(act);
                    });

                    dayContent.appendChild(seanceBlock);
                }
            }
        });
    });
}


function highlightActiviteInScheduleProf(activite) {
    // Reset highlighting
    document.querySelectorAll('#emploi-du-temps-prof .schedule-slot').forEach(slot => {
        slot.classList.remove('highlighted');
    });

    // Highlight les créneaux de cette activité
    const monday = getMonday(new Date());
    monday.setDate(monday.getDate() + (currentWeekOffsetProf * 7));

    activite.seances?.forEach(seance => {
        const seanceDate = new Date(seance.date_heure);
        const daysDiff = Math.floor((seanceDate - monday) / (1000 * 60 * 60 * 24));

        if (daysDiff >= 0 && daysDiff < 7) {
            const dayName = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'][daysDiff];
            const hour = seanceDate.getHours();

            if (hour >= 8 && hour < 18) {
                const slotId = `slot-prof-${dayName}-${hour}`;
                const slot = document.getElementById(slotId);

                if (slot) {
                    slot.classList.add('highlighted');
                }
            }
        }
    });
}

/* ===========================
    Emploi du temps Élève
    =========================== */
function initEmploiDuTempsEleve() {
    updateWeekDisplayEleve();

    $('#prev-week-eleve').onclick = () => {
        currentWeekOffsetEleve--;
        updateWeekDisplayEleve();
        updateEmploiDuTempsEleve();
    };

    $('#next-week-eleve').onclick = () => {
        currentWeekOffsetEleve++;
        updateWeekDisplayEleve();
        updateEmploiDuTempsEleve();
    };

    $('#today-eleve').onclick = () => {
        currentWeekOffsetEleve = 0;
        updateWeekDisplayEleve();
        updateEmploiDuTempsEleve();
    };

    updateEmploiDuTempsEleve();
}

function updateWeekDisplayEleve() {
    const today = new Date();
    const monday = getMonday(today);
    monday.setDate(monday.getDate() + (currentWeekOffsetEleve * 7));

    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);

    const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    const weekText = `${monday.getDate()} ${monthNames[monday.getMonth()]} - ${sunday.getDate()} ${monthNames[sunday.getMonth()]} ${sunday.getFullYear()}`;
    $('#current-week-eleve').textContent = weekText;

    const weekNumber = getWeekNumber(monday);
    document.querySelector('#eleve-page .schedule-week-number').textContent = `(Semaine ${weekNumber})`;
}

function createScheduleGridEleve() {
    // Cibler les éléments existants dans le HTML statique
    const timeSlots = $('#time-slots-eleve');
    const daysGrid  = $('#days-grid-eleve');
    if (!timeSlots || !daysGrid) return;

    timeSlots.innerHTML = '';
    daysGrid.innerHTML  = '';

    const monday = getMonday(new Date());
    monday.setDate(monday.getDate() + (currentWeekOffsetEleve * 7));

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    // — Colonne des heures (7h à 20h) —
    for (let hour = SCHEDULE_START_HOUR; hour <= SCHEDULE_END_HOUR; hour++) {
        const hourCell = document.createElement('div');
        hourCell.className = 'schedule-cell';
        if (hour === SCHEDULE_END_HOUR) {
            hourCell.classList.add('schedule-cell--end');
        } else {
            hourCell.style.height = 'var(--hour-height)';
        }
        hourCell.textContent = `${hour.toString().padStart(2, '0')}:00`;
        timeSlots.appendChild(hourCell);
    }

    // — Grille des 7 jours —
    const dayLabels  = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    const dayKeys    = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
    const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

    for (let i = 0; i < 7; i++) {
        const currentDay = new Date(monday);
        currentDay.setDate(currentDay.getDate() + i);
        currentDay.setHours(0, 0, 0, 0);

        const isToday = currentDay.getTime() === todayDate.getTime();

        const dayCol = document.createElement('div');
        dayCol.className = 'day-column';

        // En-tête du jour
        const header = document.createElement('div');
        header.className = `schedule-header-cell${isToday ? ' today' : ''}`;
        header.innerHTML = `<span class="day-name">${dayLabels[i]}</span><span class="day-number">${currentDay.getDate()} ${monthNames[currentDay.getMonth()]}</span>`;
        dayCol.appendChild(header);

        // Contenu du jour (hauteur gérée par CSS : calc(var(--hour-height) * 13))
        const content = document.createElement('div');
        content.className = `day-content${isToday ? ' today-column' : ''}`;
        content.dataset.day = dayKeys[i];

        for (let j = 0; j < SCHEDULE_HOURS; j++) {
            const line = document.createElement('div');
            line.className = 'hour-line';
            line.style.top = `calc(var(--hour-height) * ${j})`;
            content.appendChild(line);

            const halfLine = document.createElement('div');
            halfLine.className = 'half-hour-line';
            halfLine.style.top = `calc(var(--hour-height) * ${j} + var(--hour-height) / 2)`;
            content.appendChild(halfLine);
        }

        dayCol.appendChild(content);
        daysGrid.appendChild(dayCol);
    }
}

function updateEmploiDuTempsEleve() {
    if (!currentUser) return;

    createScheduleGridEleve();

    const monday = getMonday(new Date());
    monday.setDate(monday.getDate() + (currentWeekOffsetEleve * 7));
    monday.setHours(0, 0, 0, 0); // Normaliser à minuit

    const now = nowServer();

    activites.forEach(act => {
        const colors = getActivityColors(act.id);

        act.seances?.forEach(seance => {
            const estInscrit = seance.inscriptions?.includes(currentUser.id) || false;

            if (!estInscrit) return;

            const seanceDate = new Date(seance.date_heure);
            const duree = seance.duree || 60;

            // Normaliser la date de la séance à minuit pour le calcul
            const seanceDateNormalized = new Date(seanceDate);
            seanceDateNormalized.setHours(0, 0, 0, 0);

            const daysDiff = Math.round((seanceDateNormalized - monday) / (1000 * 60 * 60 * 24));

            if (daysDiff >= 0 && daysDiff < 7) {
                const dayName = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'][daysDiff];
                const dayContent = document.querySelector(`#emploi-du-temps-eleve .day-content[data-day="${dayName}"]`);

                if (dayContent) {
                    const endDate = new Date(seanceDate.getTime() + duree * 60000);
                    const isPast = now > endDate;

                    const animateurNom = act.animateur_prenom && act.animateur_nom
                        ? `${act.animateur_prenom} ${act.animateur_nom}`
                        : 'Animateur non défini';

                    const topMinutes = timeToMinutes(seance.date_heure);

                    const seanceBlock = document.createElement('div');
                    seanceBlock.className = `seance-block-eleve activity-color-${act.id % 8} ${isPast ? 'past' : ''}`;
                    seanceBlock.dataset.activityId = act.id;

                    const pixelsPerMinute = getHourHeight() / 60;

                    seanceBlock.style.top = `${topMinutes}px`;
                    seanceBlock.style.height = `${duree * pixelsPerMinute}px`;


                    const startStr = `${seanceDate.getHours().toString().padStart(2,'0')}:${seanceDate.getMinutes().toString().padStart(2,'0')}`;
                    const endStr = `${endDate.getHours().toString().padStart(2,'0')}:${endDate.getMinutes().toString().padStart(2,'0')}`;

                    seanceBlock.innerHTML = `
                        <div class="seance-header">
                            <div class="seance-time">${startStr} - ${endStr}</div>
                            ${act.salle ? `<div class="seance-room">${act.salle}</div>` : ''}
                        </div>
                        <div class="seance-title">${act.titre}</div>
                        <div class="seance-animateur">${animateurNom}</div>
                    `;

                    seanceBlock.addEventListener('click', (e) => {
                        e.stopPropagation();
                        showActivityDetailsEleve(act);
                    });

                    dayContent.appendChild(seanceBlock);
                }
            }
        });
    });
}


/* ===========================
    Reset form
    =========================== */
function resetForm(){
    icSet('titre', '');
    icSet('description', '');
    icSet('salle', '');
    icSet('effectif', '');
    $('#seances-container').innerHTML='';
    icSet('first-hebdoseance', '');
    icSet('nb-seances', '4');
    icSet('ouverture', '');
    icSet('fermeture', '');

    // Remettre animateur par défaut
    { const animCompReset = window._IC_instances?.['animateur-select']; if(animCompReset) {
        const profs = users.filter(u => u.role === 'prof' || u.role === 'admin');
        const defaultId = (currentUser && currentUser.role === 'prof') ? String(currentUser.id) : String(profs[0]?.id || '');
        if (defaultId) animCompReset.setValue(defaultId);
    }}

    if($('#visible-avant')) $('#visible-avant').checked = false;
    if($('#separable')) $('#separable').checked = true;
    const groupeCompReset = window._IC_instances?.['groupe-select']; if (groupeCompReset) groupeCompReset.setValue('');

    // Réinitialiser MultiSelect classes
    if (classeMultiSelect) {
        classeMultiSelect.clearSelection();
        classeMultiSelect.enable();
    }
}







/* ===========================
    GÉNÉRATION PDF
    =========================== */
function ouvrirModalPDF(seanceId) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay visible';
    modal.id = 'pdf-options-modal';

    modal.innerHTML = `
        <div class="modal-content modal-sm">
            <div class="modal-header">
                <h3>Options d'impression</h3>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <p class="muted mb-20">
                    Personnalisez les informations à inclure dans le PDF
                </p>

                <div class="form-group mb-16">
                    <label class="flex items-center gap-10">
                        <input type="checkbox" id="pdf-show-appel" checked>
                        <span>Colonne "Présent" (cases à cocher pour l'appel)</span>
                    </label>
                </div>

                <div class="form-group mb-16">
                    <label class="flex items-center gap-10">
                        <input type="checkbox" id="pdf-show-emargement">
                        <span>Colonne "Émargement" (signature des élèves)</span>
                    </label>
                </div>

                <div class="form-group mb-20">
                    <label class="flex items-center gap-10">
                        <input type="checkbox" id="pdf-show-commentaire">
                        <span>Colonne "Commentaire"</span>
                    </label>
                </div>

                <div class="flex gap-12">
                    <button class="btn btn-generate-pdf" data-seance-id="${seanceId}">
                        <svg class="icon" viewBox="0 0 24 24">
                            <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" fill="currentColor"/>
                        </svg>
                        Générer le PDF
                    </button>
                    <button class="btn secondary btn-close-pdf">Annuler</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Gestionnaires d'événements
    modal.querySelector('.btn-generate-pdf').addEventListener('click', (e) => {
        e.preventDefault();
        genererPDF(parseInt(e.currentTarget.dataset.seanceId));
    });

    modal.querySelector('.btn-close-pdf').addEventListener('click', (e) => {
        e.preventDefault();
        fermerModalPDF();
    });

    modal.querySelector('.modal-close').addEventListener('click', (e) => {
        e.preventDefault();
        fermerModalPDF();
    });

    // Fermer au clic extérieur
    modal.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            fermerModalPDF();
        }
    });
}

function fermerModalPDF() {
    const modal = document.getElementById('pdf-options-modal');
    if (modal) {
        modal.remove();
    }
}

async function genererPDF(seanceId) {
    const showAppel = document.getElementById('pdf-show-appel')?.checked || false;
    const showEmargement = document.getElementById('pdf-show-emargement')?.checked || false;
    const showCommentaire = document.getElementById('pdf-show-commentaire')?.checked || false;

    try {
        const response = await fetch(`/seances/${seanceId}/pdf`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin',
            body: JSON.stringify({
                show_appel: showAppel,
                show_emargement: showEmargement,
                show_commentaire: showCommentaire
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Erreur lors de la génération du PDF');
        }

        // Récupérer le blob PDF
        const blob = await response.blob();

        // Créer un URL temporaire et ouvrir dans un nouvel onglet
        const url = window.URL.createObjectURL(blob);
        window.open(url, '_blank');

        // Libérer l'URL après un délai
        setTimeout(() => window.URL.revokeObjectURL(url), 100);

        fermerModalPDF();

    } catch (e) {
        await showAlert('Erreur lors de la génération du PDF : ' + e.message);
    }
}






/* ===========================
    Créer activité avec API
    =========================== */
async function creerActivite(){
    // Si on est en mode édition, appeler la fonction de modification.
    if (editingActivityId) {
        console.log('Mode édition détecté, appel de modifierActivite()');
        await modifierActivite();
        return;
    }

    const titreEl = $('#titre');
    const salleEl = $('#salle');
    const effectifEl = $('#effectif');
    const classeSelectEl = $('#classe-select');
    const ouvertureEl = $('#ouverture');
    const fermetureEl = $('#fermeture');
    const seancesContainer = $('#seances-container');
    const groupeSelectEl = $('#groupe-select');
    const animateurSelectEl = $('#animateur-select');
    const visibleAvantEl = $('#visible-avant');
    const separableEl = $('#separable');

    if (!titreEl || !salleEl || !effectifEl || !seancesContainer) {
        await showAlert('Erreur : formulaire incomplet');
        return;
    }

    const titre = (icGet('titre') || titreEl.value || '').trim();
    const description = icGet('description') || '';
    const salle = (icGet('salle') || salleEl.value || '').trim();
    const effectif = parseInt(icGet('effectif') || effectifEl.value);
    const separable = separableEl ? separableEl.checked : true;
    const selectedClasses = classeMultiSelect ? classeMultiSelect.selectedItems.map(item => parseInt(item.value)) : [];

    // Récupérer les séances AVEC DURÉES (support InputComp datetime)
    const seances = Array.from(document.querySelectorAll('.seance-item'))
        .map((item) => {
            const selectDuree = item.querySelector('.duree-select');
            // Essayer d'abord via IC wrapper, sinon .seance-input natif
            const icW = item.querySelector('.seance-ic-wrapper');
            const ic = icW?._icRef || (icW?.dataset?.inputId && window._IC_instances?.[icW.dataset.inputId]);
            let dateHeure = ic ? ic.getISOValue() : item.querySelector('.seance-input')?.value;
            return {
                date_heure: dateHeure || '',
                duree: selectDuree ? parseInt(selectDuree.value) : 60
            };
        })
        .filter(s => s.date_heure);

    const ouverture = icGet('ouverture') || ouvertureEl.value;
    const fermeture = icGet('fermeture') || fermetureEl.value;
    const groupeId = (() => { const v = icGet('groupe-select'); return v ? parseInt(v) : null; })();

    // Validation
    let hasError = false;
    [titreEl, salleEl, effectifEl].forEach(el => {
        if(el) el.classList.remove('error');
    });
    icSetError('ouverture', '');
    icSetError('fermeture', '');
    if(classeMultiSelect) classeMultiSelect.setError('');

    $all('.seance-input').forEach(inp => inp.classList.remove('error'));
    if(seancesContainer) seancesContainer.classList.remove('error');

    if (!titre) { titreEl.classList.add('error'); hasError = true; }
    if (!salle) { salleEl.classList.add('error'); hasError = true; }
    if (!effectif || isNaN(effectif) || effectif < 1 || effectif > 3000) {
        effectifEl.classList.add('error');
        hasError = true;
    }
    if (selectedClasses.length === 0) {
        if(classeMultiSelect) classeMultiSelect.setError('Sélectionnez au moins une classe');
        hasError = true;
    }
    if (!ouverture) { icSetError('ouverture', 'Champ requis'); hasError = true; }
    if (!fermeture) { icSetError('fermeture', 'Champ requis'); hasError = true; }
    if (seances.length === 0) {
        seancesContainer.classList.add('error');
        hasError = true;
    }

    // Validation animateur
    const _animVal = icGet('animateur-select');
    if (!_animVal || isNaN(parseInt(_animVal))) {
        icSetError('animateur-select', 'Veuillez choisir un animateur');
        hasError = true;
    } else {
        icSetError('animateur-select', '');
    }

    // ===== NOUVELLE VALIDATION : Cohérence groupe/classes =====
    if (groupeId) {
        const classesGroupe = groupeClasses
            .filter(gc => gc.groupe_id === groupeId)
            .map(gc => gc.classe_id);

        const classesInvalides = selectedClasses.filter(cid => !classesGroupe.includes(cid));

        if (classesInvalides.length > 0) {
            const nomGroupe = groupes.find(g => g.id === groupeId)?.nom || 'ce groupe';
            const nomsClassesInvalides = classesInvalides
                .map(cid => classes.find(c => c.id === cid)?.nom)
                .join(', ');

            await showAlert(`⚠️ Incohérence détectée !\n\nVous avez sélectionné le groupe "${nomGroupe}" mais les classes suivantes n'en font pas partie :\n${nomsClassesInvalides}\n\nVeuillez soit :\n• Changer de groupe d'exclusivité\n• Modifier les classes sélectionnées`);

            if(classeMultiSelect) classeMultiSelect.setError('Sélectionnez au moins une classe');
            hasError = true;
        }

        // Vérifier qu'au moins une classe du groupe est sélectionnée
        const hasClasseFromGroupe = selectedClasses.some(cid => classesGroupe.includes(cid));
        if (!hasClasseFromGroupe) {
            const nomGroupe = groupes.find(g => g.id === groupeId)?.nom || 'ce groupe';
            await showAlert(`⚠️ Aucune classe du groupe "${nomGroupe}" n'est sélectionnée !\n\nVeuillez sélectionner au moins une classe faisant partie de ce groupe.`);
            if(classeMultiSelect) classeMultiSelect.setError('Sélectionnez au moins une classe');
            hasError = true;
        }
    }
    // ===== FIN NOUVELLE VALIDATION =====

    if (hasError) {await showAlert('Veuillez remplir tous les champs obligatoires'); return;}

    const dateOuverture = new Date(ouverture);
    const dateFermeture = new Date(fermeture);

    if (isNaN(dateOuverture.getTime()) || isNaN(dateFermeture.getTime())) {
        await showAlert('Dates invalides');
        return;
    }
    if (dateFermeture <= dateOuverture) {
        await showAlert('La date de fermeture doit être après la date d\'ouverture');
        return;
    }

    const animateurId = parseInt(icGet('animateur-select')) || 0;
    if (!animateurId) {
        icSetError('animateur-select', 'Sélectionnez un animateur');
        return;
    }
    const visibleAvant = visibleAvantEl ? !!visibleAvantEl.checked : false;

    const newAct = {
        titre,
        description,
        prof_id: currentUser.id,
        animateur_id: animateurId,
        visible_avant: visibleAvant,
        classe_ids: selectedClasses,
        salle,
        separable,
        effectif_max: effectif,
        seances,
        date_ouverture_inscriptions: ouverture,
        date_fermeture_inscriptions: fermeture,
        groupe_id: groupeId
    };

    try {
        const result = await apiPost('/activites', newAct);
        await fetchAllData();
        majListeActivitesProf();
        updateScheduleViewProf();
        const preserveChamps = document.getElementById('preserve-champs').checked;
        if(!preserveChamps) {
            resetForm();
        }
        await showAlert('Activité créée avec succès !');
    } catch(e) {
        await showAlert('Erreur lors de la création : ' + e.message);
    }
}

async function supprimerActivite(activiteId, titre) {
    if (!await showConfirm(`⚠️ Confirmer la suppression ?\n\nActivité : "${titre}"\n\nToutes les séances, inscriptions et présences seront définitivement supprimées.`)) {
        return;
    }

    try {
        const response = await fetch(`/activites/${activiteId}`, {
            method: 'DELETE',
            headers: {'Content-Type': 'application/json'},
            credentials: 'same-origin'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Erreur lors de la suppression');
        }

        await fetchAllData();
        majListeActivitesProf();
        updateScheduleViewProf();

        await showAlert('[OK] Activité supprimée avec succès');

    } catch (e) {
        await showAlert('[KO] Erreur : ' + e.message);
    }
}




/* ===========================
    ÉDITION D'ACTIVITÉ
    =========================== */

async function ouvrirModalEdition(activiteId) {
    try {
        // Récupérer l'activité
        const activite = activites.find(a => a.id === activiteId);
        if (!activite) {
            await showAlert('Activité introuvable');
            return;
        }

        // Stocker l'ID pour la modification
        editingActivityId = activiteId;

        // Passer à l'onglet création
        switchProfTab('creation');

        // Attendre que l'onglet soit affiché
        await new Promise(resolve => setTimeout(resolve, 100));

        // Pré-remplir le formulaire via icSet (label flottant correct)
        icSet('titre', activite.titre);
        icSet('description', activite.description || '');
        icSet('salle', activite.salle);
        icSet('effectif', String(activite.effectif_max));
        $('#visible-avant').checked = !!activite.visible_avant;

        // Animateur
        icSet('animateur-select', String(activite.animateur_id || activite.prof_id || ''));


        // Groupe
        icSet('groupe-select', String(activite.groupe_id || ''));
        synchroniserClassesAvecGroupe();


        // Classes
        if (classeMultiSelect) {
            // Désélectionner tout
            classeMultiSelect.selectedItems.forEach(item => {
                classeMultiSelect.unselect(item.value);
            });
            // Sélectionner les classes de l'activité
            activite.classe_ids.forEach(cid => {
                classeMultiSelect.select(cid.toString());
            });
        }

        // Dates
        icSet('ouverture', formatDateInputLocal(new Date(activite.date_ouverture_inscriptions)));
        icSet('fermeture', formatDateInputLocal(new Date(activite.date_fermeture_inscriptions)));

        // Séances - IC datetime + système pivot
        const seancesContainer = $('#seances-container');
        seancesContainer.innerHTML = '';

        const seancesTri = [...activite.seances].sort(
            (a, b) => new Date(a.date_heure) - new Date(b.date_heure)
        );

        seancesTri.forEach((seance, idx) => {
            const valISO = formatDateInputLocal(new Date(seance.date_heure));
            const { div } = _creerLigneSeance({
                valeurISO: valISO,
                duree:     seance.duree || 60,
                seanceId:  seance.id,
                label:     idx === 0 ? '① Pivot' : `+${idx} sem.`,
                className: 'manual',
                onDelete:  () => {
                    trierSeances();
                    _rebindPivotSeances(seancesContainer);
                },
                onChange: idx === 0 ? () => _propagatePivot(seancesContainer) : null,
            });
            seancesContainer.appendChild(div);
        });

        _rebindPivotSeances(seancesContainer);

        // Passer en mode édition (modifie les boutons et le titre)
        passerEnModeEdition();

        console.log('[OK] Activité chargée en mode édition:', activiteId);

    } catch (e) {
        console.error('Erreur ouverture édition:', e);
        await showAlert('Erreur lors du chargement de l\'activité : ' + e.message);
    }
}

function annulerEdition() {
    console.log('> Annulation édition');

    editingActivityId = null;

    // Utiliser la fonction dédiée
    passerEnModeCreation();

    // Vider le formulaire
    resetForm();

    // Retourner à l'onglet gestion
    switchProfTab('gestion');
}

async function modifierActivite() {
    if (!editingActivityId) {
        await showAlert('Erreur : aucune activité en cours d\'édition');
        return;
    }

    // Récupérer les valeurs (même logique que creerActivite)
    const titreEl = $('#titre');
    const salleEl = $('#salle');
    const effectifEl = $('#effectif');
    const classeSelectEl = $('#classe-select');
    const ouvertureEl = $('#ouverture');
    const fermetureEl = $('#fermeture');
    const seancesContainer = $('#seances-container');
    const groupeSelectEl = $('#groupe-select');
    const animateurSelectEl = $('#animateur-select');
    const visibleAvantEl = $('#visible-avant');

    if (!titreEl || !salleEl || !effectifEl || !seancesContainer) {
        await showAlert('Erreur : formulaire incomplet');
        return;
    }

    const titre = (icGet('titre') || titreEl.value || '').trim();
    const description = icGet('description') || '';
    const salle = (icGet('salle') || salleEl.value || '').trim();
    const effectif = parseInt(icGet('effectif') || effectifEl.value);
    const selectedClasses = classeMultiSelect ? classeMultiSelect.selectedItems.map(item => parseInt(item.value)) : [];

    // Récupérer les séances avec leurs IDs (support InputComp datetime)
    const seances = Array.from(document.querySelectorAll('.seance-item'))
        .map(item => {
            const selectDuree = item.querySelector('.duree-select');
            const seanceId = item.dataset.seanceId;
            const icW = item.querySelector('.seance-ic-wrapper');
            const ic = icW?._icRef || (icW?.dataset?.inputId && window._IC_instances?.[icW.dataset.inputId]);
            const input = ic ? null : item.querySelector('.seance-input');
            const dateHeure = ic ? ic.getISOValue() : (input?.value || '');

            return {
                id: seanceId ? parseInt(seanceId) : null,
                date_heure: dateHeure,
                duree: selectDuree ? parseInt(selectDuree.value) : 60
            };
        })
        .filter(s => s.date_heure);

    const ouverture = icGet('ouverture');
    const fermeture = icGet('fermeture');
    const groupeId = (() => { const v = icGet('groupe-select'); return v ? parseInt(v) : null; })();

    // Validation (même que creerActivite)
    let hasError = false;
    [titreEl, salleEl, effectifEl].forEach(el => {
        if (el) el.classList.remove('error');
    });
    icSetError('ouverture', '');
    icSetError('fermeture', '');

    if(classeMultiSelect) classeMultiSelect.setError('');
    $all('.seance-input').forEach(inp => inp.classList.remove('error'));
    if (seancesContainer) seancesContainer.classList.remove('error');

    if (!titre) { titreEl.classList.add('error'); hasError = true; }
    if (!salle) { salleEl.classList.add('error'); hasError = true; }
    if (!effectif || isNaN(effectif) || effectif < 1 || effectif > 3000) {
        effectifEl.classList.add('error');
        hasError = true;
    }
    if (selectedClasses.length === 0) {
        if(classeMultiSelect) classeMultiSelect.setError('Sélectionnez au moins une classe');
        hasError = true;
    }
    if (!ouverture) { icSetError('ouverture', 'Champ requis'); hasError = true; }
    if (!fermeture) { icSetError('fermeture', 'Champ requis'); hasError = true; }
    if (seances.length === 0) {
        seancesContainer.classList.add('error');
        hasError = true;
    }

    if (hasError) { await showAlert('Veuillez remplir tous les champs obligatoires'); return; }

    const dateOuverture = new Date(ouverture);
    const dateFermeture = new Date(fermeture);

    if (isNaN(dateOuverture.getTime()) || isNaN(dateFermeture.getTime())) {
        await showAlert('Dates invalides');
        return;
    }
    if (dateFermeture <= dateOuverture) {
        await showAlert('La date de fermeture doit être après la date d\'ouverture');
        return;
    }

    const animateurId = parseInt(icGet('animateur-select')) || 0;
        if (!animateurId) {
        icSetError('animateur-select', 'Sélectionnez un animateur');
        return;
    }
    const visibleAvant = visibleAvantEl ? !!visibleAvantEl.checked : false;

    const updatedAct = {
        titre,
        description,
        animateur_id: animateurId,
        visible_avant: visibleAvant,
        classe_ids: selectedClasses,
        salle,
        effectif_max: effectif,
        seances,
        date_ouverture_inscriptions: ouverture,
        date_fermeture_inscriptions: fermeture,
        groupe_id: groupeId
    };

    try {
        const result = await apiPut(`/activites/${editingActivityId}`, updatedAct);
        await fetchAllData();
        majListeActivitesProf();
        updateScheduleViewProf();
        annulerEdition();
        showToast('[OK] Activité modifiée avec succès !');
    } catch (e) {
        await showAlert('[KO] Erreur lors de la modification : ' + e.message);
    }
}






/* ===========================
    Gestion des séances
    =========================== */

/* -- Helper : crée un input datetime-local custom (InputComp) pour les séances --
   Retourne { wrapper, getValue } pour usage dans ajouterSeanceManuelle/Hebdo.
   getValue() lit directement le .ic-input natif (valeur ISO locale).          */
function creerSeanceDatetimeIC(valeurISO) {
    const tmpInput = document.createElement('input');
    tmpInput.type = 'datetime-local';
    // On instancie InputComp directement sur cet input temporaire
    // (replaceWith est appelé dans le constructeur)
    const ic = new InputComp(tmpInput, {
        type:          'datetime',
        label:         'Date et heure',
        size:          'sm',
        isoFormat:     true,
        displayFormat: 'dd/mm/yyyy hh:mm',
        width:         '220px',
    });
    if (valeurISO) ic.setValue(valeurISO);
    // Exposer un getter lisible directement (ic-input natif)
    ic.getISOValue = function() {
        const el = this.wrapper.querySelector('.ic-input');
        return el ? el.value : this.getValue();
    };
    return ic;
}

/* -- Helper unique : crée une div.seance-item avec IC datetime, select durée, bouton ✖
   opts.valeurISO  : string ISO pré-remplissage
   opts.duree      : int minutes
   opts.seanceId   : id BDD (mode édition)
   opts.label      : texte du span gauche
   opts.className  : 'manual' | autre
   opts.onDelete   : callback() après suppression
   opts.onChange   : callback() changement de date (pivot)           */
function _creerLigneSeance(opts = {}) {
    const d = document.createElement('div');
    d.className = 'seance-item ' + (opts.className || 'manual');
    if (opts.seanceId) d.dataset.seanceId = String(opts.seanceId);

    const span = document.createElement('div');
    span.className = 'small muted seance-label';
    span.style.minWidth = '110px';
    span.textContent = opts.label || 'Séance';

    const ic = creerSeanceDatetimeIC(opts.valeurISO || '');
    ic.wrapper.classList.add('seance-ic-wrapper');
    ic.wrapper.dataset.seanceIc = '1';
    ic.wrapper._icRef = ic; // référence directe pour éviter la recherche par ID
    if (opts.onChange) ic.opts.onChange = opts.onChange;

    const selectDuree = document.createElement('select');
    selectDuree.className = 'duree-select';
    selectDuree.innerHTML = `
        <option value="15">15 min</option>
        <option value="30">30 min</option>
        <option value="45">45 min</option>
        <option value="60">1h</option>
        <option value="75">1h15</option>
        <option value="90">1h30</option>
        <option value="105">1h45</option>
        <option value="120">2h</option>
    `;
    selectDuree.value = String(opts.duree || 60);

    const del = document.createElement('button');
    del.className = 'btn ghost';
    del.textContent = '✖';
    del.addEventListener('click', (e) => {
        e.preventDefault();
        d.remove();
        if (opts.onDelete) opts.onDelete();
    });

    d.appendChild(span);
    d.appendChild(ic.wrapper);
    d.appendChild(selectDuree);
    d.appendChild(del);
    return { div: d, ic, selectDuree, span };
}

/* Rebinde onChange du pivot (1ère ligne) et met à jour tous les labels.
   Appelé après chaque suppression de séance.                            */
function _rebindPivotSeances(container) {
    const items = Array.from(container.querySelectorAll('.seance-item'));
    items.forEach((item, idx) => {
        const labelEl = item.querySelector('.seance-label');
        if (labelEl) labelEl.textContent = idx === 0 ? '① Pivot' : `+${idx} sem.`;

        const icW = item.querySelector('.seance-ic-wrapper');
        // Priorité : référence directe stockée sur le wrapper, sinon lookup par ID
        const ic  = icW?._icRef || (icW?.dataset?.inputId && window._IC_instances?.[icW.dataset.inputId]);
        if (!ic) return;

        ic.opts.onChange = idx === 0
            ? () => _propagatePivot(container)
            : null;
    });
}

/* Quand la date pivot change, recalcule toutes les suivantes à +idx×7j. */
function _propagatePivot(container) {
    const items = Array.from(container.querySelectorAll('.seance-item'));
    if (items.length < 2) return;

    const firstIcW = items[0].querySelector('.seance-ic-wrapper');
    // Priorité : référence directe sur le wrapper, sinon lookup par ID
    const firstIc  = firstIcW?._icRef || (firstIcW?.dataset?.inputId && window._IC_instances?.[firstIcW.dataset.inputId]);
    const pivotVal = firstIc ? firstIc.getISOValue() : '';
    if (!pivotVal) return;

    const base = new Date(pivotVal);
    if (isNaN(base.getTime())) return;

    items.forEach((item, idx) => {
        if (idx === 0) return;
        const icW = item.querySelector('.seance-ic-wrapper');
        const ic  = icW?._icRef || (icW?.dataset?.inputId && window._IC_instances?.[icW.dataset.inputId]);
        if (!ic) return;
        const newDate = new Date(base);
        newDate.setDate(base.getDate() + idx * 7);
        ic.setValue(formatDateInputLocal(newDate));
    });

    trierSeances();
}


async function ajouterSeanceHebdo(){
    const container = $('#seances-container');

    const start = new Date(icGet('first-hebdoseance'));
    const nbRaw = icGet('nb-seances');
    const nb = parseInt(nbRaw) || parseInt($('#nb-seances')?.value) || 0;
    const duree = parseInt(
        window._IC_instances?.['duree-hebdo']?.getValue() ||
        $('#duree-hebdo')?.value || 60
    );

    if (isNaN(start.getTime()) || !nb || nb < 1) {
        await showAlert('Choisissez une date et un nombre valide');
        return;
    }

    const serieDiv = document.createElement('div');
    serieDiv.className = 'serie-hebdo';
    serieDiv.dataset.duree = duree;

    // Bouton "Supprimer série"
    const sup = document.createElement('div');
    sup.className = 'serie-hebdo-header';
    const supBtn = document.createElement('button');
    supBtn.className = 'btn secondary';
    supBtn.textContent = 'Supprimer série';
    supBtn.addEventListener('click', (e) => {
        e.preventDefault();
        serieDiv.remove();
        trierSeances();
    });
    sup.appendChild(supBtn);
    serieDiv.appendChild(sup);

    // Créer les séances via _creerLigneSeance (même helper que partout)
    for (let i = 0; i < nb; i++) {
        const newDate = new Date(start);
        newDate.setDate(start.getDate() + i * 7);

        const { div, ic, selectDuree } = _creerLigneSeance({
            valeurISO: formatDateInputLocal(newDate),
            duree,
            label:     i === 0 ? '① Pivot' : `+${i} sem.`,
            className: 'seance-item',
            onDelete: () => {
                const remaining = serieDiv.querySelectorAll('.seance-item');
                if (remaining.length === 0) serieDiv.remove();
                trierSeances();
                _rebindPivotSeances(serieDiv);
            },
        });

        // Le pivot (i===0) propage via _propagatePivot
        // Les autres synchronisent la durée de toute la série
        if (i === 0) {
            ic.opts.onChange = () => _propagatePivot(serieDiv);
            selectDuree.addEventListener('change', (e) => _majDureeSerie(serieDiv, e.target.value));
        } else {
            selectDuree.addEventListener('change', (e) => _majDureeSerie(serieDiv, e.target.value));
        }

        serieDiv.appendChild(div);
    }

    container.appendChild(serieDiv);
    trierSeances();
}

function ajouterSeanceManuelle() {
    const container = $('#seances-container');
    if (!container) return;

    const nb = container.querySelectorAll('.seance-item').length;
    const { div } = _creerLigneSeance({
        valeurISO: '',
        duree: 60,
        label: nb === 0 ? '① Pivot' : `Séance ${nb + 1}`,
        className: 'manual',
        onDelete: () => {
            trierSeances();
            _rebindPivotSeances(container);
        },
        onChange: nb === 0 ? () => _propagatePivot(container) : null,
    });

    container.appendChild(div);
    _rebindPivotSeances(container);
    trierSeances();
}

/* Synchronise la durée de toutes les séances d'une série hebdo */
function _majDureeSerie(serieDiv, nouvelleDuree) {
    serieDiv.dataset.duree = nouvelleDuree;
    serieDiv.querySelectorAll('.duree-select').forEach(sel => sel.value = nouvelleDuree);
}


function trierSeances() {
    const container = $('#seances-container');
    if (!container) return;

    // Récupérer tous les éléments
    const allElements = Array.from(container.children);

    // Séparer séries hebdo et séances manuelles
    const series = allElements.filter(el => el.classList.contains('serie-hebdo'));
    const manuelles = allElements.filter(el => el.classList.contains('manual'));

    // Trier UNIQUEMENT les séances manuelles par date
    manuelles.sort((a, b) => {
        const inputA = a.querySelector('.seance-input');
        const inputB = b.querySelector('.seance-input');
        const dateA = inputA && inputA.value ? new Date(inputA.value) : new Date(0);
        const dateB = inputB && inputB.value ? new Date(inputB.value) : new Date(0);
        return dateA - dateB;
    });

    // Réinsérer : manuelles triées EN HAUT, puis séries dans leur ordre d'origine
    container.innerHTML = '';
    manuelles.forEach(el => container.appendChild(el));
    series.forEach(el => container.appendChild(el));
}

/* ===========================
    Gestion des groupes d'exclusivité
    =========================== */
function ouvrirModalGroupes() {
    try {
    groupeEditMode = false;
    currentEditGroupeId = null;
    majListeGroupes();

    // Réinitialiser le formulaire
    icSet('nouveau-groupe-nom', '');
    const _gcTitle = $('#groupe-modal-title'); if (_gcTitle) _gcTitle.textContent = 'Créer un nouveau groupe';
    const _gcBtn   = $('#btn-save-groupe');
    if (_gcBtn) { _gcBtn.innerHTML = ''; const _s = document.createElement('span'); _s.id='btn-save-text'; _s.textContent='Créer le groupe'; _gcBtn.appendChild(_s); }

    // InputComp multiselect groupe-classe-select
    if (!groupeClasseMultiSelect) {
        groupeClasseMultiSelect = window._IC_instances?.['groupe-classe-select'] || null;
    }
    // Initialiser MultiSelect pour les classes du groupe
    const gcClassesData = classes.map(cl => ({ value: cl.id.toString(), label: cl.nom }));
    if (groupeClasseMultiSelect) {
        groupeClasseMultiSelect.setOptions(gcClassesData);
        groupeClasseMultiSelect.clearSelection();
        groupeClasseMultiSelect.opts.onChange = function(val) {
            if (groupeClasseMultiSelect.selectedItems.length > 0) {
                groupeClasseMultiSelect.setError('');
            }
        };
    }

    $('#groupes-modal').classList.add('visible');
    } catch(err) { console.error('[ouvrirModalGroupes] Erreur:', err); }
}

function fermerModalGroupes() {
    annulerEditionGroupe();
    $('#groupes-modal').classList.remove('visible');
    icSet('nouveau-groupe-nom', '');
    groupeEditMode = false;
    currentEditGroupeId = null;

    if (groupeClasseMultiSelect) groupeClasseMultiSelect.clearSelection();
}

function annulerEditionGroupe() {
    const cb = document.getElementById('groupe-echanges-actifs');
    if (cb) cb.checked = false;
    console.log('> Annulation édition');

    groupeEditMode = false;
    currentEditGroupeId = null;

    // Retirer la classe CSS du modal
    const modal = document.querySelector('#groupes-modal .modal-body');
    if (modal) {
        modal.classList.remove('edit-mode');
    }

    // Réinitialiser l'indicateur - AVEC SVG
    const formModeIndicator = document.getElementById('form-mode-indicator');
    if (formModeIndicator) {
        formModeIndicator.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" class="align-middle mr-4 svg-fill-primary">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
            Créer un nouveau groupe
        `;
    }

    // mise à jour du titre du modal
    const modalTitle = document.getElementById('groupe-modal-title');
    if (modalTitle) {
        modalTitle.textContent = 'Créer un nouveau groupe';
        console.log('[OK] Titre du modal mis à jour')
    }

    // Réinitialiser le bouton
    const btnSaveText = document.getElementById('btn-save-text');
    if (btnSaveText) {
        btnSaveText.textContent = 'Créer le groupe';
    }

    // Vider le nom via IC
    icSet('nouveau-groupe-nom', '');
    icSetError('nouveau-groupe-nom', '');

    // Désélectionner toutes les classes
    if (groupeClasseMultiSelect) groupeClasseMultiSelect.clearSelection();

    // Retirer les erreurs visuelles
    if (groupeClasseMultiSelect) groupeClasseMultiSelect.setError('');

    console.log('[OK] Mode création restauré');
}

function majListeGroupes() {
    const container = $('#liste-groupes');
    if (!container) return;

    container.innerHTML = '';

    if (groupes.length === 0) {
        container.innerHTML = '<p class="muted text-center p-20">Aucun groupe créé</p>';
        return;
    }

    groupes.forEach(groupe => {
        const activitesCount = activites.filter(act => act.groupe_id === groupe.id).length;
        const classesGroupe = groupeClasses
            .filter(gc => gc.groupe_id === groupe.id)
            .map(gc => classes.find(c => c.id === gc.classe_id)?.nom)
            .filter(nom => nom)
            .join(', ');

        const groupeDiv = document.createElement('div');
        groupeDiv.className = 'groupe-list-item';

        const infoDiv = document.createElement('div');
        infoDiv.className = 'groupe-list-info';
        infoDiv.innerHTML = `
            <strong class="text-14 font-semibold">${groupe.nom}</strong>
            <div class="small muted">Classes : ${classesGroupe || 'Aucune'}</div>
            <div class="small muted">${activitesCount} activité(s) • ${groupe.description || 'Pas de description'}</div>
        `;

        const btnContainer = document.createElement('div');
        btnContainer.className = 'groupe-list-actions';

        // Bouton éditer
        const btnEdit = document.createElement('button');
        btnEdit.className = 'btn secondary';
        btnEdit.dataset.groupeId = groupe.id;
        btnEdit.innerHTML = `
            <svg class="icon" viewBox="0 0 24 24" class="w-16 h-16">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/>
            </svg>
            Éditer
        `;
        btnEdit.addEventListener('click', (e) => {
            e.preventDefault();
            editerGroupe(parseInt(e.currentTarget.dataset.groupeId));
        });

        // Bouton supprimer
        const btnSuppr = document.createElement('button');
        btnSuppr.className = 'btn secondary';
        btnSuppr.dataset.groupeId = groupe.id;
        btnSuppr.innerHTML = `
            <svg class="icon" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>
            Supprimer
        `;
        btnSuppr.addEventListener('click', (e) => {
            e.preventDefault();
            const btn = e.currentTarget;
            supprimerGroupe(parseInt(btn.dataset.groupeId), btn.dataset.groupeNom);
        });

        btnContainer.appendChild(btnEdit);
        btnContainer.appendChild(btnSuppr);

        groupeDiv.appendChild(infoDiv);
        groupeDiv.appendChild(btnContainer);
        container.appendChild(groupeDiv);
    });
}

async function editerGroupe(groupeId) {
    try {
        console.log('[NEW] Début édition groupe', groupeId);

        const groupe = groupes.find(g => g.id === groupeId);
        if (!groupe) {
            await showAlert('Groupe introuvable');
            return;
        }

        // Activer le mode édition
        groupeEditMode = true;
        currentEditGroupeId = groupeId;

        // === MODIFICATIONS VISUELLES INITIALES ===

        // 1. Classe CSS du modal
        const modal = document.querySelector('#groupes-modal .modal-body');
        if (modal) {
            modal.classList.add('edit-mode');
            console.log('[OK] Classe edit-mode ajoutée');
        }

        // 2. Remplir le nom (via InputComp si disponible, sinon input natif)
        const nomIC = window._IC_instances?.['nouveau-groupe-nom'];
        if (nomIC) {
            nomIC.setValue(groupe.nom);
        } else {
            const nomInput = document.getElementById('nouveau-groupe-nom');
            if (nomInput) nomInput.value = groupe.nom;
        }
        console.log('[OK] Nom rempli:', groupe.nom);
        // Pré-remplir la checkbox échanges
        const cbEch = document.getElementById('groupe-echanges-actifs');
        if (cbEch) cbEch.checked = !!groupe.echanges_actifs;

        // === GESTION DU MULTISELECT ===

        // InputComp multiselect groupe-classe-select (pas de recréation DOM nécessaire)
        if (!groupeClasseMultiSelect) {
            groupeClasseMultiSelect = window._IC_instances?.['groupe-classe-select'] || null;
        }
    if (groupeClasseMultiSelect) {
        const editClassesData = classes.map(cl => ({ value: cl.id.toString(), label: cl.nom }));
        groupeClasseMultiSelect.setOptions(editClassesData);
        groupeClasseMultiSelect.clearSelection();
        groupeClasseMultiSelect.opts.onChange = function(val) {
                if (groupeClasseMultiSelect.selectedItems.length > 0) {
                    groupeClasseMultiSelect.setError('');
                    }
            };
        }
        console.log('[OK] InputComp multiselect prêt');

        // === MODIFICATIONS VISUELLES APRÈS LE MULTISELECT ===

        // 3. Indicateur de mode - AVEC SVG
        const formModeIndicator = document.getElementById('form-mode-indicator');
        if (formModeIndicator) {
            formModeIndicator.innerHTML = `
                <svg viewBox="0 0 24 24" class="w-16 h-16 svg-fill-current mr-4">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                </svg>
                Modifier le groupe
            `;
            console.log('[OK] Indicateur mis à jour');
        }

        // mise à jour du titre du modal
        const modalTitle = document.getElementById('groupe-modal-title');
        if (modalTitle) {
            modalTitle.textContent = 'Modifier le groupe';
            console.log('[OK] Titre du modal mis à jour')
        }

        // 4. Bouton de sauvegarde - mise à jour simple du texte via le span existant
        const _btnSaveText = document.getElementById('btn-save-text');
        if (_btnSaveText) {
            _btnSaveText.textContent = 'Enregistrer les modifications';
            console.log('[OK] Bouton de sauvegarde mis à jour');
        } else {
            console.error('[KO] Bouton btn-save-text introuvable');
        }

        // === PRÉ-SÉLECTION DES CLASSES ===

        const classesGroupe = groupeClasses
            .filter(gc => gc.groupe_id === groupeId)
            .map(gc => gc.classe_id.toString());

        console.log('[OK] Classes à sélectionner:', classesGroupe);

        let selectCount = 0;
        classesGroupe.forEach(cid => {
            try {
                groupeClasseMultiSelect.select(cid);
                selectCount++;
            } catch (e) {
                console.error('[KO] Erreur sélection classe:', cid, e);
            }
        });

        console.log('[OK]', selectCount, 'classes sélectionnées sur', classesGroupe.length);

        // Scroll vers le haut
        const modalBody = document.querySelector('#groupes-modal .modal-body');
        if (modalBody) {
            modalBody.scrollTop = 0;
        }

        console.log('[OK] Mode édition activé pour groupe', groupeId);

    } catch(e) {
        console.error('[KO] Erreur édition groupe:', e);
        await showAlert('Erreur lors de l\'édition du groupe : ' + e.message);
    }
}

async function creerGroupe() {
    const nom = $('#nouveau-groupe-nom').value.trim();

    // Validation nom
    if (!nom) {
        await showAlert('[WARN] Veuillez saisir un nom de groupe');
        if (window._IC_instances?.['nouveau-groupe-nom']) window._IC_instances['nouveau-groupe-nom'].setError('Nom requis'); else $('#nouveau-groupe-nom').classList.add('error');
        return;
    }

    // Validation classes
    if (!groupeClasseMultiSelect || groupeClasseMultiSelect.selectedItems.length === 0) {
        await showAlert('⚠️ Vous devez sélectionner au moins une classe pour ce groupe');
        // multiSelectHeader remplacé par InputComp.setError()
        if(groupeClasseMultiSelect) groupeClasseMultiSelect.setError('Sélectionnez au moins une classe');
        return;
    }

    const classe_ids = groupeClasseMultiSelect.selectedItems.map(item => parseInt(item.value));

    try {
        const echangesActifs = document.getElementById('groupe-echanges-actifs')?.checked || false;
        if (groupeEditMode && currentEditGroupeId) {
            // Mode édition
            await apiPut(`/groupes/${currentEditGroupeId}`, {
                nom,
                description: '',
                classe_ids,
                echanges_actifs: echangesActifs
            });
            await showAlert('✓ Groupe modifié avec succès !');
        } else {
            // Mode création
            await apiPost('/groupes', {
                nom,
                description: '',
                classe_ids,
                echanges_actifs: echangesActifs
            });
            await showAlert('✓ Groupe créé avec succès !');
        }

        await fetchAllData();
        populateSelects();
        majListeGroupes();
        initElevesNonInscrits();

        // Réinitialiser le formulaire
        annulerEditionGroupe();

    } catch(e) {
        await showAlert('[KO] Erreur: ' + e.message);
    }
}

async function supprimerGroupe(groupeId, groupeNom) {
    if (!await showConfirm(`Supprimer le groupe "${groupeNom}" ?\n\nNote: Impossible si des activités l'utilisent.`)) {
        return;
    }

    try {
        const res = await fetch(`/groupes/${groupeId}`, {
            method: 'DELETE',
            headers: {'Content-Type': 'application/json'},
            credentials: 'same-origin'
        });

        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.error || 'Erreur lors de la suppression');
        }

        await fetchAllData();
        populateSelects();
        majListeGroupes();
        initElevesNonInscrits();
        await showAlert('Groupe supprimé avec succès !');
    } catch(e) {
        await showAlert('Erreur: ' + e.message);
    }
}

/* ===========================
    ONGLETS PROF
    =========================== */
function switchProfTab(tabName) {
    // Cibler uniquement les tabs du conteneur prof
    const profTabsContainer = document.querySelector('#prof-page .prof-tabs');
    if (!profTabsContainer) return;

    const tabs = profTabsContainer.querySelectorAll('.prof-tab');
    const contents = document.querySelectorAll('.prof-tab-content');

    tabs.forEach(tab => tab.classList.remove('active'));
    contents.forEach(content => content.classList.remove('active'));

    // Activer le bon onglet via son index
    const tabNames = ['gestion', 'creation', 'echanges'];
    const tabIndex = tabNames.indexOf(tabName);
    if (tabIndex >= 0 && tabs[tabIndex]) tabs[tabIndex].classList.add('active');

    const activeContent = document.getElementById(`prof-tab-${tabName}`);
    if (activeContent) activeContent.classList.add('active');

    // Si on revient sur gestion, rafraîchir l'emploi du temps
    if (tabName === 'gestion') {
        updateScheduleViewProf();
    }
    // Si on ouvre l'onglet échanges, recharger les procédures
    if (tabName === 'echanges') {
        chargerPendingProcedures();
    }
}

/* ===========================
    Sidebar panels
    =========================== */

/* Initialise tous les event listeners statiques (présents dès le chargement) */

/* -- Toast de notification non-bloquant ------------------------------------- */
function showToast(msg, duration = 3000) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'app-toast';
        toast.className = 'app-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.remove('app-toast--hidden');
    toast.classList.add('app-toast--visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
        toast.classList.remove('app-toast--visible');
        toast.classList.add('app-toast--hidden');
    }, duration);
}

function initStaticEventListeners() {
    console.log('- Initialisation des event listeners statiques...');

    // ===== AUTHENTIFICATION =====
    const loginBtn = document.querySelector('#login-card .btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', login);
    }

    const logoutBtn = $('#logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }

    // ===== RACCOURCIS DEV =====
    const demoButtons = document.querySelectorAll('.dev-raccourcis .btn');
    demoButtons.forEach((btn, index) => {
        const usernames = ['prof', 'eleve1', 'eleve2'];
        btn.addEventListener('click', () => demoLogin(usernames[index]));
    });

    // ===== MODALS - FERMETURE =====
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal-overlay');
            if (modal) {
                if (modal.id === 'activity-modal') closeActivityModal();
                else if (modal.id === 'groupes-modal') fermerModalGroupes();
                else if (modal.id === 'appel-modal') fermerModalAppel();
            }
        });
    });

    // ===== ONGLETS PROF =====
    // Cibler uniquement les tabs du conteneur prof (pas les tabs élève qui partagent la même classe)
    const profTabsContainer = document.querySelector('#prof-page .prof-tabs');
    if (profTabsContainer) {
        const profTabs = profTabsContainer.querySelectorAll('.prof-tab');
        const tabNames = ['gestion', 'creation', 'echanges'];
        profTabs.forEach((tab, index) => {
            const tabName = tabNames[index] || 'gestion';
            tab.addEventListener('click', () => switchProfTab(tabName));
        });
    }

    // ===== ONGLETS ÉLÈVE =====
    initEleveTabs();

    // ===== SÉANCES =====
    const btnHebdo = document.getElementById('btn-ajouter-hebdo');
    const btnManuel = document.getElementById('btn-ajouter-manuel');
    if (btnHebdo) btnHebdo.addEventListener('click', ajouterSeanceHebdo);
    if (btnManuel) btnManuel.addEventListener('click', ajouterSeanceManuelle);

    // ===== GROUPES =====
    const btnOuvrirModalGroupes = document.getElementById('btn-ouvrir-groupes');
    if (btnOuvrirModalGroupes) {
        btnOuvrirModalGroupes.addEventListener('click', ouvrirModalGroupes);
    }

    const btnSaveGroupe = $('#btn-save-groupe');
    if (btnSaveGroupe) {
        btnSaveGroupe.addEventListener('click', creerGroupe);
    }

    // Enter dans le champ nom du groupe -> valider
    document.getElementById('nouveau-groupe-nom')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); creerGroupe(); }
    });
    // Support si wrapped dans un IC
    document.addEventListener('keypress', (e) => {
        if (e.key !== 'Enter') return;
        const icW = e.target.closest('.ic-wrapper[data-input-id="nouveau-groupe-nom"]');
        if (icW) { e.preventDefault(); creerGroupe(); }
    });

    const btnAnnulerGroupe = document.querySelector('#groupes-modal .btn.secondary:last-child');
    if (btnAnnulerGroupe) {
        btnAnnulerGroupe.addEventListener('click', annulerEditionGroupe);
    }

    console.log('[OK] Event listeners statiques initialisés');
}




async function desinscrireEleve(eleveId, seanceId, isSeparable) {
    const eleve = getUserById(eleveId);
    const nomEleve = eleve ? `${eleve.prenom} ${eleve.nom}` : `Élève #${eleveId}`;

    if (!await showConfirm(`Voulez-vous vraiment désinscrire ${nomEleve} ?`)) return;

    try {
        if (isSeparable) {
            // Désinscrire de la séance spécifique
            await apiDelete('/inscriptions/seance', {
                seance_id: seanceId,
                eleve_id: eleveId
            });
        } else {
            // Désinscrire de toute l'activité
            const seance = activites.flatMap(a =>
                a.seances.map(s => ({...s, activite_id: a.id}))
            ).find(s => s.id === seanceId);

            if (seance) {
                await apiDelete('/inscriptions', {
                    activite_id: seance.activite_id,
                    eleve_id: eleveId
                });
            }
        }

        await fetchAllData();

        // Rafraîchir le modal
        const activite = activites.find(a =>
            a.seances.some(s => s.id === seanceId)
        );
        if (activite) {
            showActivityDetails(activite);
        }

        // Rafraîchir les listes
        majListeActivitesProf();
        updateScheduleViewProf();

        const successMsg = isSeparable
            ? 'Élève désinscrit de cette séance'
            : 'Élève désinscrit de toute l\'activité';

            showToast(successMsg);
            // SSE va broadcaster aux autres sessions

    } catch(e) {
        await showAlert('Erreur lors de la désinscription : ' + e.message);
    }
}






/* ===========================
    Event Listeners & SSE
    =========================== */
function initSSE() {
    if (!currentUser) return;

    // Fermer proprement l'ancienne connexion (les listeners meurent avec l'objet)
    if (sseConnection) {
        sseConnection.close();
        sseConnection = null;
    }

    sseConnection = new EventSource('/sse');

    sseConnection.onopen = () => {
        console.log('[SSE] [OK] Connexion établie');
        if (sseReconnectTimeout) { clearTimeout(sseReconnectTimeout); sseReconnectTimeout = null; }
        sseReconnectDelay = 3000;
        // Re-sync heure serveur a chaque reconnexion SSE
        syncServerTime();
    };

    sseConnection.onerror = () => {
        if (sseConnection && sseConnection.readyState === EventSource.CLOSED) {
            sseConnection = null;
        }
        if (!sseReconnectTimeout && currentUser) {
            sseReconnectTimeout = setTimeout(() => {
                sseReconnectTimeout = null;
                sseReconnectDelay = Math.min(sseReconnectDelay * 2, 30000);
                initSSE();
            }, sseReconnectDelay);
        }
    };

    sseConnection.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'heartbeat' || data.type === 'connected') return;
        } catch(e) { /* non-JSON ignore */ }
    };

    // Event 'kicked' : une nouvelle session a pris la place de celle-ci
    // (déclenchée par un login sur un autre appareil ou onglet).
    sseConnection.addEventListener('kicked', async () => {
        console.warn('[SSE] Session kickée — nouvelle connexion détectée sur un autre appareil');

        // 1. Fermer la connexion SSE côté client immédiatement.
        if (sseConnection) { sseConnection.close(); sseConnection = null; }

        // 2. BUG FIX : appeler /logout pour invalider le cookie de session Flask.
        //    Sans cet appel, le cookie reste valide côté serveur et un simple
        //    reload de page reconnecterait l'utilisateur via GET /me.
        try {
            await fetch('/logout', { method: 'POST', credentials: 'same-origin' });
        } catch (e) {
            // Erreur réseau : on continue quand même (l'UI sera en état déconnecté)
            console.warn('[SSE] Erreur /logout après kick (non bloquant):', e);
        }

        // 3. Réinitialiser l'état applicatif côté client.
        currentUser = null;
        activites   = [];
        users       = [];
        classes     = [];
        _currentModalActivityId = null;
        onAuthChange();

        // 4. Informer l'utilisateur APRÈS le nettoyage pour éviter toute interaction
        //    avec une interface partiellement réinitialisée.
        await showAlert('Votre session a été ouverte sur un autre appareil. Vous avez été déconnecté, Session terminée');
    });

    // Inscriptions élèves (self-service et manuelles via admin/prof).
    // NOTE : 'inscription_manuelle_created' a été renommé 'inscription_created' côté serveur
    // (avec data.manuel=true) pour que le même handler gère les deux cas sans duplication.
    sseConnection.addEventListener('inscription_created',        handleInscriptionEvent);
    sseConnection.addEventListener('inscription_deleted',        handleInscriptionEvent);
    sseConnection.addEventListener('inscription_seance_created', handleInscriptionEvent);
    sseConnection.addEventListener('inscription_seance_deleted', handleInscriptionEvent);
    // Listener de compatibilité : au cas où un ancien serveur enverrait encore l'ancien nom.
    sseConnection.addEventListener('inscription_manuelle_created', handleInscriptionEvent);
    sseConnection.addEventListener('activite_created',  handleActiviteEvent);
    sseConnection.addEventListener('activite_updated',  handleActiviteEvent);
    sseConnection.addEventListener('activite_deleted',  handleActiviteEvent);
    sseConnection.addEventListener('data_update',       handleActiviteEvent);
    sseConnection.addEventListener('echanges_update',   handleEchangesSSE);
    sseConnection.addEventListener('appel_updated',     handleAppelSSE);
    sseConnection.addEventListener('groupe_created',    handleGroupeSSE);
    sseConnection.addEventListener('groupe_updated',    handleGroupeSSE);
    sseConnection.addEventListener('groupe_deleted',    handleGroupeSSE);
}

/**
 * Gère les événements d'inscription reçus via SSE.
 * Mise à jour chirurgicale : met à jour uniquement les compteurs en mémoire
 * et les éléments DOM concernés, sans fetchAllData().
 *
 * Note : si une action locale est en cours (_pendingActions), on ignore l'event SSE
 * pour éviter les race conditions (l'action locale fera sa propre synchro).
 */
async function handleInscriptionEvent(event) {
    try {
        const data = JSON.parse(event.data);

        const activiteId = data.activite_id;
        const eleveId    = data.eleve_id;
        const seanceId   = data.seance_id;

        // Cas 1 : action encore EN COURS (verrou actif) — on ignore car l'optimiste est déjà posé
        // et le finally va mettre à jour _lastActionTsByKey.
        const inFlight = eleveId === currentUser?.id && (
            _pendingActions.has(`inscr-act-${activiteId}`) ||
            _pendingActions.has(`desinscr-act-${activiteId}`) ||
            _pendingActions.has(`inscr-seance-${seanceId}`) ||
            _pendingActions.has(`desinscr-seance-${seanceId}`)
        );
        if (inFlight) {
            console.log('[SSE] [SKIP] Action encore en cours, SSE ignoré');
            return;
        }

        // Cas 2 : echo SSE de NOTRE action récente — on ignore seulement si l'event SSE
        // correspond exactement à ce qu'on vient de faire (même type créé/supprimé).
        // On utilise un timestamp court (1.5s) pour ne pas bloquer les actions rapides enchaînées.
        const nowTs = Date.now();
        const ECHO_GRACE_MS = 1500;
        // Détecter si cet event SSE est l'écho de NOTRE propre action récente (<1.5s).
        // Les inscriptions manuelles par admin/prof ont eleveId = l'élève inscrit,
        // pas le user courant -> pas de filtre echo pour elles (ce qui est voulu :
        // l'admin doit voir son propre compteur se mettre à jour).
        const isEcho = eleveId === currentUser?.id && (() => {
            const t = (k) => { const ts = _lastActionTsByKey.get(k); return ts && (nowTs - ts) < ECHO_GRACE_MS; };
            // 'inscription_created' couvre maintenant aussi les inscriptions manuelles
            // (ancien 'inscription_manuelle_created'), mais l'écho ne s'applique que
            // si c'est bien l'utilisateur courant qui s'est inscrit lui-même.
            if (event.type === 'inscription_created' || event.type === 'inscription_manuelle_created')
                return t(`inscr-act-${activiteId}`);
            if (event.type === 'inscription_deleted')
                return t(`desinscr-act-${activiteId}`);
            if (event.type === 'inscription_seance_created')
                return t(`inscr-seance-${seanceId}`);
            if (event.type === 'inscription_seance_deleted')
                return t(`desinscr-seance-${seanceId}`);
            return false;
        })();
        // --- Mise à jour du modèle en mémoire ---
        // _serverNbInscrits est TOUJOURS mis à jour (même pour nos propres echos) car
        // c'est la valeur authoritative du serveur.
        // act.inscriptions n'est modifié que si ce n'est pas notre echo (déjà fait en optimiste).
        if (activiteId) {
            const act = activites.find(a => a.id === activiteId);
            if (act) {
                if (event.type === 'inscription_created' || event.type === 'inscription_manuelle_created') {
                    // 1. Setter le compteur serveur EN PREMIER (source de vérité)
                    if (data.nb_inscrits !== undefined && !act.separable) {
                        act._serverNbInscrits = data.nb_inscrits;
                    }
                    // 2. Mettre à jour la liste locale (pour les vues qui itèrent dessus)
                    if (!isEcho && !act.separable && eleveId && !act.inscriptions.includes(eleveId)) {
                        act.inscriptions.push(eleveId);
                    }
                } else if (event.type === 'inscription_deleted') {
                    // 1. Compteur serveur en premier
                    if (data.nb_inscrits !== undefined && !act.separable) {
                        act._serverNbInscrits = data.nb_inscrits;
                    }
                    // 2. Liste locale
                    if (!isEcho && !act.separable) {
                        act.inscriptions = act.inscriptions.filter(id => id !== eleveId);
                    }
                } else if (event.type === 'inscription_seance_created' && seanceId) {
                    const seance = act.seances?.find(s => s.id === seanceId);
                    if (seance) {
                        // 1. Compteur séance en premier
                        if (data.nb_inscrits_seance !== undefined) {
                            seance._serverNbInscrits = data.nb_inscrits_seance;
                        }
                        // 2. Liste locale
                        if (!isEcho && eleveId && !seance.inscriptions.includes(eleveId)) {
                            seance.inscriptions.push(eleveId);
                            if (act.separable && !act.inscriptions.includes(eleveId)) {
                                act.inscriptions.push(eleveId);
                            }
                        }
                    }
                } else if (event.type === 'inscription_seance_deleted' && seanceId) {
                    const seance = act.seances?.find(s => s.id === seanceId);
                    if (seance && eleveId) {
                        // 1. Compteur séance en premier
                        if (data.nb_inscrits_seance !== undefined) {
                            seance._serverNbInscrits = data.nb_inscrits_seance;
                        }
                        if (!isEcho) {
                            // 2. Liste locale
                            seance.inscriptions = seance.inscriptions.filter(id => id !== eleveId);
                            // Si l'élève n'a plus aucune séance dans cette activité -> retirer de act.inscriptions
                            if (act.separable) {
                                const encoreInscrit = act.seances.some(s => s.inscriptions.includes(eleveId));
                                if (!encoreInscrit) act.inscriptions = act.inscriptions.filter(id => id !== eleveId);
                            }
                        }
                    }
                }
            }
        }

        // Echo : _serverNbInscrits mis à jour -> rafraîchir compteurs puis sortir
        if (isEcho) {
            if (currentUser.role === 'eleve') majComptesActivitesEleve();
            else if (activiteId) _updateActiviteCardProf(activiteId);
            return;
        }

        // --- Mise à jour DOM ciblée ---
        if (currentUser.role === 'eleve') {
            majComptesActivitesEleve();
            // Rafraîchir le modal uniquement si c'est l'activité actuellement ouverte.
            // BUG FIX : comparer activiteId à _currentModalActivityId, pas juste vérifier
            // si "un" modal est visible — sinon n'importe quelle inscription pourrait
            // déclencher un refresh du mauvais modal.
            if (_currentModalActivityId && activiteId === _currentModalActivityId) {
                const modal = document.getElementById('activity-modal');
                if (modal?.classList.contains('visible')) {
                    const act = activites.find(a => a.id === activiteId);
                    if (act) showActivityDetailsEleve(act);
                }
            }
        } else if (currentUser.role === 'prof' || currentUser.role === 'admin') {
            // Mise à jour chirurgicale de la card (compteur) sans re-render complet.
            // _serverNbInscrits est déjà setté avant cet appel dans le bloc ci-dessus.
            if (activiteId) _updateActiviteCardProf(activiteId);

            // Rafraîchir le panneau "élèves non inscrits" si le filtre est actif
            { const gfv = icGet('groupe-filter-select'); if (gfv) await chargerElevesNonInscrits(gfv); }

            // Rafraîchir le modal de détail uniquement si c'est l'activité ouverte.
            // Même logique que côté élève : utiliser _currentModalActivityId.
            if (_currentModalActivityId && activiteId === _currentModalActivityId) {
                const modal = document.getElementById('activity-modal');
                if (modal?.classList.contains('visible')) {
                    const act = activites.find(a => a.id === activiteId);
                    if (act) showActivityDetails(act);
                }
            }
            console.log('[SSE] [OK] Interface prof/admin mise à jour (activite_id=' + activiteId + ')');
        }

    } catch (e) {
        console.error('[SSE] [KO] Erreur traitement événement:', e);
        // Fallback : rechargement complet si mise à jour chirurgicale échoue
        await fetchAllData();
        if (currentUser.role === 'eleve') { majComptesActivitesEleve(); updateEmploiDuTempsEleve(); }
        else { majListeActivitesProf(); updateScheduleViewProf(); }
    }
}

/**
 * Met à jour uniquement la card d'une activité dans la liste prof,
 * sans re-rendre toute la liste.
 */
function _updateActiviteCardProf(activiteId) {
    const act = activites.find(a => a.id === activiteId);
    if (!act) return;
    // Trouver la card dans le DOM
    const card = document.querySelector(`.activity-card[data-activity-id="${activiteId}"]`);
    if (!card) { majListeActivitesProf(); return; }  // fallback si introuvable

    const inscritsCount = getInscritsCount(act);
    // Cibler précisément la div compteur (évite d'écraser "Classes :")
    const badge = card.querySelector('[data-inscrits-counter]');
    if (badge) {
        badge.innerHTML = `Inscrits : <strong>${inscritsCount}/${act.effectif_max}</strong>`;
    }
}

/**
 * Ferme proprement la connexion SSE
 */
function closeSSE() {
    console.log('[SSE] Fermeture de la connexion');

    if (sseReconnectTimeout) {
        clearTimeout(sseReconnectTimeout);
        sseReconnectTimeout = null;
    }

    if (sseConnection) {
        sseConnection.close();
        sseConnection = null;
    }
}

/**
 * Gère les événements de modification d'activités (créée, modifiée, supprimée).
 * Pour les suppressions et créations, fetchAllData est nécessaire.
 * Pour les updates, on recharge uniquement l'activité concernée si possible.
 */
async function handleActiviteEvent(event) {
    try {
        const data = JSON.parse(event.data);
        console.log('[SSE] Activité modifiée:', event.type, data);

        // data_update ou deletion/création = on doit tout recharger (structure changée)
        await fetchAllData();

        if (currentUser.role === 'eleve') {
            majComptesActivitesEleve();
            updateEmploiDuTempsEleve();
            // Rafraîchir le modal élève si l'activité ouverte a changé
            if (_currentModalActivityId) {
                const modal = document.getElementById('activity-modal');
                if (modal?.classList.contains('visible')) {
                    const act = activites.find(a => a.id === _currentModalActivityId);
                    // Si l'activité a été supprimée, fermer le modal
                    if (!act) { closeActivityModal(); }
                    else { showActivityDetailsEleve(act); }
                }
            }
        } else {
            majListeActivitesProf();
            updateScheduleViewProf();
            // Rafraîchir le modal uniquement si l'activité OUVERTE a été modifiée.
            // BUG FIX : utiliser _currentModalActivityId (l'activité visible dans le modal)
            // et NON data.id (l'activité qui vient d'être modifiée côté serveur).
            // Avant ce fix, n'importe quelle modification d'activité pouvait
            // "basculer" le modal vers l'activité modifiée, même si l'utilisateur
            // avait ouvert le modal d'une activité différente.
            if (_currentModalActivityId) {
                const modal = document.getElementById('activity-modal');
                if (modal?.classList.contains('visible')) {
                    const act = activites.find(a => a.id === _currentModalActivityId);
                    if (!act) { closeActivityModal(); }
                    else { showActivityDetails(act); }
                }
            }
        }
    } catch (e) {
        console.error('[SSE] Erreur handleActiviteEvent:', e);
    }
}

/**
 * Gère les mises à jour SSE du panel échanges.
 * Recharge uniquement le panel échanges si ouvert, pas toutes les données.
 */
async function handleEchangesSSE(event) {
    try {
        const data = JSON.parse(event.data);
        console.log('[SSE] Échanges mis à jour:', data);

        // Rafraîchir le panel échanges si l'onglet est actif
        const tabActive = document.querySelector('[data-eleve-tab="echanges"].active');
        if (tabActive) {
            await chargerEchangesEleve();
        }

        // Rafraîchir les procédures en attente (vue prof/admin)
        if (currentUser && currentUser.role !== 'eleve') {
            chargerPendingProcedures();
        }

        // Mettre à jour le badge voeux
        if (typeof majVisibiliteTabEchanges === 'function') {
            majVisibiliteTabEchanges();
        }
    } catch (e) {
        console.error('[SSE] Erreur handleEchangesSSE:', e);
    }
}

/**
 * Gère l'événement appel_updated.
 * Rafraîchit uniquement le modal d'appel s'il est ouvert pour la séance concernée.
 */
function handleAppelSSE(event) {
    try {
        const data = JSON.parse(event.data);
        console.log('[SSE] Appel mis à jour:', data);
        // Si le modal appel est ouvert et concerne cette séance, le rafraîchir
        const appelModal = document.getElementById('appel-modal');
        if (appelModal?.classList.contains('visible') && data.seance_id) {
            const currentSeanceId = parseInt(appelModal.dataset.seanceId);
            if (currentSeanceId === data.seance_id) {
                // Recharger uniquement le contenu du modal appel
                if (typeof ouvrirModalAppel === 'function') {
                    ouvrirModalAppel(data.seance_id, true);
                }
            }
        }
    } catch (e) {
        console.error('[SSE] Erreur handleAppelSSE:', e);
    }
}

/**
 * Gère les événements groupe_created / groupe_updated / groupe_deleted.
 * Recharge uniquement les groupes depuis le serveur et met à jour l'UI.
 */
async function handleGroupeSSE(event) {
    try {
        const data = JSON.parse(event.data);
        console.log('[SSE] Groupe modifié:', event.type, data);

        // Recharger les groupes et associations (légère requête, cachée côté serveur)
        try {
            groupes = await apiGet('/groupes');
            groupeClasses = await apiGet('/groupe_classes');
        } catch(e) {
            console.error('[SSE] Erreur rechargement groupes:', e);
        }

        // Mettre à jour uniquement la liste des groupes dans l'UI
        if (currentUser.role === 'prof' || currentUser.role === 'admin') {
            majListeActivitesProf();
            // Rafraîchir les selects groupes dans les formulaires
            if (typeof populateGroupeSelect === 'function') populateGroupeSelect();
        }
        majVisibiliteTabEchanges();
    } catch (e) {
        console.error('[SSE] Erreur handleGroupeSSE:', e);
    }
}

/* ===========================
   Event Listeners DOM
   =========================== */
document.addEventListener('DOMContentLoaded', function() {
    console.log('- DOM chargé, initialisation...');

    // Masquer immédiatement le login-card pour éviter le flash
    // (sera ré-affiché par onAuthChange() si pas de session valide)
    const loginCard = document.getElementById('login-card');
    if (loginCard) loginCard.style.visibility = 'hidden';

    // Initialiser les listeners statiques
    initStaticEventListeners();

    // Initialiser la délégation d'événements
    setupEventDelegation();

    // Enter key pour login — délégation sur #login-card car InputComp remplace les <input> originaux
    document.getElementById('login-card')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const tag = e.target.tagName;
            // Déclencher login si on est dans un input ou dans un wrapper IC du login-card
            if (tag === 'INPUT' || tag === 'TEXTAREA' ||
                e.target.classList.contains('ic-input') ||
                e.target.closest('.ic-wrapper')) {
                e.preventDefault();
                login();
            }
        }
    });

    // Fermer modal avec Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeActivityModal();
            fermerModalGroupes();
            fermerModalAppel();
            fermerModalInscriptionManuelle();
            fermerModalPDF();
        }
    });

    // Fermer modal en cliquant sur le fond (overlay) - handler unique
    document.addEventListener('click', (e) => {
        if (!e.target.classList.contains('modal-overlay')) return;
        const id = e.target.id;
        if      (id === 'activity-modal')           closeActivityModal();
        else if (id === 'groupes-modal')            fermerModalGroupes();
        else if (id === 'appel-modal')              fermerModalAppel();
        else if (id === 'inscription-manuelle-modal') fermerModalInscriptionManuelle();
        else if (id === 'pdf-options-modal')        fermerModalPDF();
        else if (id === 'edition-modal')            fermerModalEdition?.();
    });

    // Gérer la reconnexion SSE quand la page redevient visible
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && currentUser && !sseConnection) {
            console.log('[SSE] Page visible, reconnexion...');
            initSSE();
        }
    });

    // Fermer SSE proprement avant de quitter la page
    window.addEventListener('beforeunload', () => {
        closeSSE();
    });

    // Responsive: recalculer l'emploi du temps au resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (currentUser) {
                if (currentUser.role === 'prof' || currentUser.role === 'admin') {
                    updateScheduleViewProf();
                } else if (currentUser.role === 'eleve') {
                    updateEmploiDuTempsEleve();
                }
            }
        }, 250);
    });
});


/* ===========================
    Gestion des erreurs
    =========================== */
window.addEventListener('error', (e) => {
    console.error('Erreur JavaScript:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('Promise rejetée:', e.reason);
});


/* ===========================
    Initialisation sécurisée
    =========================== */
(async function init(){
    try{
        console.log('[START] Initialisation de l\'application...');

        // Sync heure serveur en parallele du checkAuth
        const [, hasValidSession] = await Promise.all([
            syncServerTime(),
            checkAuthStatus()
        ]);

        if (hasValidSession) {
            console.log('[OK] Session existante detectee');
            await fetchAllData();
        } else {
            console.log('Aucune session active, affichage du login');
            classes = [];
            users = [];
            activites = [];
        }

        onAuthChange();
        console.log('[OK] Application initialisee');
    } catch(e){
        console.error('[KO] Erreur lors de l\'initialisation:', e);
        const loginMsg = $('#login-msg');
        if(loginMsg) loginMsg.textContent = 'Erreur de connexion au serveur';
        currentUser = null;
        classes = [];
        users = [];
        activites = [];
        onAuthChange();
    }
})();






























// ============================================================
// ÉCHANGES — LOGIQUE CÔTÉ CLIENT
// ============================================================

// -- Tabs élève ----------------------------------------------
function initEleveTabs() {
    // Délégation sur #eleve-page — survit à tous les re-renders
    const elevePage = document.getElementById('eleve-page');
    if (!elevePage || elevePage._elevTabsInit) return;
    elevePage._elevTabsInit = true;
    elevePage.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-eleve-tab]');
        if (btn) switchEleveTab(btn.dataset.eleveTab);
    });
}

function switchEleveTab(tab) {
    document.querySelectorAll('[data-eleve-tab]').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.eleve-tab-content').forEach(c => c.classList.remove('active'));
    const btn = document.querySelector(`[data-eleve-tab="${tab}"]`);
    const content = document.getElementById(`eleve-tab-content-${tab}`);
    if (btn) btn.classList.add('active');
    if (content) {
        content.classList.add('active');
    } else {
        console.warn('[tabs] Contenu introuvable : eleve-tab-content-' + tab);
    }
    if (tab === 'echanges') chargerEchangesEleve();
}

// Afficher/masquer le tab échanges selon si l'élève est concerné par un groupe avec échanges actifs
function majVisibiliteTabEchanges() {
    const tab = document.getElementById('eleve-tab-echanges');
    if (!tab) return;
    if (!currentUser || currentUser.role !== 'eleve') { tab.style.display = 'none'; return; }
    const concerned = groupes.some(g => g.echanges_actifs && activites.some(a =>
        a.groupe_id === g.id && a.inscriptions?.includes(currentUser.id)
    ));
    tab.style.display = concerned ? '' : 'none';
}


// -- Vue admin : voeux formulés + demandes d'échange -----------
async function chargerEchangesAdmin(panel) {
    const groupesActifs = groupes.filter(g => g.echanges_actifs);

    // Récupérer tous les voeux de tous les groupes actifs en parallèle
    let tousVoeux = [];
    try {
        const resultats = await Promise.all(
            groupesActifs.map(g => apiGet(`/echanges/voeux/${g.id}`).then(v => v.map(voeu => ({ ...voeu, groupe_nom: g.nom, groupe_id: g.id }))))
        );
        tousVoeux = resultats.flat();
    } catch(e) {
        panel.innerHTML = `<p class="text-error text-center">${e.message}</p>`;
        return;
    }

    // Récupérer les procédures pending
    let procs = [];
    try {
        procs = await apiGet('/echanges/procedures/pending');
    } catch(e) { /* non bloquant */ }

    panel.innerHTML = `
        <div class="admin-echanges-wrap">

            <!-- PANNEAU 1 : Voeux formulés -->
            <details class="panel-collapsible mt-16" open>
                <summary class="panel-header">
                    <h4 class="flex items-center gap-8">
                        <svg viewBox="0 0 24 24" class="w-18 h-18 svg-fill-current"><path d="M12 2a5 5 0 100 10A5 5 0 0012 2zM3 21a9 9 0 0118 0H3z"/></svg>
                        Voeux formulés
                        <span class="nb-badge">(${tousVoeux.length})</span>
                    </h4>
                </summary>
                <div class="admin-voeux-liste">
                    ${tousVoeux.length === 0
                        ? '<p class="muted text-center p-20">Aucun voeu actif.</p>'
                        : tousVoeux.map(v => renderCarteVoeuAdmin(v)).join('')
                    }
                </div>
            </details>

            <!-- PANNEAU 2 : Demandes d'échange -->
            <details class="panel-collapsible mt-16" open>
                <summary class="panel-header">
                    <h4 class="flex items-center gap-8">
                        <svg viewBox="0 0 24 24" class="w-18 h-18" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>
                        Demandes d'échange en attente
                        <span class="nb-badge">(${procs.length})</span>
                    </h4>
                </summary>
                <div id="admin-pending-liste">
                    ${procs.length === 0
                        ? '<p class="muted text-center p-20">Aucune demande en attente.</p>'
                        : procs.map(p => renderCartePendingAdmin(p)).join('')
                    }
                </div>
            </details>

        </div>`;
}

function renderCarteVoeuAdmin(v) {
    const statut = v.statut === 'en_procedure' ? '<span class="voeu-statut statut-en_procedure">En cours</span>' : '<span class="voeu-statut statut-actif">Actif</span>';
    return `
    <div class="admin-voeu-card" data-voeu-id="${v.id}">
        <div class="admin-voeu-meta">
            <span class="admin-voeu-groupe">${v.groupe_nom}</span>
            <span class="admin-voeu-eleve">${v.prenom} ${v.nom} <span class="muted small">(${v.classe_nom || '—'})</span></span>
        </div>
        <div class="admin-voeu-trajet">
            <span class="voeu-from">${v.activite_actuelle_titre || '?'}</span>
            <svg class="voeu-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            <span class="voeu-to">${v.activite_cible_titre || '?'}</span>
            ${statut}
        </div>
        <div class="admin-voeu-actions">
            <button class="btn ghost btn-sm" data-action="retirer-voeu" data-voeu-id="${v.id}" title="Supprimer ce voeu">
                <svg class="icon" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>
                Supprimer
            </button>
        </div>
    </div>`;
}

function renderCartePendingAdmin(p) {
    const isAccordB = p.statut === 'accord_b';
    const statutLabel = {
        'en_attente': '<span class="voeu-statut statut-en_procedure">En attente de l\'élève B</span>',
        'accord_b':   '<span class="voeu-statut statut-actif">Accord des deux élèves ✓</span>',
    }[p.statut] || '';

    return `
    <div class="echange-pending-card echange-pending-card--admin" data-proc-id="${p.id}">
        <div class="echange-pending-groupe">${p.groupe_nom} ${statutLabel}</div>
        <div class="echange-pending-body">
            <div class="echange-pending-side">
                <strong>${p.prenom_a} ${p.nom_a}</strong>
                <span class="voeu-from">${p.titre_a}</span>
                <svg class="voeu-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                <span class="voeu-to">${p.titre_cible_a}</span>
            </div>
            <div class="echange-pending-swap">⇄</div>
            <div class="echange-pending-side">
                <strong>${p.prenom_b} ${p.nom_b}</strong>
                <span class="voeu-from">${p.titre_b}</span>
                <svg class="voeu-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                <span class="voeu-to">${p.titre_cible_b}</span>
            </div>
        </div>
        <div class="echange-pending-actions">
            ${isAccordB
                ? `<span class="muted small">Accordé le ${p.date_accord_b ? new Date(p.date_accord_b).toLocaleDateString('fr-FR') : '—'}</span>`
                : `<span class="muted small">Initié le ${p.date_init ? new Date(p.date_init).toLocaleDateString('fr-FR') : '—'}</span>`
            }
            <button class="btn${isAccordB ? '' : ' secondary'}" data-action="valider-echange" data-proc-id="${p.id}"
                title="${isAccordB ? '' : 'Forcer la validation (l\'élève B n\'a pas encore accepté)'}">
                <svg class="icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor"/></svg>
                ${isAccordB ? 'Valider l\'échange' : 'Forcer la validation'}
            </button>
            <button class="btn ghost btn-sm" data-action="annuler-echange" data-proc-id="${p.id}">
                Refuser
            </button>
        </div>
    </div>`;
}

// -- Chargement des échanges ----------------------------------
let echangesData = { voeux: [], groupeId: null };
let filtreEchanges = 'tous'; // 'tous' | 'compatibles'

async function chargerEchangesEleve() {
    const panel = document.getElementById('echanges-panel');
    if (!panel) return;
    panel.innerHTML = '<p class="muted text-center py-40">Chargement…</p>';

    // Admin : vue omnisciente dédiée
    if (currentUser?.role === 'admin') {
        await chargerEchangesAdmin(panel);
        return;
    }


    // Trouver les groupes avec échanges actifs où l'élève est inscrit
    const groupesConcernes = groupes.filter(g =>
        g.echanges_actifs &&
        activites.some(a => a.groupe_id === g.id && a.inscriptions?.includes(currentUser.id))
    );

    if (groupesConcernes.length === 0) {
        panel.innerHTML = '<p class="muted text-center py-40">Aucun groupe avec échanges actifs pour votre classe.</p>';
        return;
    }

    if (groupesConcernes.length > 1) {
        // --- Sélecteur InputComp avec mémoire de la sélection ---
        // Restaurer la dernière sélection si dispo
        const lastGroupeId = parseInt(sessionStorage.getItem('echanges_groupe_id') || '0');
        let groupeActif = groupesConcernes.find(g => g.id === lastGroupeId) || groupesConcernes[0];

        panel.innerHTML = `
            <div class="mb-16 flex items-center gap-12">
                <span class="font-semibold small">Groupe&nbsp;:</span>
                <div id="echanges-groupe-ic-wrap" class="groupe-ic-wrap"></div>
            </div>
            <div id="echanges-content"></div>`;

        const wrap = document.getElementById('echanges-groupe-ic-wrap');
        const options = groupesConcernes.map(g => ({ value: String(g.id), label: g.nom }));

        // Créer un InputComp select
        if (window.InputComp) {
            const ic = new window.InputComp(wrap, {
                type: 'select',
                id: 'echanges-groupe-ic',
                placeholder: 'Choisir un groupe…',
                options,
                value: String(groupeActif.id),
                onChange: async (val) => {
                    const g = groupesConcernes.find(g => g.id === parseInt(val));
                    if (g) {
                        sessionStorage.setItem('echanges_groupe_id', String(g.id));
                        await chargerVoeuxGroupe(g, document.getElementById('echanges-content'));
                    }
                }
            });
        } else {
            // Fallback select standard si InputComp non disponible
            wrap.innerHTML = `<select id="echanges-groupe-select" class="input-sm select-groupe-echanges">
                ${options.map(o => `<option value="${o.value}"${o.value === String(groupeActif.id) ? ' selected' : ''}>${o.label}</option>`).join('')}
            </select>`;
            document.getElementById('echanges-groupe-select').addEventListener('change', async (e) => {
                const g = groupesConcernes.find(g => g.id === parseInt(e.target.value));
                if (g) {
                    sessionStorage.setItem('echanges_groupe_id', String(g.id));
                    await chargerVoeuxGroupe(g, document.getElementById('echanges-content'));
                }
            });
        }

        await chargerVoeuxGroupe(groupeActif, document.getElementById('echanges-content'));
    } else {
        await chargerVoeuxGroupe(groupesConcernes[0], panel);
    }
}

async function chargerVoeuxGroupe(groupe, container) {
    try {
        const voeux = await apiGet(`/echanges/voeux/${groupe.id}`);
        echangesData = { voeux, groupeId: groupe.id };
        renderEchangesPanel(container, groupe, voeux);
    } catch(e) {
        container.innerHTML = `<p class="text-error text-center">${e.message}</p>`;
    }
}

function renderEchangesPanel(container, groupe, voeux) {
    const monActivite = activites.find(a =>
        a.groupe_id === groupe.id && a.inscriptions?.includes(currentUser.id)
    );

    // Mes voeux actifs
    const mesVoeux = voeux.filter(v => v.eleve_id === currentUser.id);

    // Badge
    const badge = document.getElementById('badge-voeux');
    if (badge) {
        const autres = voeux.filter(v => v.eleve_id !== currentUser.id).length;
        badge.textContent = autres;
        badge.classList.toggle('hidden', autres === 0);
    }

    let html = `
    <div class="echanges-panel-wrap">

      <!-- Mes voeux -->
      <div class="echanges-section">
        <div class="echanges-section-header">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2a5 5 0 100 10A5 5 0 0012 2zM3 21a9 9 0 0118 0H3z"/></svg>
          <h4>Mes voeux d'échange</h4>
          <button class="btn" data-action="ouvrir-voeu" data-groupe-id="${groupe.id}">
            <svg class="icon" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/></svg>
            Formuler un voeu
          </button>
        </div>
        ${mesVoeux.length === 0
            ? '<p class="muted small">Vous n\'avez pas encore formulé de voeu d\'échange.</p>'
            : mesVoeux.map(v => renderCarteMonVoeu(v)).join('')
        }
      </div>

      <!-- Séparateur -->
      <div class="echanges-sep"></div>

      <!-- Voeux des autres -->
      <div class="echanges-section">
        <div class="echanges-section-header">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/>
          </svg>
          <h4>Voeux des autres élèves</h4>
          <div class="echanges-filtres">
            <button class="btn ${filtreEchanges==='tous'?'':'secondary'}" data-action="filtre-echanges" data-filtre="tous" data-groupe-id="${groupe.id}">Tous</button>
            <button class="btn ${filtreEchanges==='compatibles'?'':'secondary'}" data-action="filtre-echanges" data-filtre="compatibles" data-groupe-id="${groupe.id}">Compatibles avec moi</button>
          </div>
        </div>
        <div id="voeux-autres-liste">
          ${renderVoeuxAutres(voeux, monActivite)}
        </div>
      </div>
    </div>`;

    container.innerHTML = html;
}

function renderCarteMonVoeu(v) {
    return `
    <div class="voeu-card mon-voeu" data-voeu-id="${v.id}">
      <div class="voeu-card-body">
        <span class="voeu-from">${v.activite_actuelle_titre || '?'}</span>
        <svg class="voeu-arrow" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
        <span class="voeu-to">${v.activite_cible_titre || '?'}</span>
        <span class="voeu-statut statut-${v.statut}">${labelStatut(v.statut)}</span>
      </div>
      <button class="btn ghost btn-sm" data-action="retirer-voeu" data-voeu-id="${v.id}" title="Retirer ce voeu">
        <svg class="icon" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>
      </button>
    </div>`;
}

function renderVoeuxAutres(voeux, monActivite) {
    let filtered = voeux.filter(v => v.eleve_id !== currentUser.id);
    if (filtreEchanges === 'compatibles' && monActivite) {
        filtered = filtered.filter(v =>
            v.activite_cible_id === monActivite.id
        );
    }
    if (filtered.length === 0) {
        return '<p class="muted small">Aucun voeu' + (filtreEchanges === 'compatibles' ? ' compatible' : '') + ' pour l\'instant.</p>';
    }
    return filtered.map(v => renderCarteVoeuAutre(v, monActivite)).join('');
}

function renderCarteVoeuAutre(v, monActivite) {
    // Est-ce un échange possible avec moi ?
    const compatible = monActivite && v.activite_cible_id === monActivite.id;

    // Mon voeu vers son activité actuelle ?
    const monVoeuVersSon = echangesData.voeux.find(mv =>
        mv.eleve_id === currentUser.id && mv.activite_cible_id === v.activite_actuelle_id
    );
    const peutProposer = compatible && monVoeuVersSon && v.statut === 'actif' && monVoeuVersSon.statut === 'actif';

    const initiales = (v.prenom[0] + v.nom[0]).toUpperCase();
    return `
    <div class="voeu-card voeu-autre ${compatible ? 'voeu-compatible' : ''}">
      <div class="voeu-avatar">${initiales}</div>
      <div class="voeu-card-body">
        <div class="voeu-eleve-nom">${v.prenom} ${v.nom} <span class="muted small">(${v.classe_nom || ''})</span></div>
        <div class="voeu-trajet">
          <span class="voeu-from">${v.activite_actuelle_titre || '?'}</span>
          <svg class="voeu-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
          <span class="voeu-to">${v.activite_cible_titre || '?'}</span>
        </div>
        ${compatible ? '<span class="voeu-badge-compat">Échange possible ! (veuillez formuler le voeux)</span>' : ''}
      </div>
      ${peutProposer
        ? `<button class="btn btn-sm" data-action="proposer-echange" data-voeu-a-id="${monVoeuVersSon.id}" data-voeu-b-id="${v.id}">
            <svg class="icon" viewBox="0 0 24 24" width="14" height="14"><path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
            Proposer l'échange
           </button>`
        : (v.statut === 'en_procedure' ? '<span class="voeu-statut statut-en_procedure">Procédure en cours</span>' : '')
      }
    </div>`;
}

function labelStatut(s) {
    const m = { actif: 'Actif', en_procedure: 'En cours', realise: 'Réalisé', annule: 'Annulé' };
    return m[s] || s;
}

function setFiltreEchanges(filtre, groupeId) {
    filtreEchanges = filtre;
    const groupe = groupes.find(g => g.id === groupeId);
    if (groupe) chargerVoeuxGroupe(groupe, document.getElementById('echanges-content') || document.getElementById('echanges-panel'));
}

// -- Formuler un voeu -----------------------------------------
async function ouvrirModalVoeu(groupeId) {
    const groupe = groupes.find(g => g.id === groupeId);
    if (!groupe) return;

    const monActivite = activites.find(a =>
        a.groupe_id === groupeId && a.inscriptions?.includes(currentUser.id)
    );

    const activitesGroupe = activites.filter(a => a.groupe_id === groupeId && a.id !== monActivite?.id);

    const modal = document.createElement('div');
    modal.className = 'modal-overlay visible';
    modal.id = 'voeu-modal';

    const cardsHtml = activitesGroupe.map(act => {
        const inscrits = act.inscriptions?.length || 0;
        const anim = act.animateur_prenom ? `${act.animateur_prenom} ${act.animateur_nom}` : 'Animateur non défini';
        const classes_txt = act.classe_ids?.map(id => classes.find(c => c.id === id)?.nom || '').join(', ');
        return `
        <div class="activity-card inscription-manuelle-card">
          <div class="activity-card-header">
            <h5 class="activity-title">${act.titre}</h5>
            <span class="activity-room">${act.salle}</span>
          </div>
          <div class="activity-details mb-4">👤 ${anim}</div>
          <div class="activity-details">Classes : ${classes_txt}</div>
          <div class="activity-details"><strong>${inscrits}/${act.effectif_max}</strong> inscrit${inscrits>1?'s':''}</div>
          <div class="activity-actions">
            <button class="btn-action inscrire" data-activite-id="${act.id}" data-groupe-id="${groupeId}">
              <svg viewBox="0 0 24 24" class="icon-inline"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              Formuler ce voeu
            </button>
          </div>
        </div>`;
    }).join('');

    modal.innerHTML = `
      <div class="modal-content modal-large">
        <div class="modal-header">
          <h3>Formuler un voeu d'échange — ${groupe.nom}</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <p class="muted mb-16">Vous êtes actuellement dans <strong>${monActivite?.titre || '?'}</strong>. Choisissez une activité vers laquelle vous souhaitez aller :</p>
          <div class="inscription-manuelle-grid">${cardsHtml}</div>
        </div>
      </div>`;

    document.body.appendChild(modal);

    modal.addEventListener('click', async (e) => {
        const btn = e.target.closest('.btn-action.inscrire');
        if (btn) {
            e.stopPropagation();
            try {
                await apiPost('/echanges/voeux', {
                    groupe_id: parseInt(btn.dataset.groupeId),
                    activite_cible_id: parseInt(btn.dataset.activiteId)
                });
                modal.remove();
                showToast('Voeu enregistré !');
                await fetchAllData();
                chargerEchangesEleve();
            } catch(err) {
                showToast(err.message, 4000);
            }
        }
        if (e.target.closest('.modal-close') || e.target.classList.contains('modal-overlay')) {
            modal.remove();
        }
    });
}

async function retirerVoeu(voeuId) {
    if (!await showConfirm('Retirer ce voeu d\'échange ?')) return;
    try {
        await fetch(`/echanges/voeux/${voeuId}`, { method: 'DELETE', credentials: 'same-origin' });
        showToast('Voeu retiré.');
        await fetchAllData();
        if (currentUser?.role === 'admin') {
            chargerPendingProcedures();
        } else {
            chargerEchangesEleve();
        }
    } catch(e) {
        showToast('Erreur : ' + e.message, 4000);
    }
}

async function proposerEchange(voeuAId, voeuBId) {
    if (!await showConfirm('Proposer cet échange à l\'élève concerné ? Il devra accepter avant validation.')) return;
    try {
        await apiPost('/echanges/procedures', { voeu_a_id: voeuAId, voeu_b_id: voeuBId });
        showToast('Procédure d\'échange lancée ! L\'autre élève doit maintenant accepter.');
        chargerEchangesEleve();
    } catch(e) {
        showToast('Erreur : ' + e.message, 4000);
    }
}

async function repondreEchange(procId, action) {
    try {
        await apiPost(`/echanges/procedures/${procId}/repondre`, { action });
        showToast(action === 'accepter' ? 'Échange accepté !' : 'Échange refusé.');
        chargerEchangesEleve();
        if (action === 'accepter') await fetchAllData();
    } catch(e) {
        showToast('Erreur : ' + e.message, 4000);
    }
}

// -- Section prof : échanges en attente ----------------------
async function chargerPendingProcedures() {
    const container = document.getElementById('liste-pending-echanges');
    if (!container) return;
    container.innerHTML = '<p class="muted text-center py-40">Chargement…</p>';

    const isAdmin = currentUser?.role === 'admin';

    try {
        // Procédures pending (tout le monde)
        const procs = await apiGet('/echanges/procedures/pending');

        // Badge
        const badge = document.getElementById('badge-pending');
        if (badge) { badge.textContent = procs.length; badge.classList.toggle('hidden', procs.length === 0); }

        // Voeux actifs (admin seulement)
        let tousVoeux = [];
        if (isAdmin) {
            const groupesActifs = groupes.filter(g => g.echanges_actifs);
            const resultats = await Promise.all(
                groupesActifs.map(g => apiGet(`/echanges/voeux/${g.id}`)
                    .then(v => v.map(voeu => ({ ...voeu, groupe_nom: g.nom, groupe_id: g.id })))
                    .catch(() => []))
            );
            tousVoeux = resultats.flat();
        }

        let html = '';

        // -- Panneau voeux (admin uniquement) ----------------------
        if (isAdmin) {
            html += `
            <details class="panel-collapsible mt-16" open>
                <summary class="panel-header">
                    <h4 class="flex items-center gap-8">
                        <svg viewBox="0 0 24 24" class="w-18 h-18 svg-fill-current"><path d="M12 2a5 5 0 100 10A5 5 0 0012 2zM3 21a9 9 0 0118 0H3z"/></svg>
                        Voeux formulés
                        <span class="nb-badge">(${tousVoeux.length})</span>
                    </h4>
                </summary>
                <div class="admin-voeux-liste">
                    ${tousVoeux.length === 0
                        ? '<p class="muted text-center p-20">Aucun voeu actif.</p>'
                        : tousVoeux.map(v => {
                            const statut = v.statut === 'en_procedure'
                                ? '<span class="voeu-statut statut-en_procedure">En cours</span>'
                                : '<span class="voeu-statut statut-actif">Actif</span>';
                            return `
                            <div class="admin-voeu-card" data-voeu-id="${v.id}">
                                <div class="admin-voeu-meta">
                                    <span class="admin-voeu-groupe">${v.groupe_nom}</span>
                                    <span class="admin-voeu-eleve">${v.prenom} ${v.nom} <span class="muted small">(${v.classe_nom || '—'})</span></span>
                                </div>
                                <div class="admin-voeu-trajet">
                                    <span class="voeu-from">${v.activite_actuelle_titre || '?'}</span>
                                    <svg class="voeu-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                                    <span class="voeu-to">${v.activite_cible_titre || '?'}</span>
                                    ${statut}
                                </div>
                                <div class="admin-voeu-actions">
                                    <button class="btn ghost btn-sm" data-action="retirer-voeu" data-voeu-id="${v.id}" title="Supprimer ce voeu">
                                        <svg class="icon" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>
                                        Supprimer
                                    </button>
                                </div>
                            </div>`;
                        }).join('')
                    }
                </div>
            </details>`;
        }

        // -- Panneau procédures pending ----------------------------
        html += `
            <details class="panel-collapsible mt-16" open>
                <summary class="panel-header">
                    <h4 class="flex items-center gap-8">
                        <svg viewBox="0 0 24 24" class="w-18 h-18" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>
                        Demandes d'échange en attente
                        <span class="nb-badge">(${procs.length})</span>
                    </h4>
                </summary>
                <div>
                    ${procs.length === 0
                        ? '<p class="muted text-center p-20">Aucune demande en attente.</p>'
                        : procs.map(p => renderCartePendingAdmin(p)).join('')
                    }
                </div>
            </details>`;

        container.innerHTML = html;

    } catch(e) {
        container.innerHTML = `<p class="text-error text-center">${e.message}</p>`;
    }
}

async function validerEchange(procId) {
    if (!await showConfirm('Valider définitivement cet échange ? Les inscriptions seront permutées.')) return;
    try {
        await apiPost(`/echanges/procedures/${procId}/valider`, {});
        showToast('Échange validé et inscriptions permutées !');
        chargerPendingProcedures();
        await fetchAllData();
    } catch(e) {
        showToast('Erreur : ' + e.message, 4000);
    }
}

async function annulerEchangeProf(procId) {
    if (!await showConfirm('Refuser cet échange ? Les deux voeux resteront actifs.')) return;
    try {
        await apiPost(`/echanges/procedures/${procId}/annuler`, {});
        showToast('Échange refusé.');
        chargerPendingProcedures();
    } catch(e) {
        showToast('Erreur : ' + e.message, 4000);
    }
}
