#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
Script pour envoyer une invitation à un professeur en ligne de commande
Usage: python3 send_invitation.py <EMAIL>
"""

import sys
import sqlite3
import secrets
from datetime import datetime, timedelta
import smtplib
from email.message import EmailMessage
from dotenv import load_dotenv
import os

# Charger .env
load_dotenv()
EMAIL_ADDRESS = os.getenv("EMAIL_ADDRESS")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")
BASE_URL = os.getenv("BASE_URL", "http://localhost:5000")
DB = "essaie.db"

def send_email(to_email, token):
  """Envoie l'email d'invitation"""
  if not EMAIL_ADDRESS or not EMAIL_PASSWORD:
    return False, "Configuration email manquante dans .env"

  subject = "Invitation à rejoindre CONCORDE"
  signup_url = f"{BASE_URL}/inscription?token={token}"

  html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body{{font-family:Arial;line-height:1.6;color:#222;background:#f6f8fb;margin:0;padding:20px}}
.container{{max-width:600px;margin:0 auto;background:white;border-radius:12px;box-shadow:0 6px 20px rgba(20,30,60,0.1)}}
.header{{background:linear-gradient(135deg,#0b72ff,#d63384);padding:30px;text-align:center}}
.header h1{{color:white;margin:0;font-size:24px}}
.content{{padding:40px 30px}}
.btn{{display:inline-block;background:#0b72ff;color:white;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:600}}
.warning{{background:#fff5f7;padding:15px;margin-top:20px;border-left:4px solid #dd1738}}
</style></head><body>
<div class="container">
<div class="header"><h1>CONCORDE</h1></div>
<div class="content">
<h2>Invitation à rejoindre CONCORDE</h2>
<p>Bonjour,</p>
<p>Vous avez été invité(e) à rejoindre la plateforme <strong>CONCORDE</strong> en tant que professeur.</p>
<p>Pour créer votre compte, cliquez ci-dessous :</p>
<p style="text-align:center;margin:30px 0">
<a href="{signup_url}" class="btn" style="color:white;">Créer mon compte</a>
</p>
<p>Ou copiez ce lien dans votre navigateur :<br><a href="{signup_url}">{signup_url}</a></p>
<div class="warning">
<strong>⚠️ Important :</strong><br>
• Ce lien est à usage unique<br>
• Il expire dans 7 jours<br>
• Complétez vos informations lors de l'inscription
</div>
</div>
<div style="background:#f8fafc;padding:20px;text-align:center;color:#666;font-size:12px">
<p>CONCORDE © 2025</p>
</div>
</div>
</body></html>"""

  text = f"""Invitation à rejoindre CONCORDE

Bonjour,

Vous avez été invité(e) à rejoindre CONCORDE en tant que professeur.

Pour créer votre compte, visitez ce lien :
{signup_url}

⚠️ Lien valide 7 jours et à usage unique.

CONCORDE © 2025"""

  msg = EmailMessage()
  msg['Subject'] = subject
  msg['From'] = f"CONCORDE <{EMAIL_ADDRESS}>"
  msg['To'] = to_email
  msg.set_content(text)
  msg.add_alternative(html, subtype='html')

  try:
    with smtplib.SMTP('smtp.gmail.com', 587) as smtp:
      smtp.starttls()
      smtp.login(EMAIL_ADDRESS, EMAIL_PASSWORD)
      smtp.send_message(msg)
    return True, "Email envoyé"
  except Exception as e:
    return False, str(e)


def create_invitation(email):
  """Crée une invitation dans la DB"""
  try:
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Vérifier email n'existe pas
    existing = cur.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone()
    if existing:
      conn.close()
      return False, "Un compte existe déjà avec cet email"

    # Vérifier pas d'invitation en attente
    existing_inv = cur.execute("""
      SELECT 1 FROM invitation_tokens
      WHERE email=? AND used=0 AND datetime(expires_at) > datetime('now')
    """, (email,)).fetchone()
    if existing_inv:
      conn.close()
      return False, "Une invitation est déjà en attente pour cet email"

    # Générer token
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now() + timedelta(days=7)).isoformat()

    # Admin ID = 7
    cur.execute("""
      INSERT INTO invitation_tokens (token, email, prenom, nom, expires_at, created_by)
      VALUES (?, ?, '', '', ?, 7)
    """, (token, email, expires_at))

    conn.commit()
    conn.close()

    # Envoyer email
    success, msg = send_email(email, token)
    if not success:
      return False, f"Erreur email : {msg}"

    return True, token

  except Exception as e:
    return False, str(e)


if __name__ == "__main__":
  if len(sys.argv) != 2:
    print("[KO] Usage: python send_invitation.py PROF_EMAIL")
    print("Exemple: python send_invitation.py b.rigal23@assomption.bzh")
    sys.exit(1)

  email = sys.argv[1].lower().strip()

  # Validation basique email
  if '@' not in email or '.' not in email:
    print("[KO] Format d'email invalide")
    sys.exit(1)

  print(f"Envoi invitation à {email}...")

  success, result = create_invitation(email)

  if success:
    print(f"[OK] Invitation créée et envoyée avec succès !")
    print(f"Token: {result}")
    print(f"Lien: {BASE_URL}/inscription?token={result}")
  else:
    print(f"[KO] Erreur: {result}")
    sys.exit(1)