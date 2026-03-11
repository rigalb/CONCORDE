#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
Script CLI pour créer et envoyer une invitation professeur.
Usage: python3 mails.py <EMAIL>

Dépend de mail_service.py pour l'envoi.
"""

import sys
import sqlite3
import secrets
from datetime import datetime, timedelta
from dotenv import load_dotenv
import os

load_dotenv()
BASE_URL = os.getenv("BASE_URL", "http://localhost:5000")
DB = "essaie.db"


def create_invitation(email: str):
    """Crée une invitation dans la DB et envoie l'email via mail_service."""
    from mail_service import send_invitation_email  # import tardif (mail_service lit .env)

    try:
        conn = sqlite3.connect(DB)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        existing = cur.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone()
        if existing:
            conn.close()
            return False, "Un compte existe déjà avec cet email"

        existing_inv = cur.execute("""
            SELECT 1 FROM invitation_tokens
            WHERE email=? AND used=0 AND datetime(expires_at) > datetime('now')
        """, (email,)).fetchone()
        if existing_inv:
            conn.close()
            return False, "Une invitation est déjà en attente pour cet email"

        token      = secrets.token_urlsafe(32)
        expires_at = (datetime.now() + timedelta(days=7)).isoformat()

        # Admin ID = 7 (à adapter si besoin)
        cur.execute("""
            INSERT INTO invitation_tokens (token, email, prenom, nom, expires_at, created_by)
            VALUES (?, ?, '', '', ?, 7)
        """, (token, email, expires_at))
        conn.commit()
        conn.close()

        success, msg = send_invitation_email(email, token)
        if not success:
            return False, f"Invitation créée mais erreur email : {msg}"

        return True, token

    except Exception as exc:
        return False, str(exc)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("[KO] Usage: python3 mails.py PROF_EMAIL")
        sys.exit(1)

    email = sys.argv[1].lower().strip()

    if "@" not in email or "." not in email:
        print("[KO] Format d'email invalide")
        sys.exit(1)

    print(f"Envoi invitation à {email}…")
    success, result = create_invitation(email)

    if success:
        print(f"[OK] Invitation créée et envoyée !")
        print(f"Token : {result}")
        print(f"Lien  : {BASE_URL}/inscription?token={result}")
    else:
        print(f"[KO] Erreur : {result}")
        sys.exit(1)
