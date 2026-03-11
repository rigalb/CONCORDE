#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
Service d'envoi d'email CONCORDE.
Supporte deux modes définis via la variable MAIL_MODE :

  dev  = Gmail SMTP avec EMAIL_ADDRESS + EMAIL_PASSWORD (application password)
  prod = Relay SMTP (Brevo/autre) avec SMTP_SERVER, SMTP_PORT, SMTP_LOGIN, SMTP_PASSWORD
         L'expéditeur affiché est EMAIL_FROM.
"""

import smtplib
import os
import time
from email.message import EmailMessage
from dotenv import load_dotenv
import logging

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s - %(message)s'
)
logger = logging.getLogger("MailService")

# --- Configuration -------------------------------------------------------------
MAIL_MODE    = os.getenv("MAIL_MODE", "dev")
BASE_URL     = os.getenv("BASE_URL", "http://localhost:5000")
RETRY_COUNT  = 3

# Dev (Gmail)
_DEV_ADDRESS  = os.getenv("EMAIL_ADDRESS")
_DEV_PASSWORD = os.getenv("EMAIL_PASSWORD")

# Prod (relay SMTP)
_SMTP_SERVER   = os.getenv("SMTP_SERVER",  "smtp-relay.brevo.com")
_SMTP_PORT     = int(os.getenv("SMTP_PORT", "587"))
_SMTP_LOGIN    = os.getenv("SMTP_LOGIN")
_SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
_EMAIL_FROM    = os.getenv("EMAIL_FROM")


def _from_address() -> str:
    """Retourne l'adresse expéditeur selon le mode."""
    if MAIL_MODE == "prod":
        return _EMAIL_FROM or "ne_pas_repondre@concorde.assomption.bzh"
    return _DEV_ADDRESS or ""


def _connect_smtp() -> smtplib.SMTP:
    """Ouvre et retourne une connexion SMTP authentifiée selon MAIL_MODE."""
    logger.debug(f"Connexion SMTP mode={MAIL_MODE}")

    if MAIL_MODE == "dev":
        if not _DEV_ADDRESS or not _DEV_PASSWORD:
            raise EnvironmentError("Mode dev : EMAIL_ADDRESS ou EMAIL_PASSWORD manquant dans .env")
        smtp = smtplib.SMTP("smtp.gmail.com", 587, timeout=15)
        smtp.starttls()
        smtp.login(_DEV_ADDRESS, _DEV_PASSWORD)
        logger.info("SMTP dev (Gmail) authentifié")
        return smtp

    elif MAIL_MODE == "prod":
        if not _SMTP_LOGIN or not _SMTP_PASSWORD:
            raise EnvironmentError("Mode prod : SMTP_LOGIN ou SMTP_PASSWORD manquant dans .env")
        smtp = smtplib.SMTP(_SMTP_SERVER, _SMTP_PORT, timeout=15)
        smtp.starttls()
        smtp.login(_SMTP_LOGIN, _SMTP_PASSWORD)
        logger.info(f"SMTP prod ({_SMTP_SERVER}) authentifié")
        return smtp

    else:
        raise ValueError(f"MAIL_MODE inconnu : '{MAIL_MODE}' (attendu : dev | prod)")


def send_email(to_email: str, subject: str, html_content: str, text_content: str) -> tuple:
    """
    Envoie un e-mail HTML + texte brut avec retry.
    Retourne (True, "Email envoyé") ou (False, "<message d'erreur>").
    """
    from_addr = _from_address()
    if not from_addr:
        logger.error("Adresse expéditeur vide - vérifier EMAIL_ADDRESS (dev) ou EMAIL_FROM (prod)")
        return False, "Adresse expéditeur non configurée"

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"]    = f"CONCORDE <{from_addr}>"
    msg["To"]      = to_email
    msg.set_content(text_content)
    msg.add_alternative(html_content, subtype="html")

    last_error = None
    for attempt in range(1, RETRY_COUNT + 1):
        try:
            logger.info(f"Envoi email à {to_email} - tentative {attempt}/{RETRY_COUNT}")
            smtp = _connect_smtp()
            smtp.send_message(msg)
            smtp.quit()
            logger.info(f"Email envoyé avec succès à {to_email}")
            return True, "Email envoyé"
        except Exception as exc:
            last_error = exc
            logger.warning(f"Echec tentative {attempt} pour {to_email} : {exc}")
            if attempt < RETRY_COUNT:
                time.sleep(2 * attempt)  # back-off progressif

    logger.critical(f"Échec définitif pour {to_email} après {RETRY_COUNT} tentatives : {last_error}")
    return False, str(last_error)


def send_invitation_email(to_email: str, token: str) -> tuple:
    """Envoie l'email d'invitation à créer un compte professeur."""
    signup_url = f"{BASE_URL}/inscription?token={token}"
    subject    = "Invitation à rejoindre CONCORDE"

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

    return send_email(to_email, subject, html, text)
