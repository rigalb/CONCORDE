// Récupérer le token depuis l'URL
const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');

// Référence au formulaire
const form = document.getElementById('reset-password-form');
const passwordInput = document.getElementById('password');
const confirmPasswordInput = document.getElementById('confirm-password');
const submitBtn = document.getElementById('submit-btn');
const errorMessage = document.getElementById('error-message');
const formContainer = document.getElementById('form-container');
const successContainer = document.getElementById('success-container');

// Fonction pour afficher une erreur
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
    errorMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Fonction pour masquer l'erreur
function hideError() {
    errorMessage.style.display = 'none';
}

// Validation en temps réel
passwordInput.addEventListener('input', () => {
    hideError();
    
    if (passwordInput.value.length > 0 && passwordInput.value.length < 8) {
        passwordInput.style.borderColor = '#fc8181';
    } else if (passwordInput.value.length >= 8) {
        passwordInput.style.borderColor = '#48bb78';
    } else {
        passwordInput.style.borderColor = '#e2e8f0';
    }
});

confirmPasswordInput.addEventListener('input', () => {
    hideError();
    
    if (confirmPasswordInput.value.length > 0) {
        if (confirmPasswordInput.value === passwordInput.value) {
            confirmPasswordInput.style.borderColor = '#48bb78';
        } else {
            confirmPasswordInput.style.borderColor = '#fc8181';
        }
    } else {
        confirmPasswordInput.style.borderColor = '#e2e8f0';
    }
});

// Gestion de la soumission du formulaire
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    
    const password = passwordInput.value;
    const confirmPassword = confirmPasswordInput.value;
    
    // Validations côté client
    if (password.length < 8) {
        showError('Le mot de passe doit contenir au moins 8 caractères.');
        return;
    }
    
    if (password.length > 200) {
        showError('Le mot de passe est trop long (maximum 200 caractères).');
        return;
    }
    
    if (password !== confirmPassword) {
        showError('Les mots de passe ne correspondent pas.');
        confirmPasswordInput.focus();
        return;
    }
    
    // Désactiver le bouton pendant l'envoi
    submitBtn.disabled = true;
    submitBtn.textContent = 'Réinitialisation...';
    
    try {
        const response = await fetch('/reset-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                token: token,
                password: password,
                confirm_password: confirmPassword
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            // Succès - afficher le message de réussite
            formContainer.style.display = 'none';
            successContainer.style.display = 'block';
        } else {
            // Erreur du serveur
            showError(data.error || 'Une erreur est survenue. Veuillez réessayer.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Réinitialiser le mot de passe';
        }
    } catch (error) {
        showError('Erreur de connexion au serveur. Vérifiez votre connexion internet.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Réinitialiser le mot de passe';
    }
});

// Validation de la présence du token au chargement
if (!token) {
    formContainer.innerHTML = `
        <div class="error-container">
            <h2>⚠️ Lien invalide</h2>
            <p>Ce lien de réinitialisation est invalide.</p>
            <p><a href="/forgot-password">Demander un nouveau lien</a></p>
        </div>
    `;
}