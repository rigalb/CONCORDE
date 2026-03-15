#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
mails.py - Script CLI pour envoyer une invitation professeur
CONCORDE · outil de maintenance

Usage :
    python3 mails.py <EMAIL_DU_PROF>

Ce script est un outil en ligne de commande réservé à l'administrateur.
Il crée un token d'invitation en base de données et envoie l'email
d'invitation via mail_service.py.

Équivalent CLI de la route API POST /admin/invitations (app.py).
Utile pour inviter un prof sans passer par l'interface web
(ex : premier démarrage, maintenance, tests).

Prérequis :
  - .env présent et configuré (MAIL_MODE, BASE_URL, credentials SMTP)
  - base de données essaie.db accessible dans le répertoire courant

Note : l'admin_id est lu dynamiquement depuis la DB (premier utilisateur
de rôle 'admin'), plutôt qu'être hardcodé.
"""

import sys
import sqlite3
import secrets
import logging
from datetime import datetime, timedelta
from dotenv import load_dotenv
import os

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
)
logger = logging.getLogger(__name__)

BASE_URL = os.getenv("BASE_URL", "http://localhost:5000")
DB = os.getenv("DB_PATH", "essaie.db")


def _get_admin_id(conn: sqlite3.Connection) -> int | None:
    """
    Retourne l'id du premier administrateur trouvé en base.
    Utilisé comme created_by dans invitation_tokens.
    Retourne None si aucun admin n'existe (base vide ou mal initialisée).
    """
    row = conn.execute(
        "SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1"
    ).fetchone()
    return row["id"] if row else None


def create_invitation(email: str) -> tuple:
    """
    Crée un token d'invitation en base et envoie l'email.

    Vérifications :
      - L'email n'est pas déjà associé à un compte
      - Aucune invitation en attente pour cet email

    Args:
        email : adresse email du professeur à inviter (sera lowercasée)

    Returns:
        (True,  token)          si succès
        (False, message_erreur) si échec
    """
    # Import tardif : mail_service lit aussi le .env au chargement du module
    from mail_service import send_invitation_email

    email = email.strip().lower()

    try:
        conn = sqlite3.connect(DB)
        conn.row_factory = sqlite3.Row

        # Vérifier qu'aucun compte n'existe déjà avec cet email
        if conn.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
            conn.close()
            return False, "Un compte existe déjà avec cet email"

        # Vérifier qu'aucune invitation active n'existe déjà
        existing = conn.execute("""
            SELECT 1 FROM invitation_tokens
            WHERE email=? AND used=0 AND datetime(expires_at) > datetime('now')
        """, (email,)).fetchone()
        if existing:
            conn.close()
            return False, "Une invitation est déjà en attente pour cet email"

        # Récupérer l'admin_id dynamiquement (plus de valeur hardcodée)
        admin_id = _get_admin_id(conn)
        if admin_id is None:
            conn.close()
            return False, "Aucun administrateur trouvé en base - la DB est-elle initialisée ?"

        token      = secrets.token_urlsafe(32)
        expires_at = (datetime.now() + timedelta(days=7)).isoformat()

        conn.execute("""
            INSERT INTO invitation_tokens (token, email, prenom, nom, expires_at, created_by)
            VALUES (?, ?, '', '', ?, ?)
        """, (token, email, expires_at, admin_id))
        conn.commit()
        conn.close()

        logger.info(f"Token créé pour {email} (expire le {expires_at[:10]})")

        # Envoi de l'email
        success, msg = send_invitation_email(email, token)
        if not success:
            logger.error(f"Token créé mais email non envoyé : {msg}")
            return False, f"Token créé mais email non envoyé : {msg}"

        return True, token

    except Exception as exc:
        logger.exception(f"Erreur create_invitation pour {email}")
        return False, str(exc)


# -- Point d'entrée CLI --------------------------------------------------------
if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage : python3 mails.py PROF_EMAIL")
        sys.exit(1)

    target_email = sys.argv[1].strip().lower()

    # Validation minimale du format email avant tout appel DB/SMTP
    if "@" not in target_email or "." not in target_email.split("@")[-1]:
        print(f"[KO] Format d'email invalide : {target_email}")
        sys.exit(1)

    print(f"Envoi d'invitation à {target_email}…")
    ok, result = create_invitation(target_email)

    if ok:
        print("[OK] Invitation créée et email envoyé !")
        print(f"Token : {result}")
        print(f"Lien  : {BASE_URL}/inscription?token={result}")
    else:
        print(f"[KO] {result}")
        sys.exit(1)
