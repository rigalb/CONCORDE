/* ===========================
   Configuration & Variables
   =========================== */
const MODE = 'reel';
let currentUser = null;
let users = [];
let classes = [];
let activites = [];
let currentWeekOffsetProf = 0;
let currentWeekOffsetEleve = 0;
let groupes = [];
// Variable globale pour stocker l'instance Select_Comp
let classeMultiSelect = null;

let groupeClasses = [];
let groupeClasseMultiSelect = null; // Instance Select_Comp pour les classes de groupe
let groupeEditMode = false;
let currentEditGroupeId = null;

isSyncingClasses = false; //flag global
let editingActivityId = null;

// Mode DEV
if(MODE === 'dev') {
  document.body.classList.add('dev-mode');
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

        // === BOUTONS MINI DANS MODAL (sauf btn-unregister) ===
        if (btn && btn.classList.contains('btn-mini') && !btn.classList.contains('btn-unregister')) {
            e.stopPropagation();
            // Extraire l'ID de la séance depuis l'attribut onclick (si présent)
            const onclickAttr = btn.getAttribute('onclick');
            if (onclickAttr) {
                const match = onclickAttr.match(/(inscrireSeance|desinscrireSeance)\((\d+)\)/);
                if (match) {
                    const func = match[1];
                    const seanceId = parseInt(match[2]);
                    if (func === 'inscrireSeance') inscrireSeance(seanceId);
                    else if (func === 'desinscrireSeance') desinscrireSeance(seanceId);
                }
            }
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

        // === BOUTONS RAPPEL INSCRIPTION ===
        if (btn && btn.classList.contains('btn-rappel')) {
            e.stopPropagation();
            const groupeId = parseInt(btn.dataset.groupeId);
            const eleveId = parseInt(btn.dataset.eleveId);
            envoyerRappelInscription(groupeId, eleveId, btn);
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

async function demoLogin(username){
    if(MODE !== 'dev') return;
    try{
        const data = await apiPost('/login', {username, password: '123'});
        if(data.success) {
            currentUser = data;
            await fetchAllData();
            onAuthChange();
        }
    } catch(e){
        console.error('Demo login error:', e);
    }
}

async function logout(){
    try{
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
    } else {
        $('#user-badge').style.display='none';
        $('#logout-btn').classList.add('hidden');
        $('#login-card').classList.remove('hidden');
        cacherToutesPages();
    }
    $('#count-acts').textContent=activites.length;
    $('#count-users').textContent=users.length;
    updateSidePanels();
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
    // Détruire l'ancienne instance PROPREMENT
    if (classeMultiSelect) {
        try {
            classeMultiSelect.destroy();
            classeMultiSelect = null;
        } catch(e) {
            console.warn('Erreur destruction MultiSelect:', e);
        }
    }

    // Recréer le select HTML
    const selectEl = $('#classe-select');
    if (selectEl) {
        // Vider le parent et recréer le select
        const parent = selectEl.parentElement;
        selectEl.remove();

        const newSelect = document.createElement('select');
        newSelect.id = 'classe-select';
        parent.appendChild(newSelect);
    }

    // Préparer les données pour MultiSelect
    const classesData = classes.map(cl => ({
        value: cl.id.toString(),
        text: cl.nom
    }));

    // Initialiser MultiSelect
    if ($('#classe-select')) {
        classeMultiSelect = new MultiSelect('#classe-select', {
            data: classesData,
            placeholder: 'Sélectionner les classes',
            search: true,
            selectAll: true,
            listAll: true,
            onChange: function(value, text, element) {
                if (isSyncingClasses) return;
                if (classeMultiSelect.selectedItems.length > 0) {
                    $('#classe-select').classList.remove('error');
                }
                verifierCoherenceGroupeClasses();
            }
        });
        classeMultiSelect.enable();
    }

    const animSelect = $('#animateur-select');
    if(animSelect){
        animSelect.innerHTML='';
        const profs = users.filter(u=>u.role==='prof'||u.role==='admin');
        profs.forEach(p=>{
            const opt=document.createElement('option');
            opt.value=p.id;
            opt.textContent=`${p.prenom} ${p.nom||''}`;
            animSelect.appendChild(opt);
        });
        const defaultId = (currentUser && currentUser.role==='prof') ? currentUser.id : (profs[0]?.id||'');
        if(defaultId) animSelect.value=defaultId;
    }

    const groupeSelect = $('#groupe-select');
    if (groupeSelect) {
        groupeSelect.innerHTML = '<option value="">Aucun groupe</option>';
        groupes.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.nom;
            groupeSelect.appendChild(opt);
        });

        // Écouteur pour synchroniser les classes
        groupeSelect.onchange = () => {
            synchroniserClassesAvecGroupe();
        };
    }
}

function verifierCoherenceGroupeClasses() {
    const groupeSelect = $('#groupe-select');
    if (!groupeSelect || !groupeSelect.value) return;

    const groupeId = parseInt(groupeSelect.value);
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
    const groupeSelect = $('#groupe-select');
    if (!groupeSelect || !classeMultiSelect) return;

    const groupeId = groupeSelect.value;

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
        title.innerHTML = `Modifier l'activité "<span style="color: var(--primary);">${activite?.titre || ''}</span>"`;
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
        separableCheckbox.style.opacity = '0.5';
        separableCheckbox.style.cursor = 'not-allowed';

        const label = document.querySelector('label[for="separable"]');
        if (label) {
            label.style.opacity = '0.5';
            label.style.cursor = 'not-allowed';
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
        separableCheckbox.style.opacity = '1';
        separableCheckbox.style.cursor = 'pointer';

        const label = document.querySelector('label[for="separable"]');
        if (label) {
            label.style.opacity = '1';
            label.style.cursor = 'pointer';
            label.title = '';
        }
    }

    console.log('[OK] Mode création restauré');
}

/* ===========================
   NOUVELLE FONCTIONNALITÉ: Élèves non inscrits
   =========================== */
function initElevesNonInscrits() {
    const groupeFilterSelect = $('#groupe-filter-select');
    if (!groupeFilterSelect) return;

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
            activitesProf
                .filter(a => a.groupe_id != null)
                .map(a => a.groupe_id)
        )];

        // Filtrer les groupes correspondants
        groupesProf = groupes.filter(g => groupeIds.includes(g.id));
    }


    // Remplir le sélecteur de groupes UNIQUEMENT avec les groupes du prof
    if (groupesProf.length === 0) {
        groupeFilterSelect.innerHTML = '<option value="">Aucun groupe disponible</option>';
        groupeFilterSelect.disabled = true;
        const msgNoGroupe = $('#msg-no-groupe');
        if (msgNoGroupe) {
            msgNoGroupe.textContent = 'Aucune de vos activités n\'est associée à un groupe';
            msgNoGroupe.style.display = 'block';
        }
    } else {
        groupeFilterSelect.innerHTML = '<option value="">-- Choisir un groupe --</option>';
        groupesProf.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.nom;
            groupeFilterSelect.appendChild(opt);
        });
        groupeFilterSelect.disabled = false;
        const msgNoGroupe = $('#msg-no-groupe');
        if (msgNoGroupe) {
            msgNoGroupe.textContent = 'Sélectionnez un groupe pour voir les élèves non inscrits';
            msgNoGroupe.style.display = 'block';
        }
    }

    console.log(`[OK] ${groupesProf.length} groupe(s) disponible(s) pour le prof`);

    // Écouteur de changement
    groupeFilterSelect.onchange = () => {
        const groupeId = groupeFilterSelect.value;
        if (groupeId) {
            chargerElevesNonInscrits(groupeId);
        } else {
            const container = $('#liste-eleves-non-inscrits');
            if (container) container.innerHTML = '';
            $('#msg-no-groupe').style.display = 'block';
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
                <button class="btn-rappel" onclick="envoyerRappelInscription(${groupeId}, ${eleve.id}, this)" ${!eleve.email ? 'disabled title="Pas d\'email"' : ''}>
                    📧 Envoyer rappel
                </button>
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
        btn.style.background = '#10b981';

        setTimeout(() => {
            chargerElevesNonInscrits(groupeId);
        }, 2000);
    } catch(e) {
        alert('Erreur: ' + e.message);
        btn.disabled = false;
        btn.textContent = originalText;
    }
}


