#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
password_reset.py — Gestion des tokens de réinitialisation de mot de passe
CONCORDE

Deux flux partagent ce module :

  first_login    : première connexion d'un élève (token_type='first_login')
                   Créé lors de l'import des données (tools/real_data.py).
                   Flux : login -> envoi code -> saisie code + nouveau MDP

  password_reset : mot de passe oublié pour tous les rôles (token_type='password_reset')
                   Flux : saisie username/email -> envoi code -> saisie code + nouveau MDP

Dans les deux cas, le code est un entier à 6 chiffres envoyé par email,
stocké haché (SHA-256) dans la table password_reset_tokens.
Le code en clair n'est jamais persisté.

Table utilisée : password_reset_tokens
  - user_id     : référence users.id
  - token       : hash SHA-256 du code à 6 chiffres
  - token_type  : 'first_login' ou 'password_reset'
  - expires_at  : datetime d'expiration (ISO)
  - used        : 0/1
  - used_at     : datetime d'utilisation
  - ip_address  : IP du client (audit)
"""

import sqlite3
import secrets
import hashlib
import logging
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

# Chemin vers la base de données (doit correspondre à app.py)
import os as _os
DB = _os.environ.get("DB_PATH", "essaie.db")


# ==============================================================================
# HELPERS INTERNES
# ==============================================================================
def _hash_code(code: str) -> str:
    """
    Retourne le hash SHA-256 d'un code numérique.
    Stocké en base à la place du code en clair.
    La comparaison lors de la validation se fait sur les deux hashes.
    """
    return hashlib.sha256(code.encode()).hexdigest()


def _get_db() -> sqlite3.Connection:
    """
    Ouvre une connexion SQLite avec row_factory = sqlite3.Row.
    Ce module gère ses propres connexions (indépendant du pool de app.py)
    car il peut être importé en dehors du contexte Flask (tools/, init_first_login_tokens.py).
    Toujours appeler conn.close() après usage.
    """
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


# ==============================================================================
# CLASSE PRINCIPALE
# ==============================================================================
class PasswordResetManager:
    """
    Gestionnaire des codes de vérification pour les deux flux auth.

    Toutes les méthodes sont statiques — cette classe est un namespace,
    pas un objet avec état. Pas besoin d'instanciation.

    Constantes :
        CODE_LENGTH           : longueur du code (6 chiffres)
        FIRST_LOGIN_EXPIRY    : durée de validité en minutes (première connexion)
        PASSWORD_RESET_EXPIRY : durée de validité en minutes (mot de passe oublié)
        MAX_ATTEMPTS          : nb max de tentatives avant invalidation du code
    """

    CODE_LENGTH           = 6    # chiffres
    FIRST_LOGIN_EXPIRY    = 10   # minutes
    PASSWORD_RESET_EXPIRY = 10   # minutes
    MAX_ATTEMPTS          = 5    # tentatives avant invalidation


    # -- Génération d'un code ----------------------------------------------
    @staticmethod
    def generate_code() -> str:
        """
        Génère un code numérique à 6 chiffres cryptographiquement sûr.
        Utilise secrets.randbelow pour éviter les biais de random.randint.
        Plage : 100000 - 999999 (jamais de zéro initial).
        """
        return str(secrets.randbelow(900_000) + 100_000)


    # -- Création d'un code — première connexion élève ---------------------
    @staticmethod
    def create_first_login_code(user_id: int, ip_address: str = None) -> tuple:
        """
        Crée (ou renouvelle) un code de première connexion pour un élève.

        Invalide les anciens codes 'first_login' non utilisés avant d'en créer
        un nouveau, pour qu'il n'y ait jamais deux codes actifs simultanément.

        Args:
            user_id    : id de l'élève
            ip_address : IP du client (audit)

        Returns:
            (True,  code_clair)   si succès — le code clair est envoyé par email, JAMAIS stocké
            (False, message_err)  si échec
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

            # Invalider les anciens codes non utilisés de ce type
            cur.execute("""
                UPDATE password_reset_tokens
                SET used=1, used_at=datetime('now')
                WHERE user_id=? AND token_type='first_login' AND used=0
            """, (user_id,))

            code       = PasswordResetManager.generate_code()
            code_hash  = _hash_code(code)
            expires_at = (
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
            logger.error(f"Erreur create_first_login_code : {e}")
            return False, "Erreur lors de la création du code"


    # -- Création d'un code — mot de passe oublié --------------------------
    @staticmethod
    def create_password_reset_code(user_id: int, ip_address: str = None) -> tuple:
        """
        Crée (ou renouvelle) un code de réinitialisation pour n'importe quel rôle.

        Même logique que create_first_login_code mais pour token_type='password_reset'.

        Args:
            user_id    : id de l'utilisateur
            ip_address : IP du client (audit)

        Returns:
            (True,  code_clair)   si succès
            (False, message_err)  si échec
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

            # Invalider les anciens codes password_reset non utilisés
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


    # -- Validation d'un code soumis ---------------------------------------
    @staticmethod
    def validate_code(
        user_id:        int,
        submitted_code: str,
        expected_type:  str,
    ) -> Optional[dict]:
        """
        Valide le code soumis par l'utilisateur.

        Vérifie :
          - correspondance du hash (comparaison sécurisée)
          - type attendu (first_login ou password_reset)
          - code non utilisé
          - code non expiré

        Args:
            user_id        : id de l'utilisateur
            submitted_code : code saisi par l'utilisateur (6 chiffres, en clair)
            expected_type  : 'first_login' ou 'password_reset'

        Returns:
            dict {id, user_id, token_type}  si valide
            None                            si invalide / expiré / mauvais type
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


    # -- Invalidation d'un code après utilisation --------------------------
    @staticmethod
    def mark_code_used(
        user_id:    int,
        token_type: str,
        ip_address: str = None,
    ) -> bool:
        """
        Invalide tous les codes non utilisés du type donné pour cet utilisateur.
        Appelé après un changement de mot de passe réussi.

        Args:
            user_id    : id de l'utilisateur
            token_type : 'first_login' ou 'password_reset'
            ip_address : IP du client (audit, optionnel)

        Returns:
            True si succès, False si erreur DB
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
            logger.error(f"Erreur mark_code_used : {e}")
            return False


    # -- Lookup utilisateurs (pour les routes auth) ------------------------
    @staticmethod
    def get_user_by_username(username: str) -> Optional[dict]:
        """
        Retourne le dictionnaire complet d'un utilisateur depuis son username.
        Utilisé à l'étape 1 du flux forgot-password.

        Returns:
            dict(user) ou None si introuvable
        """
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
    def get_user_by_email(email: str) -> Optional[dict]:
        """
        Retourne le dictionnaire complet d'un utilisateur depuis son email.
        Utilisé à l'étape 1 du flux forgot-password (fallback si l'identifiant
        saisi est un email plutôt qu'un username).

        Returns:
            dict(user) ou None si introuvable
        """
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


    # -- Détection de première connexion -----------------------------------
    @staticmethod
    def is_first_login(user_id: int) -> bool:
        """
        Indique si un élève est en état de "première connexion".

        Un élève est considéré en première connexion tant qu'il existe
        un token 'first_login' valide (non utilisé, non expiré) en base.
        Ce token est créé lors de l'import des données (tools/real_data.py).

        Une fois le mot de passe défini, mark_code_used() invalide le token
        et cette méthode retourne False.

        Args:
            user_id : id de l'élève

        Returns:
            True si première connexion en attente, False sinon
        """
        try:
            conn = _get_db()
            row  = conn.execute("""
                SELECT 1 FROM password_reset_tokens
                WHERE user_id=?
                  AND token_type='first_login'
                  AND used=0
                  AND datetime(expires_at) > datetime('now')
                LIMIT 1
            """, (user_id,)).fetchone()
            conn.close()
            return row is not None
        except Exception as e:
            logger.error(f"Erreur is_first_login: {e}")
            return False

