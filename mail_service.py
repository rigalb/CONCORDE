#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
mail_service.py - Service d'envoi d'email CONCORDE

Deux modes configurables via la variable d'environnement MAIL_MODE :

  dev  - Gmail SMTP direct (application password)
         Variables : EMAIL_ADDRESS, EMAIL_PASSWORD
         Usage    : développement local uniquement

  prod - Relay SMTP externe (ex : Brevo)
         Variables : SMTP_SERVER, SMTP_PORT, SMTP_LOGIN, SMTP_PASSWORD, EMAIL_FROM
         Usage    : production

Configuration via .env (ou variables d'environnement système).

Fonctions publiques :
  send_email(to, subject, html, text) -> (bool, str)
  send_invitation_email(to, token)    -> (bool, str)

Toutes les fonctions retournent (True, message) ou (False, erreur).
Les exceptions réseau sont catchées en interne avec retry exponentiel.
"""

import smtplib
import os
import time
import logging
from email.message import EmailMessage
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ==============================================================================
# CONFIGURATION (lue une fois au démarrage du module)
# ==============================================================================
# Mode d'envoi : "dev" (Gmail) ou "prod" (relay SMTP)
MAIL_MODE   = os.getenv("MAIL_MODE", "dev")
BASE_URL    = os.getenv("BASE_URL", "http://localhost:5000")
RETRY_COUNT = 3

# -- Credentials mode dev (Gmail) ------------------------------------------
_DEV_ADDRESS  = os.getenv("EMAIL_ADDRESS")   # ex: concorde@gmail.com
_DEV_PASSWORD = os.getenv("EMAIL_PASSWORD")  # application password Gmail (pas le MDP du compte)

# -- Credentials mode prod (relay SMTP) ------------------------------------
_SMTP_SERVER   = os.getenv("SMTP_SERVER",  "smtp-relay.brevo.com")
_SMTP_PORT     = int(os.getenv("SMTP_PORT", "587"))
_SMTP_LOGIN    = os.getenv("SMTP_LOGIN")
_SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
_EMAIL_FROM    = os.getenv("EMAIL_FROM")     # adresse affichée comme expéditeur


# ==============================================================================
# HELPERS INTERNES
# ==============================================================================

def _from_address() -> str:
    """
    Retourne l'adresse expéditeur selon le mode actif.
    En prod, utilise EMAIL_FROM (adresse vérifiée par le relay).
    En dev, utilise l'adresse Gmail configurée.
    """
    if MAIL_MODE == "prod":
        return _EMAIL_FROM or "ne_pas_repondre@concorde.assomption.bzh"
    return _DEV_ADDRESS or ""


def _connect_smtp() -> smtplib.SMTP:
    """
    Ouvre et retourne une connexion SMTP authentifiée selon MAIL_MODE.

    Raises:
        EnvironmentError : si une variable d'environnement obligatoire manque
        ValueError       : si MAIL_MODE est inconnu
        smtplib.*        : si la connexion SMTP échoue (gérée par l'appelant)
    """
    if MAIL_MODE == "dev":
        if not _DEV_ADDRESS or not _DEV_PASSWORD:
            raise EnvironmentError("Mode dev : EMAIL_ADDRESS ou EMAIL_PASSWORD manquant dans .env")
        smtp = smtplib.SMTP("smtp.gmail.com", 587, timeout=15)
        smtp.starttls()
        smtp.login(_DEV_ADDRESS, _DEV_PASSWORD)
        logger.debug("SMTP dev (Gmail) authentifié")
        return smtp

    if MAIL_MODE == "prod":
        if not _SMTP_LOGIN or not _SMTP_PASSWORD:
            raise EnvironmentError("Mode prod : SMTP_LOGIN ou SMTP_PASSWORD manquant dans .env")
        smtp = smtplib.SMTP(_SMTP_SERVER, _SMTP_PORT, timeout=15)
        smtp.starttls()
        smtp.login(_SMTP_LOGIN, _SMTP_PASSWORD)
        logger.debug(f"SMTP prod ({_SMTP_SERVER}) authentifié")
        return smtp

    raise ValueError(f"MAIL_MODE inconnu : '{MAIL_MODE}' (attendu : dev | prod)")


# ==============================================================================
# API PUBLIQUE
# ==============================================================================

def send_email(to_email: str, subject: str, html_content: str, text_content: str) -> tuple:
    """
    Envoie un email multipart (HTML + texte brut) avec retry exponentiel.

    Les clients email qui ne supportent pas le HTML voient text_content.
    Les autres voient html_content (priorité dans l'ordre MIME).

    Args:
        to_email     : adresse destinataire
        subject      : objet de l'email
        html_content : corps HTML
        text_content : corps texte brut (fallback)

    Returns:
        (True,  "Email envoyé")          en cas de succès
        (False, "<message d'erreur>")    en cas d'échec définitif
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
    """
    Envoie l'email d'invitation à créer un compte professeur.

    Le lien contient le token d'invitation à usage unique (valable 7 jours).
    L'URL pointe vers /inscription?token=<token>.

    Args:
        to_email : adresse du futur professeur
        token    : token urlsafe_32 généré lors de la création de l'invitation

    Returns:
        (True, "Email envoyé") ou (False, "<erreur>")
    """
    signup_url = f"{BASE_URL}/inscription?token={token}"
    subject    = "Invitation à rejoindre CONCORDE"

    html = f"""<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><style>
body{{font-family:Arial,sans-serif;line-height:1.6;color:#222;background:#f6f8fb;margin:0;padding:20px}}
.wrap{{max-width:600px;margin:0 auto;background:white;border-radius:12px;
       box-shadow:0 6px 20px rgba(20,30,60,.1);overflow:hidden}}
.head{{background:linear-gradient(135deg,#0b5ccc,#d55f1f);padding:30px;text-align:center}}
.head h1{{color:white;margin:0;font-size:24px;font-weight:800}}
.body{{padding:40px 30px}}
.btn{{display:inline-block;background:#0b5ccc;color:white!important;padding:14px 32px;
      text-decoration:none;border-radius:8px;font-weight:700}}
.warn{{background:#fff5f7;padding:15px;margin-top:20px;border-left:4px solid #dc2626;
       border-radius:6px;font-size:13px}}
.foot{{background:#f8fafc;padding:20px;text-align:center;color:#888;font-size:11px}}
</style></head>
<body>
<div class="wrap">
  <div class="head"><h1>CONCORDE</h1></div>
  <div class="body">
    <h2 style="color:#0b5ccc">Invitation à rejoindre CONCORDE</h2>
    <p>Bonjour,</p>
    <p>Vous avez été invité(e) à rejoindre la plateforme <strong>CONCORDE</strong>
       en tant que professeur.</p>
    <p>Pour créer votre compte, cliquez sur le bouton ci-dessous :</p>
    <p style="text-align:center;margin:30px 0">
      <a href="{signup_url}" class="btn">Créer mon compte</a>
    </p>
    <p>Ou copiez ce lien dans votre navigateur :<br>
       <a href="{signup_url}" style="color:#0b5ccc;word-break:break-all">{signup_url}</a>
    </p>
    <div class="warn">
      <strong>⚠ Important</strong><br>
      • Ce lien est à <strong>usage unique</strong><br>
      • Il expire dans <strong>7 jours</strong><br>
      • Ne le partagez pas
    </div>
  </div>
  <div class="foot">CONCORDE &copy; 2025 - Email automatique, ne pas répondre</div>
</div>
</body></html>"""

    text = f"""Invitation à rejoindre CONCORDE

Bonjour,

Vous avez été invité(e) à rejoindre CONCORDE en tant que professeur.

Pour créer votre compte, visitez ce lien :
{signup_url}

⚠ Ce lien est à usage unique et expire dans 7 jours.
Ne le partagez pas.

CONCORDE © 2025 - Email automatique, ne pas répondre"""

    return send_email(to_email, subject, html, text)