/* ===========================
   Interface Élève
   =========================== */
function majListeActivitesEleve() {
    const container = $('#liste-activites-eleve');
    if (!container) return;

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
        const ouverture = new Date(act.date_ouverture_inscriptions);
        const fermeture = new Date(act.date_fermeture_inscriptions);

        if(!(act.visible_avant*1) && now < ouverture) return false;

        const allPassed = (act.seances || []).every(s => new Date(s.date_heure) < now);
        if(!act.classe_ids.includes(classeId)) return false;

        if(now > fermeture && allPassed) return false;

        return true;
    });

    if (activitesEleve.length === 0) {
        container.innerHTML = '<p class="muted text-center" style="padding: 20px;">Aucune activité disponible</p>';
        $('#stat-act-eleve').textContent = '0';
        $('#stat-insc-eleve').textContent = '0';
        return;
    }

    activitesEleve.forEach(act => {
        totalAct++;

        // Nombre TOTAL d'inscrits (tous élèves confondus)
        const inscritsCount = act.inscriptions?.length || 0;

        const classesText = act.classe_ids
            .map(id => classes.find(c => c.id === id)?.nom || '')
            .join(', ');

        // CORRECTIF : Vérification correcte de l'inscription de l'élève
        let inscriptionsEleve = false;

        if (act.separable) {
            // Pour activité séparable : vérifier si inscrit à AU MOINS une séance
            inscriptionsEleve = act.seances.some(seance =>
                seance.inscriptions?.includes(currentUser.id)
            );
        } else {
            // Pour activité non séparable : vérifier inscription globale
            inscriptionsEleve = act.inscriptions?.includes(currentUser.id) || false;
        }

        if(inscriptionsEleve) totalIns++;

        const actCard = document.createElement('div');
        actCard.className = 'activity-card';

        // Afficher l'animateur
        // const animateurId = act.animateur_id || act.prof_id;
        // const animateur = getUserById(animateurId);
        // const animateurNom = animateur ? `${animateur.prenom} ${animateur.nom}` : 'Animateur non défini';
        const animateurNom = act.animateur_prenom && act.animateur_nom
        ? `${act.animateur_prenom} ${act.animateur_nom}`
        : 'Animateur non défini';

        actCard.innerHTML = `
            <div class="activity-card-header">
                <h5 class="activity-title">${act.titre}</h5>
                <span class="activity-room">${act.salle}</span>
            </div>
            <div class="activity-details small muted mb-1">
                👤 ${animateurNom}
            </div>
            ${act.groupe_id ? `
                <div class="flex items-center gap-4 mb-6 text-accent text-11 font-semibold">
                    <svg class="w-12 h-12 svg-fill-current" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
                    </svg>
                    Groupe d'Activité : ${groupes.find(g => g.id === act.groupe_id)?.nom || 'Non défini'}
                </div>
            ` : ''}
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
            // ========================================
            // ACTIVITÉ SÉCABLE - BOUTONS PAR SÉANCE
            // ========================================
            const seancesContainer = actCard.querySelector('.activity-seances');
            act.seances?.forEach(seance => {
                const seanceDate = new Date(seance.date_heure);
                const seancePassee = seanceDate < now;

                const seanceItem = document.createElement('div');
                seanceItem.className = 'seance-item-eleve';

                const dateSpan = document.createElement('span');
                dateSpan.className = 'seance-date';
                dateSpan.textContent = formatDateLocal(seance.date_heure);

                // AFFICHAGE DE L'EFFECTIF PAR SÉANCE
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

                // Vérifier l'inscription à CETTE séance spécifique (CORRECTIF)
                const estInscritSeance = seance.inscriptions?.includes(currentUser.id) || false;

                // Vérifier l'inscription à CETTE séance spécifique (CORRECTIF)
                if (seancePassee) {
                    btn.textContent = 'Passée';
                    btn.className += ' ferme';
                    btn.disabled = true;
                } else if (!inscriptionsOuvertes) {
                    btn.textContent = 'Fermée';
                    btn.className += ' ferme';
                    btn.disabled = true;
                } else if (estInscritSeance) {
                    // L'élève EST inscrit à cette séance --> Bouton désinscrire
                    btn.textContent = 'Inscrit ✓';
                    btn.className += ' inscrit';
                    btn.dataset.action = 'desinscrire';
                } else if (inscritsSeance >= act.effectif_max) {
                    // Séance complète
                    btn.textContent = 'Complète';
                    btn.className += ' ferme';
                    btn.disabled = true;
                } else {
                    // L'élève N'est PAS inscrit --> Bouton inscrire
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
            // ========================================
            // ACTIVITÉ NON SÉCABLE - BOUTON GLOBAL
            // ========================================
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
                // L'élève EST inscrit à l'activité --> Bouton désinscrire
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
                // L'élève N'est PAS inscrit --> Bouton inscrire
                btn.textContent = "S'inscrire (toutes séances)";
                btn.onclick = (e) => {
                    e.stopPropagation();
                    inscrireActivite(act.id);
                };
            }

            btnContainer.appendChild(btn);
            actCard.appendChild(btnContainer);
        }

        // Click sur la carte pour voir les détails (sauf sur les boutons)
        actCard.addEventListener('click', (e) => {
            if (!e.target.closest('button')) {
                showActivityDetailsEleve(act);
            }
        });

        container.appendChild(actCard);
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
                    btnAction = `<button class="btn-mini secondary" onclick="event.stopPropagation(); desinscrireSeance(${seance.id})">Se désinscrire</button>`;
                }
            } else if (seanceComplete) {
                statutBadge = '<span class="seance-status full">Complète</span>';
            } else {
                statutBadge = '<span class="seance-status available">Places disponibles</span>';
                if (activite.separable) {
                    btnAction = `<button class="btn-mini primary" onclick="event.stopPropagation(); inscrireSeance(${seance.id})">S'inscrire</button>`;
                }
            }

            seancesHtml += `
                <div class="seance-detail-item-eleve ${estInscritSeance ? 'inscrit' : ''}">
                    <div class="seance-detail-info">
                        <div class="seance-detail-date">📅 ${seanceDateStr}</div>
                        <div class="seance-detail-count">${inscritsSeance}/${activite.effectif_max} inscrit(s)</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
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
        const select = $('#groupe-filter-select');

        if (!select) return;

        // Récupérer toutes les activités du prof (créées OU animées)
        const activitesProf = activites.filter(a =>
            a.prof_id === userId || a.animateur_id === userId
        );

        // Extraire les groupes uniques de ces activités
        const groupeIds = [...new Set(
            activitesProf
                .filter(a => a.groupe_id != null)
                .map(a => a.groupe_id)
        )];

        // Filtrer les groupes correspondants
        const groupesProf = groupes.filter(g => groupeIds.includes(g.id));

        // Peupler le select
        if (groupesProf.length === 0) {
            select.innerHTML = '<option value="">Aucun groupe disponible</option>';
            select.disabled = true;
            $('#msg-no-groupe').textContent = 'Aucune de vos activités n\'est associée à un groupe';
        } else {
            select.innerHTML = '<option value="">-- Choisir un groupe --</option>' +
                groupesProf.map(g => `<option value="${g.id}">${g.nom}</option>`).join('');
            select.disabled = false;
            $('#msg-no-groupe').textContent = 'Sélectionnez un groupe pour voir les élèves non inscrits';
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

            const btnPrint = `<button class="appel-btn faire" onclick="event.stopPropagation(); ouvrirModalPDF(${seance.id})">
                <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px">
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
                <div class="inscriptions-list" style="max-height: 120px; margin-bottom: 12px;">
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
                        <button class="btn-tri ${triActuel === 'nom' ? 'active' : ''}" onclick="trierAppel('nom')">
                            Trier par nom
                        </button>
                        <button class="btn-tri ${triActuel === 'classe' ? 'active' : ''}" onclick="trierAppel('classe')">
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
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <button class="btn-presence ${p.present ? 'active' : ''}"
                                        onclick="togglePresence(${p.eleve_id}, true)"
                                        ${consultation ? 'disabled' : ''}>
                                    Présent
                                </button>
                                <button class="btn-absence ${!p.present ? 'active' : ''}"
                                        onclick="togglePresence(${p.eleve_id}, false)"
                                        ${consultation ? 'disabled' : ''}>
                                    Absent
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
                ${!consultation ? `
                    <div style="display: flex; gap: 12px; margin-top: 16px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
                        <button class="btn" onclick="enregistrerAppel(${seanceId})">
                            <svg class="icon" viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" fill="currentColor"/></svg>
                            Enregistrer l'appel
                        </button>
                        <button class="btn secondary" onclick="fermerModalAppel()">Annuler</button>
                    </div>
                ` : `
                    <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
                        <button class="btn secondary" onclick="fermerModalAppel()">Fermer</button>
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

        // Lignes d'heures (12 heures × 60px = 720px)
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

                    seanceBlock.onclick = (e) => {
                        e.stopPropagation();
                        showActivityDetails(act);
                        highlightActiviteInScheduleProf(act);
                    };

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


/* ===========================
   Reset form
   =========================== */
function resetForm(){
    $('#titre').value='';
    $('#description').value='';
    $('#salle').value='';
    $('#effectif').value='';
    $('#seances-container').innerHTML='';
    $('#first-hebdoseance').value='';
    $('#nb-seances').value=4;
    $('#ouverture').value='';
    $('#fermeture').value='';

    // Remettre animateur par défaut et visible_avant à false
    if($('#animateur-select')){
        const profs = users.filter(u => u.role === 'prof' || u.role === 'admin');
        $('#animateur-select').value = (currentUser && currentUser.role === 'prof') ? currentUser.id : (profs[0]?.id || '');
    }
    if($('#visible-avant')) $('#visible-avant').checked = false;
    if($('#separable')) $('#separable').checked = true;
    if($('#groupe-select')) $('#groupe-select').value = '';

    // Réinitialiser MultiSelect
    if (classeMultiSelect) {
        classeMultiSelect.selectedItems.forEach(item => {
            classeMultiSelect.unselect(item.value);
        });
        classeMultiSelect.enable(); // On initialise activé
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
                <button class="modal-close" onclick="fermerModalPDF()">&times;</button>
            </div>
            <div class="modal-body">
                <p class="muted" style="margin-bottom: 20px;">
                    Personnalisez les informations à inclure dans le PDF
                </p>

                <div class="form-group" style="margin-bottom: 16px;">
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                        <input type="checkbox" id="pdf-show-appel" checked>
                        <span>Colonne "Présent" (cases à cocher pour l'appel)</span>
                    </label>
                </div>

                <div class="form-group" style="margin-bottom: 16px;">
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                        <input type="checkbox" id="pdf-show-emargement" checked>
                        <span>Colonne "Émargement" (signature des élèves)</span>
                    </label>
                </div>

                <div class="form-group" style="margin-bottom: 20px;">
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                        <input type="checkbox" id="pdf-show-commentaire">
                        <span>Colonne "Commentaire"</span>
                    </label>
                </div>

                <div style="display: flex; gap: 12px;">
                    <button class="btn" onclick="genererPDF(${seanceId})">
                        <svg class="icon" viewBox="0 0 24 24">
                            <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" fill="currentColor"/>
                        </svg>
                        Générer le PDF
                    </button>
                    <button class="btn secondary" onclick="fermerModalPDF()">Annuler</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

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
    const descriptionEl = $('#description');
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

    if (!titreEl || !salleEl || !effectifEl || !classeSelectEl || !ouvertureEl || !fermetureEl || !seancesContainer) {
        alert('Erreur : formulaire incomplet');
        return;
    }

    const titre = titreEl.value.trim();
    const description = descriptionEl ? descriptionEl.value.trim() : '';
    const salle = salleEl.value.trim();
    const effectif = parseInt(effectifEl.value);
    const separable = separableEl ? separableEl.checked : true;
    const selectedClasses = classeMultiSelect ? classeMultiSelect.selectedItems.map(item => parseInt(item.value)) : [];

    // Récupérer les séances AVEC DURÉES
    const seances = Array.from(document.querySelectorAll('.seance-item'))
        .map((item, idx)=>{
            const input = item.querySelector('.seance-input');
            const selectDuree = item.querySelector('.duree-select');
            return {
                date_heure: input.value,
                duree: selectDuree ? parseInt(selectDuree.value) : 60
            };
        })
        .filter(s=>s.date_heure);

    const ouverture = ouvertureEl.value;
    const fermeture = fermetureEl.value;
    const groupeId = groupeSelectEl && groupeSelectEl.value ? parseInt(groupeSelectEl.value) : null;

    // Trouver le header du MultiSelect
    const multiSelectHeader = classeSelectEl.parentElement.querySelector('.multi-select-header');

    // Validation
    let hasError = false;
    [titreEl, salleEl, effectifEl, ouvertureEl, fermetureEl].forEach(el => {
        if(el) el.classList.remove('error');
    });

    if(multiSelectHeader) multiSelectHeader.classList.remove('error');

    $all('.seance-input').forEach(inp => inp.classList.remove('error'));
    if(seancesContainer) seancesContainer.classList.remove('error');

    if (!titre) { titreEl.classList.add('error'); hasError = true; }
    if (!salle) { salleEl.classList.add('error'); hasError = true; }
    if (!effectif || isNaN(effectif) || effectif < 1 || effectif > 100) {
        effectifEl.classList.add('error');
        hasError = true;
    }
    if (selectedClasses.length === 0) {
        if(multiSelectHeader) multiSelectHeader.classList.add('error');
        hasError = true;
    }
    if (!ouverture) { ouvertureEl.classList.add('error'); hasError = true; }
    if (!fermeture) { fermetureEl.classList.add('error'); hasError = true; }
    if (seances.length === 0) {
        seancesContainer.classList.add('error');
        hasError = true;
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

            if(multiSelectHeader) multiSelectHeader.classList.add('error');
            hasError = true;
        }

        // Vérifier qu'au moins une classe du groupe est sélectionnée
        const hasClasseFromGroupe = selectedClasses.some(cid => classesGroupe.includes(cid));
        if (!hasClasseFromGroupe) {
            const nomGroupe = groupes.find(g => g.id === groupeId)?.nom || 'ce groupe';
            alert(`⚠️ Aucune classe du groupe "${nomGroupe}" n'est sélectionnée !\n\nVeuillez sélectionner au moins une classe faisant partie de ce groupe.`);
            if(multiSelectHeader) multiSelectHeader.classList.add('error');
            hasError = true;
        }
    }
    // ===== FIN NOUVELLE VALIDATION =====

    if (hasError) {
        alert('Veuillez remplir tous les champs obligatoires');
        return;
    }

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

    const animateurId = animateurSelectEl ? parseInt(animateurSelectEl.value) : currentUser.id;
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
        alert('Activité créée et enregistrée en base!');
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

        // Pré-remplir le formulaire
        $('#titre').value = activite.titre;
        $('#description').value = activite.description || '';
        $('#salle').value = activite.salle;
        $('#effectif').value = activite.effectif_max;
        $('#visible-avant').checked = !!activite.visible_avant;

        // Animateur
        if ($('#animateur-select')) {
            $('#animateur-select').value = activite.animateur_id || activite.prof_id;
        }

        // Groupe
        if ($('#groupe-select')) {
            $('#groupe-select').value = activite.groupe_id || '';
        }

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
        $('#ouverture').value = formatDateInputLocal(new Date(activite.date_ouverture_inscriptions));
        $('#fermeture').value = formatDateInputLocal(new Date(activite.date_fermeture_inscriptions));

        // Séances
        const seancesContainer = $('#seances-container');
        seancesContainer.innerHTML = '';

        activite.seances.forEach(seance => {
            const d = document.createElement('div');
            d.className = 'seance-item manual';
            d.dataset.seanceId = seance.id; // Stocker l'ID de la séance

            const inp = document.createElement('input');
            inp.type = 'datetime-local';
            inp.className = 'seance-input';
            inp.value = formatDateInputLocal(new Date(seance.date_heure));

            const span = document.createElement('div');
            span.className = 'small muted';
            span.style.minWidth = '110px';
            span.textContent = 'Séance existante';

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
            selectDuree.value = seance.duree || 60;

            const del = document.createElement('button');
            del.className = 'btn ghost';
            del.textContent = '✖';
            del.onclick = () => d.remove();

            d.appendChild(span);
            d.appendChild(inp);
            d.appendChild(selectDuree);
            d.appendChild(del);
            seancesContainer.appendChild(d);
        });

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
    const descriptionEl = $('#description');
    const salleEl = $('#salle');
    const effectifEl = $('#effectif');
    const classeSelectEl = $('#classe-select');
    const ouvertureEl = $('#ouverture');
    const fermetureEl = $('#fermeture');
    const seancesContainer = $('#seances-container');
    const groupeSelectEl = $('#groupe-select');
    const animateurSelectEl = $('#animateur-select');
    const visibleAvantEl = $('#visible-avant');

    if (!titreEl || !salleEl || !effectifEl || !classeSelectEl || !ouvertureEl || !fermetureEl || !seancesContainer) {
        alert('Erreur : formulaire incomplet');
        return;
    }

    const titre = titreEl.value.trim();
    const description = descriptionEl ? descriptionEl.value.trim() : '';
    const salle = salleEl.value.trim();
    const effectif = parseInt(effectifEl.value);
    const selectedClasses = classeMultiSelect ? classeMultiSelect.selectedItems.map(item => parseInt(item.value)) : [];

    // Récupérer les séances avec leurs IDs
    const seances = Array.from(document.querySelectorAll('.seance-item'))
        .map(item => {
            const input = item.querySelector('.seance-input');
            const selectDuree = item.querySelector('.duree-select');
            const seanceId = item.dataset.seanceId; // ID si séance existante

            return {
                id: seanceId ? parseInt(seanceId) : null,
                date_heure: input.value,
                duree: selectDuree ? parseInt(selectDuree.value) : 60
            };
        })
        .filter(s => s.date_heure);

    const ouverture = ouvertureEl.value;
    const fermeture = fermetureEl.value;
    const groupeId = groupeSelectEl && groupeSelectEl.value ? parseInt(groupeSelectEl.value) : null;

    const multiSelectHeader = classeSelectEl.parentElement.querySelector('.multi-select-header');

    // Validation (même que creerActivite)
    let hasError = false;
    [titreEl, salleEl, effectifEl, ouvertureEl, fermetureEl].forEach(el => {
        if (el) el.classList.remove('error');
    });

    if (multiSelectHeader) multiSelectHeader.classList.remove('error');
    $all('.seance-input').forEach(inp => inp.classList.remove('error'));
    if (seancesContainer) seancesContainer.classList.remove('error');

    if (!titre) { titreEl.classList.add('error'); hasError = true; }
    if (!salle) { salleEl.classList.add('error'); hasError = true; }
    if (!effectif || isNaN(effectif) || effectif < 1 || effectif > 100) {
        effectifEl.classList.add('error');
        hasError = true;
    }
    if (selectedClasses.length === 0) {
        if (multiSelectHeader) multiSelectHeader.classList.add('error');
        hasError = true;
    }
    if (!ouverture) { ouvertureEl.classList.add('error'); hasError = true; }
    if (!fermeture) { fermetureEl.classList.add('error'); hasError = true; }
    if (seances.length === 0) {
        seancesContainer.classList.add('error');
        hasError = true;
    }

    if (hasError) {
        alert('Veuillez remplir tous les champs obligatoires');
        return;
    }

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

    const animateurId = animateurSelectEl ? parseInt(animateurSelectEl.value) : currentUser.id;
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
        alert('[OK] Activité modifiée avec succès !');
    } catch (e) {
        alert('[KO] Erreur lors de la modification : ' + e.message);
    }
}






