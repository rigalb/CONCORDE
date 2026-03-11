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
        if (card && !btn) {
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

function timeToMinutes(dateTime) {
    const date = new Date(dateTime);
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const baseMinutes = (hours - 7) * 60 + minutes;

    // Adapter selon la largeur d'écran (pixels par heure)
    const width = window.innerWidth;
    let pixelsPerHour;

    if (width >= 1920) {
        pixelsPerHour = 60;
    } else if (width >= 1280) {
        pixelsPerHour = 50;
    } else {
        pixelsPerHour = 40;
    }

    return (baseMinutes / 60) * pixelsPerHour;
}

/* ===========================
    API helpers
    =========================== */
async function apiGet(url) {
    try {
        const res = await fetch(url, {
            credentials:'same-origin',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
        if(!res.ok) {
            if(res.status === 401) {
                currentUser = null;
                onAuthChange();
                throw new Error('Session expirée');
            }
            const errorData = await res.json().catch(() => ({ error: `Erreur HTTP ${res.status}` }));
            throw new Error(errorData.error || `HTTP ${res.status}`);
        }
        return res.json();
    } catch(e) {
        console.error('API GET Error:', e);
        throw e;
    }
}

async function apiPost(url, data) {
    try {
        const res = await fetch(url, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            credentials:'same-origin',
            body: JSON.stringify(data)
        });
        if(!res.ok) {
            if(res.status === 401) {
                currentUser = null;
                onAuthChange();
                throw new Error('Non autorisé');
            }
            const errorData = await res.json().catch(() => ({ error: `Erreur HTTP ${res.status}` }));
            throw new Error(errorData.error || `HTTP ${res.status}`);
        }
        return res.json();
    } catch(e) {
        console.error('API POST Error:', e);
        throw e;
    }
}

async function apiPut(url, data) {
    try {
        const res = await fetch(url, {
            method:'PUT',
            headers:{'Content-Type':'application/json'},
            credentials:'same-origin',
            body: JSON.stringify(data)
        });
        if(!res.ok) {
            if(res.status === 401) {
                currentUser = null;
                onAuthChange();
                throw new Error('Non autorisé');
            }
            const errorData = await res.json().catch(() => ({ error: `Erreur HTTP ${res.status}` }));
            throw new Error(errorData.error || `HTTP ${res.status}`);
        }
        return res.json();
    } catch(e) {
        console.error('API PUT Error:', e);
        throw e;
    }
}

async function apiDelete(url, data){
    try {
        const res = await fetch(url, {
            method:'DELETE',
            headers:{'Content-Type':'application/json'},
            credentials:'same-origin',
            body: JSON.stringify(data)
        });
        if(!res.ok) {
            if(res.status === 401) {
                currentUser = null;
                onAuthChange();
                throw new Error('Non autorisé');
            }
            const errorData = await res.json().catch(() => ({ error: `Erreur HTTP ${res.status}` }));
            throw new Error(errorData.error || `HTTP ${res.status}`);
        }
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
        $('#login-msg').textContent = 'Erreur de connexion: ' + e.message;
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
async function fetchAllData() {
    try {
        classes = await apiGet('/classes');

        if (!currentUser) {
            users = [];
            activites = [];
            groupes = [];
            groupeClasses = [];
            return;
        }

        if (currentUser.role === 'prof' || currentUser.role === 'admin') {
            try {
                users = await apiGet('/users');
            } catch (e) {
                users = [];
            }
        } else {
            users = [currentUser];
        }

        // charger les groupes d'activité ET leurs classes
        try {
            groupes = await apiGet('/groupes');
            groupeClasses = await apiGet('/groupe_classes');
        } catch (e) {
            console.error('Erreur chargement groupes:', e);
            groupes = [];
            groupeClasses = [];
        }

        const [rawActivites, rawActiviteClasses, rawSeances] = await Promise.all([
            apiGet('/activites'),
            apiGet('/activite_classes'),
            apiGet('/seances')
        ]);

        let rawInscriptions = [];
        let rawInscriptionsSeances = [];
        try {
            rawInscriptions = await apiGet('/inscriptions');
            try {
                rawInscriptionsSeances = await apiGet('/inscriptions/seances');
            } catch (e) {
                rawInscriptionsSeances = [];
            }
        } catch (e) {
            rawInscriptions = [];
        }

        // Enrichir chaque activité
        activites = rawActivites.map(act => {
            act.classe_ids = rawActiviteClasses
                .filter(ac => ac.activite_id === act.id)
                .map(ac => Number(ac.classe_id));

            act.seances = rawSeances
                .filter(s => s.activite_id === act.id)
                .map(s => {
                    const seanceInscriptions = rawInscriptionsSeances
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
                act.inscriptions = rawInscriptions
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
        $('#login-card').classList.add('hidden');
        afficherPageRole(currentUser.role);

        initSSE();
        majVisibiliteTabEchanges();
    } else {
        $('#user-badge').style.display='none';
        $('#logout-btn').classList.add('hidden');
        $('#login-card').classList.remove('hidden');
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

function verifierCoherenceGroupeClasses() {
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

        alert(`[WARN] Incohérence détectée !\n\nLes classes suivantes ne font pas partie du groupe "${nomGroupe}" :\n${nomsClassesInvalides}\n\nVeuillez ajuster votre sélection.`);

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
            container.innerHTML = '<p class="muted small text-center" style="padding: 12px;">✓ Tous les élèves sont inscrits !</p>';
            return;
        }

        container.innerHTML = `
            <div style="background: #fef3c7; padding: 10px; border-radius: 6px; margin-bottom: 12px; font-size: 12px; color: #92400e;">
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
            container.innerHTML = '<p class="muted small" style="color: #dd1738; padding: 12px;">Erreur lors du chargement</p>';
        }
    }
}

async function envoyerRappelInscription(groupeId, eleveId, btn) {
    if (!confirm('Envoyer un mail de rappel à cet élève ?')) return;

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
        alert('Erreur: ' + e.message);
        btn.disabled = false;
        btn.textContent = originalText;
    }
}


async function ouvrirModalInscriptionManuelle(eleveId, groupeId) {
    try {
        const eleve = getUserById(eleveId);
        if (!eleve) {
            alert('Élève introuvable');
            return;
        }

        // Récupérer les activités du groupe
        const activitesGroupe = activites.filter(a => a.groupe_id === groupeId);

        if (activitesGroupe.length === 0) {
            alert('Aucune activité dans ce groupe');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'modal-overlay visible';
        modal.id = 'inscription-manuelle-modal';

        let activitesHtml = '';

        activitesGroupe.forEach(act => {
            const inscritsCount = act.inscriptions?.length || 0;
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
        alert('Erreur lors de l\'ouverture du modal');
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
        alert('Données introuvables');
        return;
    }

    const message = `Confirmer l'inscription de ${eleve.prenom} ${eleve.nom} à "${activite.titre}" ?`;

    if (!confirm(message)) return;

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
        alert('Erreur lors de l\'inscription : ' + e.message);
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

    const now = new Date();
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
        container.innerHTML = '<p class="muted text-center" style="padding: 20px;">Classe non définie</p>';
        return;
    }

    const now = new Date();
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
        container.innerHTML = '<p class="muted text-center" style="padding: 20px;">Aucune activité disponible</p>';
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
        detailsEl.className = 'panel-collapsible';
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

            const inscritsCount = act.inscriptions?.length || 0;

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
            actCard.className = 'activity-card' + (inscriptionsEleve ? ' selected' : '');

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
                <div class="activity-details">
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

                    const inscritsSeance = seance.inscriptions?.length || 0;
                    const effectifInfo = document.createElement('span');
                    effectifInfo.className = 'seance-effectif';
                    effectifInfo.textContent = `${inscritsSeance}/${act.effectif_max}`;
                    effectifInfo.style.fontSize = '10px';
                    effectifInfo.style.color = inscritsSeance >= act.effectif_max ? '#dd1738' : 'var(--muted)';
                    effectifInfo.style.fontWeight = '600';
                    effectifInfo.style.marginRight = '8px';

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
                btnContainer.style.marginTop = '8px';
                btnContainer.style.paddingTop = '8px';
                btnContainer.style.borderTop = '1px solid #e2e8f0';

                const btn = document.createElement('button');
                btn.className = 'btn';
                btn.style.width = '100%';

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
    // Programmer des rafraîchissements automatiques quand les périodes d'inscription ouvrent
    scheduleInscriptionOpenTimers();
}

/**
 * Mise à jour légère : ne rafraîchit que les compteurs d'inscrits
 * et les boutons d'inscription, sans recréer tout le DOM.
 * Utilisée par le SSE pour éviter de réinitialiser les sliders.
 */
function majComptesActivitesEleve() {
    const now = new Date();
    const classeId = Number(currentUser?.classe_id);
    if (!classeId || isNaN(classeId)) return;

    let needsFullRender = false;

    // Vérifier si une activité vient de devenir inscriptible (période qui vient d'ouvrir)
    activites.forEach(act => {
        if (!act.classe_ids.includes(classeId)) return;
        const ouverture = new Date(act.date_ouverture_inscriptions);
        // Si la période vient d'ouvrir (dans les 10 dernières secondes) → re-render complet
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
        const inscritsCount = act.inscriptions?.length || 0;

        // Trouver la card par data-activity-id
        const card = document.querySelector(`#liste-activites-eleve .activity-card[data-activity-id="${act.id}"]`);

        // Les cards n'ont pas de data-activity-id — on les trouve via le titre
        // On cherche dans toutes les cards
        const cards = document.querySelectorAll('#liste-activites-eleve .activity-card');
        cards.forEach(c => {
            const titre = c.querySelector('.activity-title')?.textContent;
            if (titre === act.titre) {
                // Mettre à jour le compteur inscrits
                const details = c.querySelectorAll('.activity-details');
                details.forEach(d => {
                    if (act.separable) {
                        if (d.textContent.includes('Inscriptions :')) {
                            d.innerHTML = `Inscriptions : ${inscritsCount} élève${inscritsCount > 1 ? 's' : ''} (effectif max par séance: ${act.effectif_max})`;
                        }
                    } else {
                        if (d.innerHTML.includes('inscrit')) {
                            d.innerHTML = `<strong>${inscritsCount}/${act.effectif_max}</strong> inscrit${inscritsCount > 1 ? 's' : ''}`;
                        }
                    }
                });

                // Mettre à jour les compteurs par séance (separable)
                if (act.separable) {
                    act.seances?.forEach(seance => {
                        const inscritsSeance = seance.inscriptions?.length || 0;
                        const items = c.querySelectorAll('.seance-item-eleve');
                        // Match par date (le texte du span date)
                        items.forEach(item => {
                            const dateSpan = item.querySelector('.seance-date');
                            if (dateSpan?.textContent === formatDateLocal(seance.date_heure)) {
                                const effectifSpan = item.querySelector('.seance-effectif');
                                if (effectifSpan) {
                                    effectifSpan.textContent = `${inscritsSeance}/${act.effectif_max}`;
                                    effectifSpan.style.color = inscritsSeance >= act.effectif_max ? '#dd1738' : 'var(--muted)';
                                }
                            }
                        });
                    });
                }
            }
        });
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

    title.textContent = activite.titre;

    const classesText = activite.classe_ids
        .map(id => classes.find(c => c.id === id)?.nom || '')
        .join(', ');

    const animateur = activite.animateur_prenom && activite.animateur_nom
        ? `${activite.animateur_prenom} ${activite.animateur_nom}`
        : 'Animateur non défini';

    const now = new Date();
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
            const inscritsSeance = seance.inscriptions?.length || 0;
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
        <div class="detail-row" style="align-items: flex-start;">
            <span class="detail-label">Séances:</span>
            ${seancesHtml}
        </div>
        ${activite.groupe_id ? `
        <div class="detail-row">
            <span class="detail-label">Groupe exclusif:</span>
            <span class="detail-value" style="color: var(--accent); font-weight: 600;">
                ${groupes.find(g => g.id === activite.groupe_id)?.nom || `Groupe #${activite.groupe_id}`}
            </span>
        </div>
        ` : ''}
    `;

    modal.classList.add('visible');
    fixShowActivityDetailsEleve();
}

async function inscrireActivite(activiteId) {
    try {
        // Vérification groupe d'exclusivité côté client (AMÉLIORÉE)
        const activite = activites.find(a => a.id === activiteId);
        if (activite && activite.groupe_id) {
            // Chercher si déjà inscrit à une autre activité du même groupe
            const conflit = activites.find(a => {
                if (a.groupe_id !== activite.groupe_id || a.id === activiteId) {
                    return false;
                }

                // Vérifier inscription selon le type d'activité
                if (a.separable) {
                    // Pour activité séparable, vérifier chaque séance
                    return a.seances?.some(seance =>
                        seance.inscriptions?.includes(currentUser.id)
                    );
                } else {
                    // Pour activité non séparable, vérifier inscription globale
                    return a.inscriptions?.includes(currentUser.id);
                }
            });

            if (conflit) {
                alert(`Impossible : vous êtes déjà inscrit à "${conflit.titre}" du même groupe d'activité.`);
                return;
            }
        }

        await apiPost('/inscriptions', {activite_id: activiteId});
        await fetchAllData();
        majListeActivitesEleve();
        updateEmploiDuTempsEleve();
    } catch(e) {
        alert('Erreur: ' + e.message);
    }
}

async function desinscrireActivite(activiteId) {
    if(!confirm('Veux-tu te désinscrire de cette activité ?')) return;
    try {
        await apiDelete('/inscriptions', {activite_id: activiteId});
        await fetchAllData();
        majListeActivitesEleve();
        updateEmploiDuTempsEleve();
    } catch(e) {
        alert('Erreur: ' + e.message);
    }
}

async function inscrireSeance(seanceId) {
    try {
        // Trouver l'activité correspondante
        const seance = activites.flatMap(a =>
            a.seances.map(s => ({...s, activite_id: a.id, groupe_id: a.groupe_id, separable: a.separable}))
        ).find(s => s.id === seanceId);

        if (!seance) {
            alert('Séance introuvable');
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
                alert(`Impossible : vous êtes déjà inscrit à "${conflit.titre}" du même groupe exclusif.`);
                return;
            }
        }

        await apiPost('/inscriptions/seance', {seance_id: seanceId});
        await fetchAllData();

        // Trouver l'activité mise à jour et rafraîchir le modal
        const activiteActualisee = activites.find(a => a.id === seance.activite_id);
        if (activiteActualisee) {
            showActivityDetailsEleve(activiteActualisee);
        }
        majListeActivitesEleve();
        updateEmploiDuTempsEleve();
    } catch(e) {
        alert('Erreur lors de l\'inscription : ' + e.message);
    }
}

async function desinscrireSeance(seanceId) {
    if (!confirm('Veux-tu te désinscrire de cette séance ?')) return;

    try {
        // Trouver l'activité avant désinscription
        const seance = activites.flatMap(a =>
            a.seances.map(s => ({...s, activite_id: a.id}))
        ).find(s => s.id === seanceId);

        await apiDelete('/inscriptions/seance', {seance_id: seanceId});
        await fetchAllData();

        // Trouver l'activité mise à jour et rafraîchir le modal
        if (seance) {
            const activiteActualisee = activites.find(a => a.id === seance.activite_id);
            if (activiteActualisee) {
                showActivityDetailsEleve(activiteActualisee);
            }
        }

        majListeActivitesEleve();
        updateEmploiDuTempsEleve();
    } catch(e) {
        alert('Erreur lors de la désinscription : ' + e.message);
    }
}

/* ===========================
    Interface Professeur
    =========================== */
function majListeActivitesProf() {
    const containerAnimees = $('#liste-activites-animees');
    const containerCreees = $('#liste-activites-creees');

    if (!containerAnimees || !containerCreees) return;

    const userId = currentUser?.id;
    const isAdmin = currentUser?.role === 'admin';

    // Séparer les activités animées et créées
    const activitesAnimees = isAdmin
        ? activites.filter(act => act.animateur_id !== act.prof_id) // Toutes les activités avec animateur différent
        : activites.filter(act => act.animateur_id === userId);

    const activitesCreees = isAdmin
        ? activites.filter(act => act.animateur_id === act.prof_id || !act.animateur_id) // Toutes les autres
        : activites.filter(act => act.prof_id === userId && act.animateur_id !== userId);


    // Fonction helper pour créer une carte d'activité
    function creerCarteActivite(act, container) {
        const inscritsCount = act.inscriptions?.length || 0;
        const classesText = act.classe_ids
            .map(id => classes.find(c => c.id === id)?.nom || '')
            .join(', ');

        const actCard = document.createElement('div');
        actCard.className = 'activity-card';
        actCard.dataset.activityId = act.id;

        // Vérifier si l'utilisateur est le créateur Ou admin
        const isCreator = act.prof_id === currentUser?.id || currentUser?.role === "admin";

        actCard.innerHTML = `
            <div class="activity-card-header">
                <h5 class="activity-title">${act.titre}</h5>
                <span class="activity-room">${act.salle}</span>
            </div>
            ${currentUser?.role === 'admin' && act.prof_id !== currentUser.id ? `
            <div class="text-10 font-semibold text-warning mb-8">
                🔑 ADMIN - Créée par ${getUserName(act.prof_id)}
            </div>
            ` : ''}
            <div class="activity-details">Classes: ${classesText}</div>
            <div class="activity-details">Inscrits: ${inscritsCount}/${act.effectif_max}</div>
            <div class="activity-meta">
                ${act.seances?.length || 0} séance(s) • ${act.separable ? 'Sécable' : 'Non sécable'}
            </div>
            ${isCreator ? `
                <div class="activity-actions" style="display: flex; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #e5e7eb;">
                    <button class="btn-action edit" title="Modifier">
                        <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor">
                            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                        </svg>
                    </button>
                    <button class="btn-action delete" title="Supprimer">
                        <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                    </button>
                </div>
            ` : ''}
        `;
        // Click pour détails gérer par les fonctions de listenners
        container.appendChild(actCard);
    }

    // Afficher les activités animées
    containerAnimees.innerHTML = '';
    if (activitesAnimees.length === 0) {
        containerAnimees.innerHTML = '<p class="muted small text-center" style="padding: 20px;">Aucune activité animée</p>';
    } else {
        activitesAnimees.forEach(act => creerCarteActivite(act, containerAnimees));
    }

    // Afficher les activités créées
    containerCreees.innerHTML = '';
    if (activitesCreees.length === 0) {
        containerCreees.innerHTML = '<p class="muted small text-center" style="padding: 20px;">Aucune activité créée</p>';
    } else {
        activitesCreees.forEach(act => creerCarteActivite(act, containerCreees));
    }
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

    title.textContent = activite.titre;

    const classesText = activite.classe_ids
        .map(id => classes.find(c => c.id === id)?.nom || '')
        .join(', ');

    const animateur = getUserName(activite.animateur_id || activite.prof_id);
    const inscriptions = activite.inscriptions || [];

    const now = new Date();

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
        <div class="detail-row" style="align-items: flex-start;">
            <span class="detail-label">Séances & Appel:</span>
            ${inscriptionsHtml}
        </div>
        ${activite.groupe_id ? `
        <div class="detail-row">
            <span class="detail-label">Groupe exclusif:</span>
            <span class="detail-value" style="color: var(--accent); font-weight: 600;">
                ${groupes.find(g => g.id === activite.groupe_id)?.nom || `Groupe #${activite.groupe_id}`}
            </span>
        </div>
        ` : ''}
    `;

    modal.classList.add('visible');
}

function closeActivityModal() {
    $('#activity-modal').classList.remove('visible');
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
            body.innerHTML = '<p class="muted text-center" style="padding: 20px;">Aucun élève inscrit</p>';
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
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding: 12px; background: #f8fafc; border-radius: 8px;">
                    <div>
                        <strong>${data.presences.length}</strong> élève(s) inscrit(s)
                    </div>
                    <div style="display: flex; gap: 8px;">
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
        alert('Erreur lors du chargement de l\'appel: ' + e.message);
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

        alert('Appel enregistré avec succès !');
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
        alert('Erreur lors de l\'enregistrement: ' + e.message);
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
    const container = $('#emploi-du-temps-prof');
    container.innerHTML = '';

    const monday = getMonday(new Date());
    monday.setDate(monday.getDate() + (currentWeekOffsetProf * 7));

    const dayNames = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    // Créer structure avec flexbox comme dans projet_visuel.html
    const table = document.createElement('div');
    table.className = 'schedule-table';

    // Colonne des heures
    const hourColumn = document.createElement('div');
    hourColumn.className = 'schedule-hour-cell';

    const spacer = document.createElement('div');
    spacer.className = 'day-header-spacer';
    hourColumn.appendChild(spacer);


    // Créer les cellules d'heures (7h à 18h) avec hauteur adaptative
    const width = window.innerWidth;
    let hourHeight;
    if (width >= 1920) hourHeight = 60;
    else if (width >= 1280) hourHeight = 50;
    else hourHeight = 40

    const totalContentHeight = hourHeight * 12; // Hauteur totale du contenu

    // Créer les cellules d'heures (7h à 18h)
    for (let hour = 7; hour <= 18; hour++) {
        const hourCell = document.createElement('div');
        hourCell.className = 'schedule-cell';
        hourCell.style.height = hourHeight + 'px'; // AJOUT : forcer la hauteur
        hourCell.textContent = `${hour.toString().padStart(2, '0')}:00`;
        hourColumn.appendChild(hourCell);
    }

    table.appendChild(hourColumn);

    // Grille des jours
    const daysGrid = document.createElement('div');
    daysGrid.className = 'days-grid';

    for (let i = 0; i < 7; i++) {
        const currentDay = new Date(monday);
        currentDay.setDate(currentDay.getDate() + i);
        currentDay.setHours(0, 0, 0, 0);

        const isToday = currentDay.getTime() === todayDate.getTime();

        const dayCol = document.createElement('div');
        dayCol.className = 'day-column';

        // Formatage de la date
        const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
        const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

        const dayLabel = dayNames[i];
        const dayNum = currentDay.getDate();
        const monthLabel = monthNames[currentDay.getMonth()];

        // En-tête du jour
        const header = document.createElement('div');
        header.className = `schedule-header-cell ${isToday ? 'today' : ''}`;
        header.textContent = `${dayLabel} ${dayNum} ${monthLabel}`;
        dayCol.appendChild(header);

        // Contenu du jour
        const content = document.createElement('div');
        content.className = `day-content ${isToday ? 'today-column' : ''}`;
        content.dataset.day = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'][i];

        // Lignes d'heures avec hauteur adaptative
        const totalHeight = hourHeight * 12;
        content.style.height = totalHeight + 'px';

        // Lignes d'heures (12 heures x 60px = 720px)
        for (let j = 0; j < 12; j++) {
            const line = document.createElement('div');
            line.className = 'hour-line';
            line.style.top = (j * hourHeight) + 'px';
            line.style.height = hourHeight + 'px';
            content.appendChild(line);
        }

        dayCol.appendChild(content);
        daysGrid.appendChild(dayCol);
    }

    table.appendChild(daysGrid);
    container.appendChild(table);
}

function updateScheduleViewProf() {
    createScheduleGridProf();

    const monday = getMonday(new Date());
    monday.setDate(monday.getDate() + (currentWeekOffsetProf * 7));
    monday.setHours(0, 0, 0, 0); // Normaliser à minuit

    const now = new Date();

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

                    const width = window.innerWidth;
                    let pixelsPerMinute;
                    if (width >= 1920) pixelsPerMinute = 1;
                    else if (width >= 1280) pixelsPerMinute = 50/60;
                    else pixelsPerMinute = 40/60;

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
    const container = $('#emploi-du-temps-eleve');
    container.innerHTML = '';

    const monday = getMonday(new Date());
    monday.setDate(monday.getDate() + (currentWeekOffsetEleve * 7));

    const dayNames = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    // Créer structure avec flexbox
    const table = document.createElement('div');
    table.className = 'schedule-table';

    // Colonne des heures
    const hourColumn = document.createElement('div');
    hourColumn.className = 'schedule-hour-cell';

    const spacer = document.createElement('div');
    spacer.className = 'day-header-spacer';
    hourColumn.appendChild(spacer);

    // Créer les cellules d'heures (7h à 18h) avec hauteur adaptive
    const width = window.innerWidth;
    let hourHeight;
    if (width >= 1920) hourHeight = 60;
    else if (width >= 1280) hourHeight = 50;
    else hourHeight = 40;

    for (let hour = 7; hour <= 18; hour++) {
        const hourCell = document.createElement('div');
        hourCell.className = 'schedule-cell';
        hourCell.textContent = `${hour.toString().padStart(2, '0')}:00`;
        hourColumn.appendChild(hourCell);
    }

    table.appendChild(hourColumn);

    // Grille des jours
    const daysGrid = document.createElement('div');
    daysGrid.className = 'days-grid';

    for (let i = 0; i < 7; i++) {
        const currentDay = new Date(monday);
        currentDay.setDate(currentDay.getDate() + i);
        currentDay.setHours(0, 0, 0, 0);

        const isToday = currentDay.getTime() === todayDate.getTime();

        const dayCol = document.createElement('div');
        dayCol.className = 'day-column';

        // Formatage de la date
        const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
        const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

        const dayLabel = dayNames[i];
        const dayNum = currentDay.getDate();
        const monthLabel = monthNames[currentDay.getMonth()];

        // En-tête du jour
        const header = document.createElement('div');
        header.className = `schedule-header-cell ${isToday ? 'today' : ''}`;
        header.textContent = `${dayLabel} ${dayNum} ${monthLabel}`;
        dayCol.appendChild(header);

        // Contenu du jour
        const content = document.createElement('div');
        content.className = `day-content ${isToday ? 'today-column' : ''}`;
        content.dataset.day = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'][i];

        // Lignes d'heures avec hauteur adaptative
        const totalHeight = hourHeight * 12;
        content.style.height = totalHeight + 'px';

        for (let j = 0; j < 12; j++) {
            const line = document.createElement('div');
            line.className = 'hour-line';
            line.style.top = (j * hourHeight) + 'px';
            line.style.height = hourHeight + 'px';
            content.appendChild(line);
        }

        dayCol.appendChild(content);
        daysGrid.appendChild(dayCol);
    }

    table.appendChild(daysGrid);
    container.appendChild(table);
}

function updateEmploiDuTempsEleve_old() {
    if (!currentUser) return;

    createScheduleGridEleve();

    const monday = getMonday(new Date());
    monday.setDate(monday.getDate() + (currentWeekOffsetEleve * 7));

    const now = new Date();

    activites.forEach(act => {
        const colors = getActivityColors(act.id);

        act.seances?.forEach(seance => {
            const estInscrit = seance.inscriptions?.includes(currentUser.id) || false;

            if (!estInscrit) return;

            const seanceDate = new Date(seance.date_heure);
            const duree = seance.duree || 60;

            const daysDiff = Math.floor((seanceDate - monday) / (1000 * 60 * 60 * 24));

            if (daysDiff >= 0 && daysDiff < 7) {
                const dayName = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'][daysDiff];
                const dayContent = document.querySelector(`#emploi-du-temps-eleve .day-content[data-day="${dayName}"]`);

                if (dayContent) {
                    const isPast = seanceDate < now;

                    const animateurId = act.animateur_id || act.prof_id;
                    const animateur = getUserById(animateurId);
                    const animateurNom = act.animateur_prenom && act.animateur_nom
                        ? `${act.animateur_prenom} ${act.animateur_nom}`
                        : 'Animateur non défini';

                    const topMinutes = timeToMinutes(seance.date_heure);

                    const seanceBlock = document.createElement('div');
                    seanceBlock.className = `seance-block-eleve activity-color-${act.id % 8} ${isPast ? 'past' : ''}`;
                    seanceBlock.dataset.activityId = act.id;
                    seanceBlock.style.top = `${topMinutes}px`;
                    seanceBlock.style.height = `${duree}px`;

                    const endDate = new Date(seanceDate.getTime() + duree * 60000);
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

                    seanceBlock.onclick = (e) => {
                        e.stopPropagation();
                        showActivityDetailsEleve(act);
                    };

                    dayContent.appendChild(seanceBlock);
                }
            }
        });
    });
}

function updateEmploiDuTempsEleve() {
    if (!currentUser) return;

    createScheduleGridEleve();

    const monday = getMonday(new Date());
    monday.setDate(monday.getDate() + (currentWeekOffsetEleve * 7));
    monday.setHours(0, 0, 0, 0); // Normaliser à minuit

    const now = new Date();

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

                    const width = window.innerWidth;
                    let pixelsPerMinute;
                    if (width >= 1920) pixelsPerMinute = 1;
                    else if (width >= 1280) pixelsPerMinute = 50/60;
                    else pixelsPerMinute = 40/60;

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
        <div class="modal-content" style="max-width: 500px;">
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
        alert('Erreur lors de la génération du PDF : ' + e.message);
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
        alert('Erreur : formulaire incomplet');
        return;
    }

    const titre = titreEl.value.trim();
    const description = icGet('description') || '';
    const salle = salleEl.value.trim();
    const effectif = parseInt(effectifEl.value);
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

            alert(`⚠️ Incohérence détectée !\n\nVous avez sélectionné le groupe "${nomGroupe}" mais les classes suivantes n'en font pas partie :\n${nomsClassesInvalides}\n\nVeuillez soit :\n• Changer de groupe d'exclusivité\n• Modifier les classes sélectionnées`);

            if(classeMultiSelect) classeMultiSelect.setError('Sélectionnez au moins une classe');
            hasError = true;
        }

        // Vérifier qu'au moins une classe du groupe est sélectionnée
        const hasClasseFromGroupe = selectedClasses.some(cid => classesGroupe.includes(cid));
        if (!hasClasseFromGroupe) {
            const nomGroupe = groupes.find(g => g.id === groupeId)?.nom || 'ce groupe';
            alert(`⚠️ Aucune classe du groupe "${nomGroupe}" n'est sélectionnée !\n\nVeuillez sélectionner au moins une classe faisant partie de ce groupe.`);
            if(classeMultiSelect) classeMultiSelect.setError('Sélectionnez au moins une classe');
            hasError = true;
        }
    }
    // ===== FIN NOUVELLE VALIDATION =====

    if (hasError) {alert('Veuillez remplir tous les champs obligatoires'); return;}

    const dateOuverture = new Date(ouverture);
    const dateFermeture = new Date(fermeture);

    if (isNaN(dateOuverture.getTime()) || isNaN(dateFermeture.getTime())) {
        alert('Dates invalides');
        return;
    }
    if (dateFermeture <= dateOuverture) {
        alert('La date de fermeture doit être après la date d\'ouverture');
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
        showToast('Activité créée avec succès !');
    } catch(e) {
        alert('Erreur lors de la création : ' + e.message);
    }
}

async function supprimerActivite(activiteId, titre) {
    if (!confirm(`⚠️ Confirmer la suppression ?\n\nActivité : "${titre}"\n\nToutes les séances, inscriptions et présences seront définitivement supprimées.`)) {
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

        alert('[OK] Activité supprimée avec succès');

    } catch (e) {
        alert('[KO] Erreur : ' + e.message);
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
            alert('Activité introuvable');
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
        alert('Erreur lors du chargement de l\'activité : ' + e.message);
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
        alert('Erreur : aucune activité en cours d\'édition');
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
        alert('Erreur : formulaire incomplet');
        return;
    }

    const titre = titreEl.value.trim();
    const description = icGet('description') || '';
    const salle = salleEl.value.trim();
    const effectif = parseInt(effectifEl.value);
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

    if (hasError) { alert('Veuillez remplir tous les champs obligatoires'); return; }

    const dateOuverture = new Date(ouverture);
    const dateFermeture = new Date(fermeture);

    if (isNaN(dateOuverture.getTime()) || isNaN(dateFermeture.getTime())) {
        alert('Dates invalides');
        return;
    }
    if (dateFermeture <= dateOuverture) {
        alert('La date de fermeture doit être après la date d\'ouverture');
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
        alert('[KO] Erreur lors de la modification : ' + e.message);
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


function ajouterSeanceHebdo(){
    const container = $('#seances-container');

    const start = new Date(icGet('first-hebdoseance'));
    const nbRaw = icGet('nb-seances');
    const nb = parseInt(nbRaw) || parseInt($('#nb-seances')?.value) || 0;
    const duree = parseInt(
        window._IC_instances?.['duree-hebdo']?.getValue() ||
        $('#duree-hebdo')?.value || 60
    );

    if (isNaN(start.getTime()) || !nb || nb < 1) {
        alert('Choisissez une date et un nombre valide');
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
        container.innerHTML = '<p class="muted text-center" style="padding: 20px;">Aucun groupe créé</p>';
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
            alert('Groupe introuvable');
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
                <svg viewBox="0 0 24 24" style="width:16px;height:16px;margin-right:4px;fill:currentColor">
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
        alert('Erreur lors de l\'édition du groupe : ' + e.message);
    }
}

async function creerGroupe() {
    const nom = $('#nouveau-groupe-nom').value.trim();

    // Validation nom
    if (!nom) {
        alert('[WARN] Veuillez saisir un nom de groupe');
        if (window._IC_instances?.['nouveau-groupe-nom']) window._IC_instances['nouveau-groupe-nom'].setError('Nom requis'); else $('#nouveau-groupe-nom').classList.add('error');
        return;
    }

    // Validation classes
    if (!groupeClasseMultiSelect || groupeClasseMultiSelect.selectedItems.length === 0) {
        alert('⚠️ Vous devez sélectionner au moins une classe pour ce groupe');
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
            alert('✓ Groupe modifié avec succès !');
        } else {
            // Mode création
            await apiPost('/groupes', {
                nom,
                description: '',
                classe_ids,
                echanges_actifs: echangesActifs
            });
            alert('✓ Groupe créé avec succès !');
        }

        await fetchAllData();
        populateSelects();
        majListeGroupes();
        initElevesNonInscrits();

        // Réinitialiser le formulaire
        annulerEditionGroupe();

    } catch(e) {
        alert('[KO] Erreur: ' + e.message);
    }
}

async function supprimerGroupe(groupeId, groupeNom) {
    if (!confirm(`Supprimer le groupe "${groupeNom}" ?\n\nNote: Impossible si des activités l'utilisent.`)) {
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
        alert('Groupe supprimé avec succès !');
    } catch(e) {
        alert('Erreur: ' + e.message);
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
        toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:var(--primary,#4f46e5);color:#fff;padding:12px 20px;border-radius:8px;font-size:14px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.2);transition:opacity .3s;max-width:320px;';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.style.opacity = '0'; }, duration);
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
    _initEchangesSSE();

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

    // Enter dans le champ nom du groupe → valider
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

    if (!confirm(`Voulez-vous vraiment désinscrire ${nomEleve} ?`)) return;

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
        alert('Erreur lors de la désinscription : ' + e.message);
    }
}






/* ===========================
    Event Listeners & SSE
    =========================== */
function initSSE() {
    if (!currentUser) {
        console.log('[SSE] Pas d\'utilisateur connecté, SSE non initialisé');
        return;
    }

    console.log('[SSE] Initialisation de la connexion...');

    // Fermer l'ancienne connexion si elle existe
    if (sseConnection) {
        sseConnection.close();
    }

    // Créer la nouvelle connexion
    sseConnection = new EventSource('/sse');

    sseConnection.onopen = () => {
        console.log('[SSE] [OK] Connexion établie');
        // Annuler tout timeout de reconnexion
        if (sseReconnectTimeout) {
            clearTimeout(sseReconnectTimeout);
            sseReconnectTimeout = null;
        }
    };

    sseConnection.onerror = (error) => {
        console.error('[SSE] [KO] Erreur de connexion:', error);
        sseConnection.close();

        // Reconnexion automatique après 5 secondes
        if (!sseReconnectTimeout && currentUser) {
            console.log('[SSE] Reconnexion dans 5 secondes...');
            sseReconnectTimeout = setTimeout(() => {
                sseReconnectTimeout = null;
                initSSE();
            }, 5000);
        }
    };

    // Écouter TOUS les événements
    sseConnection.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            // Ignorer heartbeat et connected
            if (data.type === 'heartbeat' || data.type === 'connected') {
                return;
            }

            console.log('[SSE] Événement reçu:', data);
        } catch(e) {
            console.warn('[SSE] Message non-JSON reçu:', event.data);
        }
    };

    // Écouter les événements typés
    sseConnection.addEventListener('inscription_created', handleInscriptionEvent);
    sseConnection.addEventListener('inscription_deleted', handleInscriptionEvent);
    sseConnection.addEventListener('inscription_seance_created', handleInscriptionEvent);
    sseConnection.addEventListener('inscription_seance_deleted', handleInscriptionEvent);
    sseConnection.addEventListener('inscription_manuelle_created', handleInscriptionEvent);
}

/**
 * Gère les événements d'inscription reçus via SSE
 */
async function handleInscriptionEvent(event) {
    try {
        const data = JSON.parse(event.data);
        console.log('[SSE] [INFO] Événement reçu:', event.type, data);

        // Recharger les données
        await fetchAllData();

        // Rafraîchir l'interface selon le rôle
        if (currentUser.role === 'eleve') {
            majComptesActivitesEleve();
            updateEmploiDuTempsEleve();
            console.log('[SSE] [OK] Interface élève mise à jour');
        } else if (currentUser.role === 'prof' || currentUser.role === 'admin') {
            majListeActivitesProf();
            updateScheduleViewProf();

            // Rafraîchir le panneau "élèves non inscrits" si ouvert
            { const gfv = icGet('groupe-filter-select'); if (gfv) await chargerElevesNonInscrits(gfv); }

            // Si le modal des détails est ouvert, le rafraîchir
            const modal = document.getElementById('activity-modal');
            if (modal && modal.classList.contains('visible')) {
                const modalTitle = document.getElementById('modal-title');
                const activiteTitre = modalTitle?.textContent;

                if (activiteTitre) {
                    const activite = activites.find(a => a.titre === activiteTitre);
                    if (activite) {
                        showActivityDetails(activite);
                    }
                }
            }

            console.log('[SSE] [OK] Interface prof mise à jour');
        }

    } catch (e) {
        console.error('[SSE] [KO] Erreur traitement événement:', e);
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

/* ===========================
   Event Listeners DOM
   =========================== */
document.addEventListener('DOMContentLoaded', function() {
    console.log('- DOM chargé, initialisation...');

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

        const hasValidSession = await checkAuthStatus();

        if (hasValidSession) {
            console.log('[OK] Session existante détectée');
            await fetchAllData();
        } else {
            console.log('Aucune session active, affichage du login');
            classes = [];
            users = [];
            activites = [];
        }

        onAuthChange();
        console.log('[OK] Application initialisée');
    } catch(e){
        console.error('[KO] Erreur lors de l\'initialisation:', e);
        const loginMsg = $('#login-msg');
        if(loginMsg) {
            loginMsg.textContent = 'Erreur de connexion au serveur';
        }
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

// -- Chargement des échanges ----------------------------------
let echangesData = { voeux: [], groupeId: null };
let filtreEchanges = 'tous'; // 'tous' | 'compatibles'

async function chargerEchangesEleve() {
    const panel = document.getElementById('echanges-panel');
    if (!panel) return;
    panel.innerHTML = '<p class="muted text-center" style="padding:40px 0">Chargement…</p>';

    // Trouver les groupes avec échanges actifs où l'élève est inscrit
    const groupesConcernes = groupes.filter(g =>
        g.echanges_actifs &&
        activites.some(a => a.groupe_id === g.id && a.inscriptions?.includes(currentUser.id))
    );

    if (groupesConcernes.length === 0) {
        panel.innerHTML = '<p class="muted text-center" style="padding:40px 0">Aucun groupe avec échanges actifs pour votre classe.</p>';
        return;
    }

    // Pour l'instant on prend le premier groupe (si plusieurs, on affiche un sélecteur)
    let groupeActif = groupesConcernes[0];
    if (groupesConcernes.length > 1) {
        // Afficher un sélecteur de groupe
        const selectHtml = `<div class="mb-16 flex items-center gap-12">
            <span class="font-semibold small">Groupe :</span>
            <select id="echanges-groupe-select" class="input-sm">
                ${groupesConcernes.map(g => `<option value="${g.id}">${g.nom}</option>`).join('')}
            </select>
        </div>`;
        panel.innerHTML = selectHtml + '<div id="echanges-content"></div>';
        document.getElementById('echanges-groupe-select').addEventListener('change', async (e) => {
            const g = groupesConcernes.find(g => g.id === parseInt(e.target.value));
            if (g) await chargerVoeuxGroupe(g, document.getElementById('echanges-content'));
        });
        await chargerVoeuxGroupe(groupeActif, document.getElementById('echanges-content'));
    } else {
        await chargerVoeuxGroupe(groupeActif, panel);
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

    // Mes vœux actifs
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

      <!-- Mes vœux -->
      <div class="echanges-section">
        <div class="echanges-section-header">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2a5 5 0 100 10A5 5 0 0012 2zM3 21a9 9 0 0118 0H3z"/></svg>
          <h4>Mes vœux d'échange</h4>
          <button class="btn" data-action="ouvrir-voeu" data-groupe-id="${groupe.id}">
            <svg class="icon" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/></svg>
            Formuler un vœu
          </button>
        </div>
        ${mesVoeux.length === 0
            ? '<p class="muted small">Vous n\'avez pas encore formulé de vœu d\'échange.</p>'
            : mesVoeux.map(v => renderCarteMonVoeu(v)).join('')
        }
      </div>

      <!-- Séparateur -->
      <div class="echanges-sep"></div>

      <!-- Vœux des autres -->
      <div class="echanges-section">
        <div class="echanges-section-header">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/>
          </svg>
          <h4>Vœux des autres élèves</h4>
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
      <button class="btn ghost btn-sm" data-action="retirer-voeu" data-voeu-id="${v.id}" title="Retirer ce vœu">
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
        return '<p class="muted small">Aucun vœu' + (filtreEchanges === 'compatibles' ? ' compatible' : '') + ' pour l\'instant.</p>';
    }
    return filtered.map(v => renderCarteVoeuAutre(v, monActivite)).join('');
}

function renderCarteVoeuAutre(v, monActivite) {
    // Est-ce un échange possible avec moi ?
    const compatible = monActivite && v.activite_cible_id === monActivite.id;

    // Mon vœu vers son activité actuelle ?
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
        ${compatible ? '<span class="voeu-badge-compat">Échange possible !</span>' : ''}
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

// -- Formuler un vœu -----------------------------------------
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
              Formuler ce vœu
            </button>
          </div>
        </div>`;
    }).join('');

    modal.innerHTML = `
      <div class="modal-content modal-large">
        <div class="modal-header">
          <h3>Formuler un vœu d'échange — ${groupe.nom}</h3>
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
                showToast('Vœu enregistré !');
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
    if (!confirm('Retirer ce vœu d\'échange ?')) return;
    try {
        await fetch(`/echanges/voeux/${voeuId}`, { method: 'DELETE', credentials: 'same-origin' });
        showToast('Vœu retiré.');
        await fetchAllData();
        chargerEchangesEleve();
    } catch(e) {
        showToast('Erreur : ' + e.message, 4000);
    }
}

async function proposerEchange(voeuAId, voeuBId) {
    if (!confirm('Proposer cet échange à l\'élève concerné ? Il devra accepter avant validation.')) return;
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
    container.innerHTML = '<p class="muted text-center" style="padding:20px 0">Chargement…</p>';
    try {
        const procs = await apiGet('/echanges/procedures/pending');
        if (procs.length === 0) {
            container.innerHTML = '<p class="muted text-center" style="padding:40px 0">Aucun échange en attente de validation.</p>';
            return;
        }
        // Badge
        const badge = document.getElementById('badge-pending');
        if (badge) { badge.textContent = procs.length; badge.classList.toggle('hidden', procs.length === 0); }

        container.innerHTML = procs.map(p => `
          <div class="echange-pending-card">
            <div class="echange-pending-groupe">${p.groupe_nom}</div>
            <div class="echange-pending-body">
              <div class="echange-pending-side">
                <strong>${p.prenom_a} ${p.nom_a}</strong>
                <span class="voeu-from">${p.titre_a}</span>
                <svg class="voeu-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
                <span class="voeu-to">${p.titre_cible_a}</span>
              </div>
              <div class="echange-pending-swap">⇄</div>
              <div class="echange-pending-side">
                <strong>${p.prenom_b} ${p.nom_b}</strong>
                <span class="voeu-from">${p.titre_b}</span>
                <svg class="voeu-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
                <span class="voeu-to">${p.titre_cible_b}</span>
              </div>
            </div>
            <div class="echange-pending-actions">
              <span class="muted small">Accord des deux élèves : ${p.date_accord_b ? new Date(p.date_accord_b).toLocaleDateString('fr-FR') : '—'}</span>
              <button class="btn" data-action="valider-echange" data-proc-id="${p.id}">
                <svg class="icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor"/></svg>
                Valider l'échange
              </button>
              <button class="btn secondary" data-action="annuler-echange" data-proc-id="${p.id}">
                Refuser
              </button>
            </div>
          </div>
        `).join('');
    } catch(e) {
        container.innerHTML = `<p class="text-error text-center">${e.message}</p>`;
    }
}

async function validerEchange(procId) {
    if (!confirm('Valider définitivement cet échange ? Les inscriptions seront permutées.')) return;
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
    if (!confirm('Refuser cet échange ? Les deux vœux resteront actifs.')) return;
    try {
        await apiPost(`/echanges/procedures/${procId}/annuler`, {});
        showToast('Échange refusé.');
        chargerPendingProcedures();
    } catch(e) {
        showToast('Erreur : ' + e.message, 4000);
    }
}

// -- SSE : écouter echanges_update ---------------------------
function _initEchangesSSE() {
    // Hooker sur l'événement SSE global déjà en place
    const origHandler = window._sseHandlers?.echanges_update;
    if (!origHandler) {
        if (!window._sseHandlers) window._sseHandlers = {};
        window._sseHandlers['echanges_update'] = (data) => {
            // Rafraîchir si l'onglet échanges est actif
            const tab = document.querySelector('[data-eleve-tab="echanges"].active');
            if (tab) chargerEchangesEleve();
            // Rafraîchir le badge pending prof
            if (currentUser?.role !== 'eleve') chargerPendingProcedures();
        };
    }
}

