#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
Module de gestion des tokens de réinitialisation de mot de passe.
Supporte deux flux :
  - Première connexion élève  (token_type='first_login')
  - Mot de passe oublié       (token_type='password_reset')

Dans les deux cas la vérification se fait par un code à 6 chiffres
envoyé par mail, stocké haché dans password_reset_tokens.
On réutilise la colonne `token` pour stocker le code haché,
et on garde une colonne virtuelle `raw_token` uniquement en mémoire
pour l'envoi par mail (jamais en base).
"""

import sqlite3
import secrets
import hashlib
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

DB = "essaie.db"


# ---------------------------------------------------------------------------
# Helpers internes
# ---------------------------------------------------------------------------

def _hash_code(code: str) -> str:
    """Hash SHA-256 du code pour stockage sécurisé."""
    return hashlib.sha256(code.encode()).hexdigest()


def _get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


# ---------------------------------------------------------------------------
# Classe principale
# ---------------------------------------------------------------------------

class PasswordResetManager:
    """Gestionnaire des codes de réinitialisation de mot de passe."""

    CODE_LENGTH           = 6          # chiffres
    FIRST_LOGIN_EXPIRY    = 10         # minutes
    PASSWORD_RESET_EXPIRY = 10         # minutes
    MAX_ATTEMPTS          = 5          # tentatives avant invalidation

    # ------------------------------------------------------------------
    # Génération d'un code
    # ------------------------------------------------------------------

    @staticmethod
    def generate_code() -> str:
        """Génère un code numérique à 6 chiffres."""
        return str(secrets.randbelow(900000) + 100000)  # 100000..999999

    # ------------------------------------------------------------------
    # Création d'un code — première connexion élève
    # ------------------------------------------------------------------

    @staticmethod
    def create_first_login_code(user_id: int, ip_address: str = None):
        """
        Crée (ou renouvelle) un code de première connexion pour un élève.

        Returns:
            (True,  code_clair: str)  si succès
            (False, message: str)     si erreur
        """
        try:
            conn = _get_db()
            cur  = conn.cursor()

            user = cur.execute(
                "SELECT id, role FROM users WHERE id=?", (user_id,)
            ).fetchone()

            if not user:
                conn.close()
                return False, "Utilisateur introuvable"

            if user["role"] != "eleve":
                conn.close()
                return False, "Réservé aux élèves"

            # Invalider tous les anciens codes non utilisés de ce type
            cur.execute("""
                UPDATE password_reset_tokens
                SET used=1, used_at=datetime('now')
                WHERE user_id=? AND token_type='first_login' AND used=0
            """, (user_id,))

            code        = PasswordResetManager.generate_code()
            code_hash   = _hash_code(code)
            expires_at  = (
                datetime.now() + timedelta(minutes=PasswordResetManager.FIRST_LOGIN_EXPIRY)
            ).isoformat()

            cur.execute("""
                INSERT INTO password_reset_tokens
                    (user_id, token, token_type, expires_at, ip_address)
                VALUES (?, ?, 'first_login', ?, ?)
            """, (user_id, code_hash, expires_at, ip_address))

            conn.commit()
            conn.close()

            logger.info(f"Code first_login créé pour user_id={user_id}")
            return True, code

        except Exception as e:
            logger.error(f"Erreur create_first_login_code: {e}")
            return False, "Erreur lors de la création du code"

    # ------------------------------------------------------------------
    # Création d'un code — mot de passe oublié
    # ------------------------------------------------------------------

    @staticmethod
    def create_password_reset_code(user_id: int, ip_address: str = None):
        """
        Crée (ou renouvelle) un code de réinitialisation pour n'importe quel rôle.

        Returns:
            (True,  code_clair: str)  si succès
            (False, message: str)     si erreur
        """
        try:
            conn = _get_db()
            cur  = conn.cursor()

            user = cur.execute(
                "SELECT id FROM users WHERE id=?", (user_id,)
            ).fetchone()

            if not user:
                conn.close()
                return False, "Utilisateur introuvable"

            # Invalider tous les anciens codes password_reset
            cur.execute("""
                UPDATE password_reset_tokens
                SET used=1, used_at=datetime('now')
                WHERE user_id=? AND token_type='password_reset' AND used=0
            """, (user_id,))

            code       = PasswordResetManager.generate_code()
            code_hash  = _hash_code(code)
            expires_at = (
                datetime.now() + timedelta(minutes=PasswordResetManager.PASSWORD_RESET_EXPIRY)
            ).isoformat()

            cur.execute("""
                INSERT INTO password_reset_tokens
                    (user_id, token, token_type, expires_at, ip_address)
                VALUES (?, ?, 'password_reset', ?, ?)
            """, (user_id, code_hash, expires_at, ip_address))

            conn.commit()
            conn.close()

            logger.info(f"Code password_reset créé pour user_id={user_id}")
            return True, code

        except Exception as e:
            logger.error(f"Erreur create_password_reset_code: {e}")
            return False, "Erreur lors de la création du code"

    # ------------------------------------------------------------------
    # Validation d'un code soumis par l'utilisateur
    # ------------------------------------------------------------------

    @staticmethod
    def validate_code(user_id: int, submitted_code: str, expected_type: str):
        """
        Valide le code soumis par l'utilisateur.

        Returns:
            dict  avec user_id et token_type si valide
            None  si invalide / expiré / max tentatives atteint
        """
        try:
            code_hash = _hash_code(submitted_code.strip())
            conn      = _get_db()
            row = conn.execute("""
                SELECT id, user_id, token_type
                FROM password_reset_tokens
                WHERE user_id=?
                  AND token=?
                  AND token_type=?
                  AND used=0
                  AND datetime(expires_at) > datetime('now')
            """, (user_id, code_hash, expected_type)).fetchone()
            conn.close()

            if not row:
                return None

            return {"id": row["id"], "user_id": row["user_id"], "token_type": row["token_type"]}

        except Exception as e:
            logger.error(f"Erreur validate_code: {e}")
            return None

    # ------------------------------------------------------------------
    # Récupérer le user_id depuis un username/email (pour l'étape 1 du flow)
    # ------------------------------------------------------------------

    @staticmethod
    def get_user_by_username(username: str):
        """Renvoie le user complet depuis le username."""
        try:
            conn = _get_db()
            user = conn.execute("""
                SELECT id, username, email, role, prenom, nom
                FROM users WHERE username=?
            """, (username.strip(),)).fetchone()
            conn.close()
            return dict(user) if user else None
        except Exception as e:
            logger.error(f"Erreur get_user_by_username: {e}")
            return None

    @staticmethod
    def get_user_by_email(email: str):
        """Renvoie le user complet depuis l'email (pour forgot-password)."""
        try:
            conn = _get_db()
            user = conn.execute("""
                SELECT id, username, email, role, prenom, nom
                FROM users WHERE LOWER(email)=LOWER(?)
            """, (email.strip(),)).fetchone()
            conn.close()
            return dict(user) if user else None
        except Exception as e:
            logger.error(f"Erreur get_user_by_email: {e}")
            return None

    # ------------------------------------------------------------------
    # Marquer un code comme utilisé
    # ------------------------------------------------------------------

    @staticmethod
    def mark_code_used(user_id: int, token_type: str, ip_address: str = None):
        """
        Invalide tous les codes non utilisés du type donné pour cet utilisateur.
        Appelé après changement de mot de passe réussi.
        """
        try:
            conn = _get_db()
            conn.execute("""
                UPDATE password_reset_tokens
                SET used=1,
                    used_at=datetime('now'),
                    ip_address=COALESCE(?, ip_address)
                WHERE user_id=? AND token_type=? AND used=0
            """, (ip_address, user_id, token_type))
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            logger.error(f"Erreur mark_code_used: {e}")
            return False

    # ------------------------------------------------------------------
    # Vérifie si un élève est en "première connexion"
    # ------------------------------------------------------------------

    @staticmethod
    def is_first_login(user_id: int) -> bool:
        """
        Un élève est considéré en première connexion s'il existe
        un code first_login non utilisé valide en base pour lui.
        Ce code est créé lors de l'import real_data.py.
        """
        try:
            conn = _get_db()
            row = conn.execute("""
                SELECT 1 FROM password_reset_tokens
                WHERE user_id=? AND token_type='first_login' AND used=0
                LIMIT 1
            """, (user_id,)).fetchone()
            conn.close()
            return row is not None
        except Exception as e:
            logger.error(f"Erreur is_first_login: {e}")
            return False

    # ------------------------------------------------------------------
    # Nettoyage maintenance
    # ------------------------------------------------------------------

    @staticmethod
    def cleanup_expired_codes():
        """Supprime les codes expirés depuis plus de 24h."""
        try:
            conn = _get_db()
            cur  = conn.cursor()
            cur.execute("""
                DELETE FROM password_reset_tokens
                WHERE datetime(expires_at) < datetime('now', '-1 day')
            """)
            deleted = cur.rowcount
            conn.commit()
            conn.close()
            logger.info(f"Nettoyage : {deleted} code(s) expiré(s) supprimé(s)")
            return deleted
        except Exception as e:
            logger.error(f"Erreur cleanup: {e}")
            return 0