/* ===========================
   Gestion des séances
   =========================== */
function ajouterSeanceHebdo(){
    const container = $('#seances-container');
    const startInput = $('#first-hebdoseance');
    const nbInput = $('#nb-seances');
    const dureeInput = $('#duree-hebdo');

    const start = new Date(startInput.value);
    const nb = parseInt(nbInput.value);
    const duree = parseInt(dureeInput.value);

    if(isNaN(start.getTime()) || !nb || nb<1){
        alert('Choisissez une date et un nombre valide');
        return;
    }

    const serieDiv = document.createElement('div');
    serieDiv.className='serie-hebdo';
    serieDiv.dataset.duree = duree; // Stocker la durée de la série

    const sup = document.createElement('div');
    sup.style.textAlign='right';
    const supBtn = document.createElement('button');
    supBtn.className='btn secondary';
    supBtn.textContent='Supprimer série';
    supBtn.onclick = ()=> {
        serieDiv.remove();
        trierSeances(); // Ajout
    };
    sup.appendChild(supBtn);
    serieDiv.appendChild(sup);

    // Fonction pour recalculer les dates à partir de la première séance
    function majLabels(serieDiv){
        const items = Array.from(serieDiv.querySelectorAll('.seance-item'));
        if(items.length === 0) return;

        const pivotInput = items[0].querySelector('.seance-input');
        const baseDate = new Date(pivotInput.value);

        items.forEach((item, idx) => {
            if(idx === 0) return;

            const inp = item.querySelector('.seance-input');


            const newDate = new Date(baseDate);
            newDate.setDate(baseDate.getDate() + idx * 7);

            inp.value = formatDateInputLocal(newDate);
        });
        trierSeances(); // Ajout
    }

    // Fonction pour mettre à jour toutes les durées de la série
    function majDurees(serieDiv, nouvelleDuree){
        serieDiv.dataset.duree = nouvelleDuree;
        const items = Array.from(serieDiv.querySelectorAll('.seance-item'));
        items.forEach(item => {
            const select = item.querySelector('.duree-select');
            if(select) select.value = nouvelleDuree;
        });
    }

    // Créer les séances
    for(let i=0; i<nb; i++){
        const d = document.createElement('div');
        d.className='seance-item';

        const span = document.createElement('div');
        span.className='small muted';
        span.style.minWidth='110px';
        span.textContent = i===0 ? 'Séance 1 (début)' : `+${i} semaine(s)`;

        const inp = document.createElement('input');
        inp.type='datetime-local';


        const newDate = new Date(start);
        newDate.setDate(start.getDate() + i * 7);

        inp.value = formatDateInputLocal(newDate);
        inp.className='seance-input';

        // Select durée
        const selectDuree = document.createElement('select');
        selectDuree.className='duree-select';
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
        selectDuree.value = duree;

        // Si c'est la première séance, changer la durée affecte toute la série
        if(i === 0){
            inp.onchange = () => majLabels(serieDiv);
            selectDuree.onchange = (e) => majDurees(serieDiv, e.target.value);
        } else {
            // Pour les autres, synchroniser avec la première
            selectDuree.onchange = (e) => {
                majDurees(serieDiv, e.target.value);
            };
        }

        const del = document.createElement('button');
        del.className='btn ghost';
        del.textContent='✖';
        del.onclick = () => {
            d.remove();

            const remainingItems = serieDiv.querySelectorAll('.seance-item');
            if(remainingItems.length > 0){
                remainingItems.forEach((item, idx) => {
                    const span = item.querySelector('.small.muted');
                    span.textContent = idx === 0 ? 'Séance 1 (début)' : `+${idx} semaine(s)`;

                    const inp = item.querySelector('.seance-input');
                    const select = item.querySelector('.duree-select');
                    if(idx === 0){
                        inp.onchange = () => majLabels(serieDiv);
                        select.onchange = (e) => majDurees(serieDiv, e.target.value);
                    }
                });
            } else {
                serieDiv.remove();
            }
            trierSeances(); // Ajout
        };

        d.appendChild(span);
        d.appendChild(inp);
        d.appendChild(selectDuree);
        d.appendChild(del);
        serieDiv.appendChild(d);
    }

    container.appendChild(serieDiv);
    trierSeances(); //
}

