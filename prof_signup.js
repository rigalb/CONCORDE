const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');
const messageDiv = document.getElementById('message');
const form = document.getElementById('signup-form');
const submitBtn = document.getElementById('submit-btn');

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
        
        // Extraire username depuis l'email (partie avant @)
        const username = data.email.split('@')[0];
        document.getElementById('username').value = username;
        
        document.getElementById('welcome-info').innerHTML = `
            <strong>👋 Bienvenue !</strong><br>
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
        const select = document.getElementById('classe');
        
        classes.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.nom;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error('Erreur classes:', e);
    }
}

document.getElementById('password').addEventListener('input', (e) => {
    const password = e.target.value;
    const fill = document.getElementById('strength-fill');
    const text = document.getElementById('strength-text');
    
    let strength = 0;
    if (password.length >= 8) strength += 25;
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

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value.trim();
    const prenom = document.getElementById('prenom').value.trim();
    const nom = document.getElementById('nom').value.trim();
    const matiere = document.getElementById('matiere').value;
    const password = document.getElementById('password').value;
    const passwordConfirm = document.getElementById('password-confirm').value;
    const classeId = document.getElementById('classe').value || null;
    
    // Validations
    if (!prenom || !nom || !matiere) {
        showMessage('❌ Tous les champs obligatoires doivent être remplis', 'error');
        return;
    }
    
    if (password !== passwordConfirm) {
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
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                token,
                username,
                prenom,
                nom,
                matiere,
                password,
                classe_id: classeId
            })
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
        
        setTimeout(() => {
            window.location.href = '/';
        }, 2000);
        
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

loadInvitationInfo();
loadClasses();
