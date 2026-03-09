const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');
const messageDiv = document.getElementById('message');
const form = document.getElementById('signup-form');
const submitBtn = document.getElementById('submit-btn');

// Référence aux instances InputComp — peuplées après DOMContentLoaded
let classeComp = null;
let matiereComp = null;

async function loadInvitationInfo() {
    if (!token) {
        showMessage('❌ Token manquant', 'error');
        return;
    }
    
    try {
        const res = await fetch(`/api/invitation-info?token=${token}`);
        const data = await res.json();
        
        if (data.error) {
            showMessage('❌ ' + data.error, 'error');
            return;
        }
        
        // Écriture dans l'<input> natif conservé dans le wrapper InputComp
        const usernameInput = document.getElementById('username');
        if (usernameInput) usernameInput.value = data.email.split('@')[0];
        
        document.getElementById('welcome-info').innerHTML = `
            <strong>Bienvenue !</strong><br>
            Email : <strong>${data.email}</strong><br>
            Complétez vos informations ci-dessous.
        `;
        
        form.style.display = 'block';
        
    } catch (e) {
        showMessage('❌ Erreur de chargement', 'error');
    }
}

async function loadClasses() {
    try {
        const res = await fetch('/classes');
        const classes = await res.json();

        // Utilise l'API InputComp pour peupler le select classe dynamiquement
        if (classeComp) {
            classeComp.setOptions([
                { value: '', label: 'Aucune classe principale' },
                ...classes.map(c => ({ value: String(c.id), label: c.nom }))
            ]);
        }
    } catch (e) {
        console.error('Erreur classes:', e);
    }
}

// Jauge de force du mot de passe
// L'événement 'input' remonte depuis .ic-input (qui garde l'id 'password')
document.addEventListener('DOMContentLoaded', () => {
    // Récupère les instances InputComp créées par auto-init
    // On les retrouve via le wrapper [data-input-id]
    const allWrappers = document.querySelectorAll('.ic-wrapper');
    allWrappers.forEach(w => {
        // Les instances sont sur window pour y accéder — ou on les retrouve via l'input natif
    });

    // Le plus simple : écouter l'input natif (toujours présent dans le wrapper)
    const passwordInput = document.getElementById('password');
    if (passwordInput) {
        passwordInput.addEventListener('input', (e) => {
    const password = e.target.value;
    const fill = document.getElementById('strength-fill');
    const text = document.getElementById('strength-text');
    if (!fill || !text) return;
    
    let strength = 0;
    if (password.length >= 8)  strength += 25;
    if (password.length >= 12) strength += 25;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength += 25;
    if (/[0-9]/.test(password) && /[^a-zA-Z0-9]/.test(password)) strength += 25;
    
    fill.style.width = strength + '%';
    
    if (strength < 25) {
        fill.style.background = '#dd1738';
        text.textContent = 'Trop faible';
        text.style.color = '#dd1738';
    } else if (strength < 50) {
        fill.style.background = '#ff8a00';
        text.textContent = 'Faible';
        text.style.color = '#ff8a00';
    } else if (strength < 75) {
        fill.style.background = '#00b5cc';
        text.textContent = 'Moyen';
        text.style.color = '#00b5cc';
    } else {
        fill.style.background = '#10b981';
        text.textContent = 'Fort';
        text.style.color = '#10b981';
    }
});
    }

    // Récupère l'instance InputComp du select classe via le select natif caché
    // (InputComp remplace le <select> par un wrapper et stocke l'instance accessible
    //  via la propriété _icInstance posée sur l'ancien élément — ou via querySelector)
    // Méthode fiable : chercher le wrapper qui contient l'input[name="classe"]
    const classeHidden = document.querySelector('input[name="classe"]');
    if (classeHidden) {
        classeComp = classeHidden.closest('.ic-wrapper')?._icInstance || null;
    }
    // Fallback : chercher via data-input-id sur le wrapper
    if (!classeComp) {
        // On utilisera setOptions via une référence globale stockée par InputComp
        classeComp = window._IC_classe || null;
    }

    loadInvitationInfo();
    loadClasses();
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Lecture directe sur les inputs natifs (conservés dans les wrappers InputComp)
    const username     = document.getElementById('username')?.value?.trim() || '';
    const prenom       = document.getElementById('prenom')?.value?.trim() || '';
    const nom          = document.getElementById('nom')?.value?.trim() || '';
    const password     = document.getElementById('password')?.value || '';
    const passwordConf = document.getElementById('password-confirm')?.value || '';

    // Pour les selects InputComp : lire la valeur depuis l'input hidden dans le wrapper
    const matiereHidden = document.querySelector('.ic-wrapper:has(#matiere) input[type="hidden"]')
                       || document.querySelector('[data-input-id] input[name="matiere"]');
    const classeHidden  = document.querySelector('.ic-wrapper input[name="classe"]');
    const matiere  = matiereHidden?.value || document.getElementById('matiere')?.value || '';
    const classeId = classeHidden?.value  || null;

    if (!prenom || !nom || !matiere) {
        showMessage('❌ Tous les champs obligatoires doivent être remplis', 'error');
        return;
    }
    if (password !== passwordConf) {
        showMessage('❌ Les mots de passe ne correspondent pas', 'error');
        return;
    }
    if (password.length < 8) {
        showMessage('❌ Mot de passe trop court (min 8 caractères)', 'error');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Création en cours...';

    try {
        const res = await fetch('/inscription', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, username, prenom, nom, matiere, password, classe_id: classeId })
        });

        const data = await res.json();

        if (data.error) {
            showMessage('❌ ' + data.error, 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Créer mon compte';
            return;
        }

        showMessage('✅ Compte créé ! Redirection...', 'success');
        form.style.display = 'none';
        setTimeout(() => { window.location.href = '/'; }, 2000);

    } catch (e) {
        showMessage('❌ Erreur lors de l\'inscription', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Créer mon compte';
    }
});

function showMessage(text, type) {
    messageDiv.textContent = text;
    messageDiv.className = 'message ' + type;
    messageDiv.style.display = 'block';
    messageDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