function ajouterSeanceManuelle(){
    const container = $('#seances-container');
    const d = document.createElement('div');
    d.className='seance-item manual';

    const inp = document.createElement('input');
    inp.type='datetime-local';
    inp.className='seance-input';
    inp.onchange = () => trierSeances(); // Ajout

    const span = document.createElement('div');
    span.className='small muted';
    span.style.minWidth='110px';
    span.textContent='Ajout manuel';

    // Select durée
    const selectDuree = document.createElement('select');
    selectDuree.className='duree-select';
    selectDuree.innerHTML = `
        <option value="15">15 min</option>
        <option value="30">30 min</option>
        <option value="45">45 min</option>
        <option value="60" selected>1h</option>
        <option value="75">1h15</option>
        <option value="90">1h30</option>
        <option value="105">1h45</option>
        <option value="120">2h</option>
    `;

    const del = document.createElement('button');
    del.className='btn ghost';
    del.textContent='✖';
    del.onclick = ()=> {
        d.remove();
        trierSeances(); // Ajout
    };

    d.appendChild(span);
    d.appendChild(inp);
    d.appendChild(selectDuree);
    d.appendChild(del);
    container.appendChild(d);
    trierSeances(); // Ajout
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
    groupeEditMode = false;
    currentEditGroupeId = null;
    majListeGroupes();

    // Réinitialiser le formulaire
    $('#nouveau-groupe-nom').value = '';
    $('#groupe-modal-title').textContent = 'Créer un nouveau groupe';
    $('#btn-save-groupe').textContent = 'Créer';

    // Détruire l'ancienne instance si elle existe
    if (groupeClasseMultiSelect) {
        groupeClasseMultiSelect.destroy();
    }

    // Réinitialiser le select HTML
    const selectEl = $('#groupe-classe-select');
    if (selectEl) {
        selectEl.innerHTML = '';
    }

    // Initialiser MultiSelect pour les classes du groupe
    const classesData = classes.map(cl => ({
        value: cl.id.toString(),
        text: cl.nom
    }));

    groupeClasseMultiSelect = new MultiSelect('#groupe-classe-select', {
        data: classesData,
        placeholder: 'Sélectionner les classes',
        search: true,
        selectAll: true,
        listAll: true,
        onChange: function(value, text, element) {
            if (groupeClasseMultiSelect.selectedItems.length > 0) {
                $('#groupe-classe-select').classList.remove('error');
            }
        }
    });

    $('#groupes-modal').classList.add('visible');
}

function fermerModalGroupes() {
    annulerEditionGroupe();
    $('#groupes-modal').classList.remove('visible');
    $('#nouveau-groupe-nom').value = '';
    groupeEditMode = false;
    currentEditGroupeId = null;

    if (groupeClasseMultiSelect) {
        groupeClasseMultiSelect.selectedItems.forEach(item => {
            groupeClasseMultiSelect.unselect(item.value);
        });
    }
}

function annulerEditionGroupe() {
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
            <svg viewBox="0 0 24 24" style="width:16px;height:16px;margin-right:4px;fill:currentColor">
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

    // Vider le nom
    const nomInput = document.getElementById('nouveau-groupe-nom');
    if (nomInput) {
        nomInput.value = '';
        nomInput.classList.remove('error');
    }

    // Désélectionner toutes les classes
    if (groupeClasseMultiSelect) {
        try {
            groupeClasseMultiSelect.selectedItems.forEach(item => {
                groupeClasseMultiSelect.unselect(item.value);
            });
        } catch(e) {
            console.warn('Erreur déselection:', e);
        }
    }

    // Retirer les erreurs visuelles
    const multiSelectHeader = document.querySelector('#groupe-classe-select')?.parentElement?.querySelector('.multi-select-header');
    if (multiSelectHeader) {
        multiSelectHeader.classList.remove('error');
    }

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
        groupeDiv.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 8px; background: white;';

        const infoDiv = document.createElement('div');
        infoDiv.innerHTML = `
            <strong style="color: var(--text); font-size: 14px;">${groupe.nom}</strong>
            <div class="small muted">Classes : ${classesGroupe || 'Aucune'}</div>
            <div class="small muted">${activitesCount} activité(s) • ${groupe.description || 'Pas de description'}</div>
        `;

        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = 'display: flex; gap: 8px;';

        // Bouton éditer
        const btnEdit = document.createElement('button');
        btnEdit.className = 'btn secondary';
        btnEdit.dataset.groupeId = groupe.id;
        btnEdit.innerHTML = `
            <svg class="icon" viewBox="0 0 24 24" style="width:16px;height:16px">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/>
            </svg>
            Éditer
        `;
        btnEdit.onclick = () => editerGroupe(groupe.id);

        // Bouton supprimer
        const btnSuppr = document.createElement('button');
        btnSuppr.className = 'btn secondary';
        btnSuppr.dataset.groupeId = groupe.id;
        btnSuppr.innerHTML = `
            <svg class="icon" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>
            Supprimer
        `;
        btnSuppr.onclick = () => supprimerGroupe(groupe.id, groupe.nom);

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

        // 2. Remplir le nom
        const nomInput = document.getElementById('nouveau-groupe-nom');
        if (nomInput) {
            nomInput.value = groupe.nom;
            console.log('[OK] Nom rempli:', groupe.nom);
        }

        // === GESTION DU MULTISELECT ===

        // Détruire l'ancienne instance
        if (groupeClasseMultiSelect) {
            try {
                groupeClasseMultiSelect.destroy();
                console.log('[OK] Ancienne instance détruite');
            } catch (e) {
                console.warn('[WARN] Erreur destruction:', e);
            }
            groupeClasseMultiSelect = null;
        }

        // Récupérer et recréer le select
        const selectEl = document.getElementById('groupe-classe-select');
        if (!selectEl) {
            console.error('[KO] Element #groupe-classe-select introuvable');
            alert('Erreur : élément select introuvable');
            return;
        }

        const parent = selectEl.parentElement;
        selectEl.remove();

        const newSelect = document.createElement('select');
        newSelect.id = 'groupe-classe-select';
        parent.appendChild(newSelect);

        console.log('[OK] Nouveau select créé');

        // Préparer les données
        const classesData = classes.map(cl => ({
            value: cl.id.toString(),
            text: cl.nom
        }));

        console.log('[OK] Données classes préparées:', classesData.length, 'classes');

        // Créer une NOUVELLE instance MultiSelect
        groupeClasseMultiSelect = new MultiSelect('#groupe-classe-select', {
            data: classesData,
            placeholder: 'Sélectionner les classes',
            search: true,
            selectAll: true,
            listAll: true,
            onChange: function(value, text, element) {
                if (groupeClasseMultiSelect.selectedItems.length > 0) {
                    const multiSelectHeader = document.querySelector('#groupe-classe-select')?.parentElement?.querySelector('.multi-select-header');
                    if (multiSelectHeader) {
                        multiSelectHeader.classList.remove('error');
                    }
                }
            }
        });

        console.log('[OK] MultiSelect créé');

        // Attendre que MultiSelect soit prêt
        await new Promise(resolve => setTimeout(resolve, 200));

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

        // 4. Bouton de sauvegarde - RECRÉATION SYSTÉMATIQUE
        const btnSaveGroupe = document.getElementById('btn-save-groupe');
        if (btnSaveGroupe) {
            const svgIcon = btnSaveGroupe.querySelector('svg');
            btnSaveGroupe.innerHTML = '';

            if (svgIcon) {
                btnSaveGroupe.appendChild(svgIcon.cloneNode(true));
            }

            const newSpan = document.createElement('span');
            newSpan.id = 'btn-save-text';
            newSpan.textContent = 'Enregistrer les modifications';
            btnSaveGroupe.appendChild(newSpan);

            console.log('[OK] Bouton de sauvegarde mis à jour');
        } else {
            console.error('[KO] Bouton #btn-save-groupe introuvable');
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
        $('#nouveau-groupe-nom').classList.add('error');
        return;
    }

    // Validation classes
    if (!groupeClasseMultiSelect || groupeClasseMultiSelect.selectedItems.length === 0) {
        alert('⚠️ Vous devez sélectionner au moins une classe pour ce groupe');
        const multiSelectHeader = document.querySelector('#groupe-classe-select')?.parentElement?.querySelector('.multi-select-header');
        if (multiSelectHeader) {
            multiSelectHeader.classList.add('error');
        }
        return;
    }

    const classe_ids = groupeClasseMultiSelect.selectedItems.map(item => parseInt(item.value));

    try {
        if (groupeEditMode && currentEditGroupeId) {
            // Mode édition
            await apiPut(`/groupes/${currentEditGroupeId}`, {
                nom,
                description: '',
                classe_ids
            });
            alert('✓ Groupe modifié avec succès !');
        } else {
            // Mode création
            await apiPost('/groupes', {
                nom,
                description: '',
                classe_ids
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
    // Gérer les onglets
    const tabs = document.querySelectorAll('.prof-tab');
    const contents = document.querySelectorAll('.prof-tab-content');

    tabs.forEach(tab => tab.classList.remove('active'));
    contents.forEach(content => content.classList.remove('active'));

    // Activer le bon onglet
    const activeTab = tabName === 'gestion' ? tabs[0] : tabs[1];
    const activeContent = document.getElementById(`prof-tab-${tabName}`);

    if (activeTab) activeTab.classList.add('active');
    if (activeContent) activeContent.classList.add('active');

    // Si on revient sur gestion, rafraîchir l'emploi du temps
    if (tabName === 'gestion') {
        updateScheduleViewProf();
    }
}

/* ===========================
   Sidebar panels
   =========================== */
function updateSidePanels(){
    const raccourcis = $('#sidebar-raccourcis');
    if (raccourcis) raccourcis.style.display = MODE === 'dev' ? 'block' : 'none';

    const statut = $('#sidebar-statut');
    if (statut) statut.style.display = MODE === 'dev' ? 'block' : 'none';
}





/* Initialise tous les event listeners statiques (présents dès le chargement) */
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
    const profTabs = document.querySelectorAll('.prof-tab');
    profTabs.forEach((tab, index) => {
        const tabName = index === 0 ? 'gestion' : 'creation';
        tab.addEventListener('click', () => switchProfTab(tabName));
    });

    // ===== SÉANCES =====
    const seanceButtons = document.querySelectorAll('#prof-tab-creation .btn.ghost');
    if (seanceButtons[0]) seanceButtons[0].addEventListener('click', ajouterSeanceHebdo);
    if (seanceButtons[1]) seanceButtons[1].addEventListener('click', ajouterSeanceManuelle);

    // ===== GROUPES =====
    const btnOuvrirModalGroupes = document.querySelector('#prof-tab-creation .btn.secondary');
    if (btnOuvrirModalGroupes) {
        btnOuvrirModalGroupes.addEventListener('click', ouvrirModalGroupes);
    }

    const btnSaveGroupe = $('#btn-save-groupe');
    if (btnSaveGroupe) {
        btnSaveGroupe.addEventListener('click', creerGroupe);
    }

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

        alert('Élève désinscrit avec succès');

    } catch(e) {
        alert('Erreur lors de la désinscription : ' + e.message);
    }
}






/* ===========================
   Event Listeners
   =========================== */
document.addEventListener('DOMContentLoaded', function() {
    console.log('- DOM chargé, initialisation...');

    // Initialiser les listeners statiques
    initStaticEventListeners();

    // Initialiser la délégation d'événements
    setupEventDelegation();

    // Enter key pour login
    $('#username')?.addEventListener('keypress', (e) => {
        if(e.key === 'Enter') login();
    });
    $('#password')?.addEventListener('keypress', (e) => {
        if(e.key === 'Enter') login();
    });

    // Fermer modal avec Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeActivityModal();
            fermerModalGroupes();
            fermerModalAppel();
        }
    });

    // Fermer modal en cliquant à côté
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            if (e.target.id === 'activity-modal') closeActivityModal();
            else if (e.target.id === 'groupes-modal') fermerModalGroupes();
            else if (e.target.id === 'appel-modal') fermerModalAppel();
        }
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
        updateSidePanels();
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
})();querySelectorAll('#emploi-du-temps-prof .schedule-slot').forEach(slot => {
        slot.classList.remove('highlighted');
    });

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

