#!/usr/bin/python3
# -*- coding: utf-8 -*-

from flask import Flask, request, session, jsonify, send_from_directory, send_file, Response
import queue
import json
import time
import secrets
import threading
from collections import defaultdict
from typing import Dict, Set
import sqlite3
import hashlib
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta
import secrets
import functools
import os
import logging
import pytz

from colorama import init
from dotenv import load_dotenv

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from io import BytesIO

from validators import (
  InputValidator,
  ValidationError,
  ValidatorConfig,
  safe_string,
  safe_int,
  safe_email
)

from password_reset import PasswordResetManager
from mail_service import send_email, send_invitation_email, BASE_URL





# ========================
# SYSTÈME SSE
# ========================
class SSEManager:
  def __init__(self):
    self.listeners: Dict[str, queue.Queue] = {}
    self.lock = threading.Lock()

  def add_listener(self, client_id: str) -> queue.Queue:
    """Ajoute un nouveau listener SSE"""
    with self.lock:
      q = queue.Queue(maxsize=50)
      self.listeners[client_id] = q
      logger.info(f"SSE listener ajouté: {client_id} (total: {len(self.listeners)})")
      return q

  def remove_listener(self, client_id: str):
    """Retire un listener SSE"""
    with self.lock:
      if client_id in self.listeners:
        del self.listeners[client_id]
        logger.info(f"SSE listener retiré: {client_id} (total: {len(self.listeners)})")

  def broadcast(self, event_type: str, data: dict):
    """Diffuse un événement à tous les listeners"""
    with self.lock:
      dead_listeners = []
      for client_id, q in self.listeners.items():
        try:
          q.put_nowait({
            'event': event_type,
            'data': data
          })
        except queue.Full:
          logger.warning(f"Queue pleine pour {client_id}")
          dead_listeners.append(client_id)
        except Exception as e:
          logger.error(f"Erreur broadcast vers {client_id}: {e}")
          dead_listeners.append(client_id)

      # Nettoyer les listeners morts
      for client_id in dead_listeners:
        del self.listeners[client_id]

# Instance globale
sse_manager = SSEManager()

# ========================
# CACHE MÉMOIRE LÉGER
# ========================
class SimpleCache:
  """Cache TTL thread-safe pour données quasi-statiques (classes, groupes…)."""
  def __init__(self):
    self._store: Dict[str, tuple] = {}  # key -> (value, expires_at)
    self._lock = threading.Lock()

  def get(self, key: str):
    with self._lock:
      entry = self._store.get(key)
      if entry and time.time() < entry[1]:
        return entry[0]
      return None

  def set(self, key: str, value, ttl: int = 30):
    with self._lock:
      self._store[key] = (value, time.time() + ttl)

  def invalidate(self, *keys):
    with self._lock:
      for k in keys:
        self._store.pop(k, None)

  def invalidate_prefix(self, prefix: str):
    with self._lock:
      to_del = [k for k in self._store if k.startswith(prefix)]
      for k in to_del:
        del self._store[k]

_cache = SimpleCache()

# ========================
# CONNEXION DB THREAD-LOCAL
# ========================
_db_local = threading.local()

def get_db_connection_tl():
  """Connexion SQLite thread-local réutilisable (lectures)."""
  conn = getattr(_db_local, 'conn', None)
  if conn is None:
    conn = _make_db_conn()
    _db_local.conn = conn
  else:
    try:
      conn.execute("SELECT 1")
    except Exception:
      try: _release_db(conn)
      except: pass
      conn = _make_db_conn()
      _db_local.conn = conn
  return conn

def _make_db_conn():
  conn = sqlite3.connect(DB, timeout=20, check_same_thread=False)
  conn.row_factory = sqlite3.Row
  conn.execute("PRAGMA journal_mode=WAL")
  conn.execute("PRAGMA synchronous=NORMAL")
  conn.execute("PRAGMA cache_size=-32000")
  conn.execute("PRAGMA temp_store=MEMORY")
  conn.execute("PRAGMA busy_timeout=15000")
  conn.execute("PRAGMA mmap_size=268435456")
  conn.execute("PRAGMA foreign_keys=ON")
  return conn

# ========================
# POOL D'ÉCRITURE (5 connexions max)
# ========================
class WritePool:
  """Mini-pool de connexions d'écriture pour SQLite WAL."""
  def __init__(self, size=5):
    self._pool = queue.Queue(maxsize=size)
    for _ in range(size):
      self._pool.put(_make_db_conn())

  def acquire(self):
    try:
      return self._pool.get(timeout=10)
    except queue.Empty:
      return _make_db_conn()

  def release(self, conn):
    try:
      conn.execute("SELECT 1")
      self._pool.put_nowait(conn)
    except Exception:
      try: _release_db(conn)
      except: pass

_write_pool: 'WritePool | None' = None

def _ensure_pool():
  global _write_pool
  if _write_pool is None:
    _write_pool = WritePool(size=5)


init()
app = Flask(__name__)

# ========================
# CONFIGURATION SÉCURISÉE
# ========================
load_dotenv()
# BASE_URL et send_email sont importés depuis mail_service
TIMEZONE = pytz.timezone('Europe/Paris')

def now_local():
  """Retourne l'heure actuelle en heure locale française"""
  return datetime.now(TIMEZONE).replace(tzinfo=None)

def now_local_str():
  """Retourne l'heure actuelle en heure locale au format ISO"""
  return datetime.now(TIMEZONE).replace(tzinfo=None).isoformat()

app.config.update(
  SECRET_KEY=os.environ.get('SECRET_KEY') or 'CONCORDE_FALLBACK_KEY_CHANGE_IN_PROD',
  SESSION_COOKIE_HTTPONLY=True,
  SESSION_COOKIE_SAMESITE='Lax',
  PERMANENT_SESSION_LIFETIME=timedelta(hours=8)
)

DB = "essaie.db"
VALIDATION_PROF_ECHANGES = True

def init_db():
  """Active WAL pour SQLite (meilleures perfs en concurrence). + crée les tables échanges si besoin."""
  try:
    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA cache_size=-32000;")
    conn.execute("PRAGMA temp_store=MEMORY;")

    # -- Colonnes échanges sur groupes_exclusivite (idempotent) --
    try:
      conn.execute("ALTER TABLE groupes_exclusivite ADD COLUMN echanges_actifs INTEGER DEFAULT 0")
    except Exception:
      pass

    # -- Table vœux --
    conn.execute("""
      CREATE TABLE IF NOT EXISTS voeux_echange (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        eleve_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        groupe_id            INTEGER NOT NULL REFERENCES groupes_exclusivite(id) ON DELETE CASCADE,
        activite_actuelle_id INTEGER NOT NULL REFERENCES activites(id) ON DELETE CASCADE,
        activite_cible_id    INTEGER NOT NULL REFERENCES activites(id) ON DELETE CASCADE,
        statut               TEXT CHECK(statut IN ('actif','en_procedure','realise','annule'))
                             DEFAULT 'actif',
        created_at           TEXT DEFAULT (datetime('now')),
        updated_at           TEXT DEFAULT (datetime('now'))
      )
    """)

    # -- Table procédures --
    conn.execute("""
      CREATE TABLE IF NOT EXISTS procedures_echange (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        voeu_a_id       INTEGER NOT NULL REFERENCES voeux_echange(id) ON DELETE CASCADE,
        voeu_b_id       INTEGER NOT NULL REFERENCES voeux_echange(id) ON DELETE CASCADE,
        statut          TEXT CHECK(statut IN ('en_attente','accord_b','valide','refuse','annule'))
                        DEFAULT 'en_attente',
        created_at      TEXT DEFAULT (datetime('now')),
        date_accord_b   TEXT,
        date_validation TEXT,
        valide_par      INTEGER REFERENCES users(id)
      )
    """)

    # -- Index de performance --
    for ddl in [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_voeux_eleve_groupe_actif ON voeux_echange(eleve_id, groupe_id) WHERE statut IN ('actif','en_procedure')",
      "CREATE INDEX IF NOT EXISTS idx_voeux_eleve_groupe  ON voeux_echange(eleve_id, groupe_id)",
      "CREATE INDEX IF NOT EXISTS idx_voeux_actuelle      ON voeux_echange(activite_actuelle_id)",
      "CREATE INDEX IF NOT EXISTS idx_voeux_cible         ON voeux_echange(activite_cible_id)",
      "CREATE INDEX IF NOT EXISTS idx_voeux_eleve         ON voeux_echange(eleve_id)",
      "CREATE INDEX IF NOT EXISTS idx_voeux_groupe        ON voeux_echange(groupe_id)",
      "CREATE INDEX IF NOT EXISTS idx_voeux_statut        ON voeux_echange(statut)",
      "CREATE INDEX IF NOT EXISTS idx_procedures_voeu_a   ON procedures_echange(voeu_a_id)",
      "CREATE INDEX IF NOT EXISTS idx_procedures_voeu_b   ON procedures_echange(voeu_b_id)",
      "CREATE INDEX IF NOT EXISTS idx_procedures_statut   ON procedures_echange(statut)",
      "CREATE INDEX IF NOT EXISTS idx_inscriptions_eleve  ON inscriptions(eleve_id)",
      "CREATE INDEX IF NOT EXISTS idx_presences_eleve_seance ON presences(eleve_id, seance_id)",
      "CREATE INDEX IF NOT EXISTS idx_users_classe_role   ON users(classe_id, role)",
      "CREATE INDEX IF NOT EXISTS idx_activites_prof      ON activites(prof_id)",
    ]:
      try: conn.execute(ddl)
      except Exception: pass

    conn.commit()
    _release_db(conn)
  except Exception:
    pass  # logger pas encore initialisé à ce stade

# Configuration logging sécurisé
logging.basicConfig(
  level=logging.INFO,
  format='{asctime} - {levelname:<8} - {message}',
  handlers=[
    logging.FileHandler('security.log'),
    logging.StreamHandler()
  ],
  style="{"
)
logger = logging.getLogger(__name__)

# ============= CONFIGURATION VALIDATEUR =============
# Configuration personnalisée pour le validateur
validator_config = ValidatorConfig(
  max_email_length=100,
  default_max_string_length=255
)
InputValidator.configure(validator_config)

# ========================
# DÉCORATEURS DE SÉCURITÉ
# ========================
def login_required(f):
  @functools.wraps(f)
  def decorated_function(*args, **kwargs):
    if "user_id" not in session:
      logger.warning(f"Accès non autorisé à {request.endpoint} depuis {request.remote_addr}")
      return jsonify({"error": "Authentification requise"}), 401

    # Vérifier expiration session (8h)
    if 'last_activity' in session:
      if datetime.now().timestamp() - session['last_activity'] > 28800:
        session.clear()
        return jsonify({"error": "Session expirée"}), 401

    session['last_activity'] = datetime.now().timestamp()
    return f(*args, **kwargs)
  return decorated_function

def role_required(*allowed_roles):
  def decorator(f):
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
      if "user_id" not in session:
        return jsonify({"error": "Authentification requise"}), 401

      if session.get("role") not in allowed_roles:
        logger.warning(f"Accès refusé pour le rôle {session.get('role')} à {request.endpoint}")
        return jsonify({"error": f"Accès interdit. Rôle requis: {allowed_roles}"}), 403

      return f(*args, **kwargs)
    return decorated_function
  return decorator

# ========================
# UTILITAIRES DE SÉCURITÉ - VERSION SÉCURISÉE
# ========================
def get_db_connection():
  """Connexion depuis le pool d'écriture.
  TOUJOURS appeler _release_db(conn) en fin de fonction, même en cas d'erreur."""
  _ensure_pool()
  return _write_pool.acquire()

def _release_db(conn):
  """Restitue la connexion au pool (à appeler à la place de _release_db(conn))."""
  _write_pool.release(conn)

def get_db_read():
  """Connexion thread-local réutilisable — uniquement pour SELECT.
  Ne jamais appeler _release_db(conn) dessus."""
  return get_db_connection_tl()

def validate_basic(data, required_fields):
  """InputValidator Validation sécurisée des données avec protection XSS/SQL (new version)"""
  if not data:
    return False, "Données manquantes"

  for field in required_fields:
    if field not in data:
      return False, f"Champ requis: {field}"

    value = data[field]

    # Validation longueur
    if isinstance(value, str):
      # Ne pas permettre les champs vides
      cleaned, error = InputValidator.validate_string(
        value,
        min_length=1,
        max_length=500,  # Limite raisonnable
        allow_html=False,
        field_name=field
      )

      if error:
        logger.warning(f"Validation échouée pour {field}: {error}")
        return False, error

      # Remplacer la valeur par la version nettoyée
      data[field] = cleaned

  return True, None

def sanitize_string(value, max_length=255):
  """Nettoie une chaîne de caractères avec protection XSS/SQL (new version)"""
  try:
    cleaned, error = InputValidator.validate_string(
      value,
      max_length=max_length,
      allow_html=False,
      allow_empty=True
    )

    if error:
      logger.warning(f"Sanitization warning: {error}")
      return ""

    return cleaned
  except Exception as e:
    logger.error(f"Erreur sanitization: {e}")
    return ""

def validate_integer(value, min_val=None, max_val=None):
  """Valide un entier avec limites (new version)"""
  val, error = InputValidator.validate_integer(
    value,
    min_val=min_val,
    max_val=max_val
  )

  if error:
    raise ValidationError(error)

  return val

# ========================
# FONCTION D'ENVOI D'EMAIL : déléguée à mail_service (importée en haut du fichier)
# ========================
# HELPERS EMAIL CODES 6 CHIFFRES
# ========================

def _build_code_email_html(prenom: str, code: str, expiry_min: int, titre: str) -> str:
  return f"""<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8">
<style>
body{{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px;color:#333}}
.wrap{{max-width:520px;margin:0 auto;background:white;border-radius:10px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.1)}}
.head{{background:linear-gradient(135deg,#0b5ccc,#d55f1f);padding:28px;text-align:center;color:white}}
.head h1{{margin:0;font-size:22px;font-weight:700}}
.body{{padding:32px 28px}}
.code-box{{background:#f0f4ff;border:2px dashed #0b5ccc;border-radius:10px;text-align:center;padding:20px;margin:24px 0}}
.code-box span{{font-size:40px;font-weight:800;letter-spacing:10px;color:#0b5ccc;font-family:monospace}}
.warn{{background:#fff7ed;border-left:4px solid #d55f1f;padding:14px;border-radius:6px;font-size:13px;color:#7c3d0d}}
.foot{{background:#f8f9fa;padding:16px;text-align:center;color:#888;font-size:11px}}
</style></head>
<body>
<div class="wrap">
  <div class="head"><h1>CONCORDE</h1><p style="margin:4px 0 0;opacity:.85;font-size:13px">{titre}</p></div>
  <div class="body">
    <p>Bonjour <strong>{prenom}</strong>,</p>
    <p>Voici votre code de vérification :</p>
    <div class="code-box"><span>{code}</span></div>
    <div class="warn">
      ⏱ Ce code est valable <strong>{expiry_min} minutes</strong>.<br>
      Ne partagez jamais ce code avec quelqu'un d'autre.
    </div>
  </div>
  <div class="foot">CONCORDE &copy; 2025</div>
</div>
</body></html>"""

def _build_code_email_text(prenom: str, code: str, expiry_min: int, titre: str) -> str:
  return f"""{titre} — CONCORDE

Bonjour {prenom},

Votre code de vérification : {code}

Ce code est valable {expiry_min} minutes.
Ne partagez jamais ce code.

CONCORDE © 2025"""

def _send_first_login_code_email(to_email: str, prenom: str, code: str):
  """Envoie le code de première connexion par email."""
  from password_reset import PasswordResetManager
  html = _build_code_email_html(prenom, code, PasswordResetManager.FIRST_LOGIN_EXPIRY,
                                 "Première connexion")
  text = _build_code_email_text(prenom, code, PasswordResetManager.FIRST_LOGIN_EXPIRY,
                                 "Première connexion")
  ok, msg = send_email(to_email, "Votre code CONCORDE — Première connexion", html, text)
  if not ok:
    logger.error(f"Échec envoi code first_login à {to_email}: {msg}")

def _send_reset_code_email(to_email: str, prenom: str, code: str):
  """Envoie le code de réinitialisation de mot de passe par email."""
  from password_reset import PasswordResetManager
  html = _build_code_email_html(prenom, code, PasswordResetManager.PASSWORD_RESET_EXPIRY,
                                 "Réinitialisation de mot de passe")
  text = _build_code_email_text(prenom, code, PasswordResetManager.PASSWORD_RESET_EXPIRY,
                                 "Réinitialisation de mot de passe")
  ok, msg = send_email(to_email, "Votre code CONCORDE — Réinitialisation", html, text)
  if not ok:
    logger.error(f"Échec envoi code reset à {to_email}: {msg}")

# ========================
# AUTHENTIFICATION
# ========================
@app.route("/login", methods=["POST"])
def login():
  try:
    data = request.json

    # Validation basique
    valid, error = validate_basic(data, ['username', 'password'])
    if not valid:
      return jsonify({"error": error}), 400

    # Validation spécifique username avec InputValidator
    username_valid, username_error = InputValidator.validate_username(data.get("username"))
    if not username_valid:
      logger.warning(f"Tentative login avec username invalide: {username_error}")
      return jsonify({"error": username_error}), 400

    username = data.get("username").strip()
    password = data.get("password")

    # Validation longueur password
    if len(password) > 200:
      return jsonify({"error": "Mot de passe trop long"}), 400

    if len(password) < 1:
      return jsonify({"error": "Mot de passe requis"}), 400

    conn = get_db_read()
    user = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    # connexion read thread-local — pas de release

    if user and check_password_hash(user["password_hash"], password):
      """
      # --- Détection première connexion élève ---
      if user["role"] == "eleve" and PasswordResetManager.is_first_login(user["id"]):
        # On stocke le user_id en sessionb temporaire sans envoyer de code.
        # Le code est envoyé uniquement quand l'élève clique sur "Envoyer le code" dans /api/first-login/send-code
        # Générer un code 6 chiffres et l'envoyer par mail

        # Stocker l'user_id en session temporaire (pas encore connecté)
        session["pending_first_login_user_id"] = user["id"]
        logger.info(f"Première connexion détectée pour {username}, code envoyé")
        return jsonify({
          "success": True,
          "first_login": True,
          "user_id": user["id"]
        })"""

      # --- Connexion normale ---
      session["user_id"] = user["id"]
      session["role"] = user["role"]
      session["classe_id"] = user["classe_id"]
      session["prenom"] = user["prenom"]
      session["nom"] = user["nom"]
      session['last_activity'] = datetime.now().timestamp()

      logger.info(f"Connexion réussie: {username} (ID: {user['id']}) depuis {request.remote_addr}")

      return jsonify({
        "success": True,
        "first_login": False,
        "id": user["id"],
        "role": user["role"],
        "prenom": user["prenom"],
        "nom": user["nom"],
        "classe_id": user["classe_id"]
      })

    logger.warning(f"Tentative de connexion échouée: {username} depuis {request.remote_addr}")
    return jsonify({"success": False, "error": "Identifiants incorrects"}), 401

  except ValidationError as ve:
    logger.error(f"Erreur validation login: {str(ve)}")
    return jsonify({"error": str(ve)}), 400
  except Exception as e:
    logger.error(f"Erreur login: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/logout", methods=["POST"])
@login_required
def logout():
  user_id = session.get('user_id')
  logger.info(f"Déconnexion user ID: {user_id}")
  session.clear()
  return jsonify({"success": True})

@app.route("/me")
@login_required
def me():
  # Données déjà en session — pas de hit DB
  try:
    return jsonify({
      "id":       session["user_id"],
      "role":     session["role"],
      "classe_id":session.get("classe_id"),
      "prenom":   session.get("prenom", ""),
      "nom":      session.get("nom", ""),
    })
  except Exception as e:
    logger.error(f"Erreur /me: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/sse")
@login_required
def sse():
  """Endpoint SSE pour les mises à jour en temps réel"""
  user_id = session.get("user_id")
  client_id = f"{user_id}_{secrets.token_hex(4)}"

  def generate():
    # Ajouter le listener via SSEManager
    q = sse_manager.add_listener(client_id)

    try:
      # Message de connexion initial
      yield f"data: {json.dumps({'type': 'connected', 'client_id': client_id})}\n\n"

      # Heartbeat pour garder la connexion vivante
      last_heartbeat = time.time()
      # Timeout de 10 minutes sans activité client → ferme la connexion
      # (le JS reconnecte automatiquement à l'onerror)
      MAX_IDLE = 600

      while True:
        try:
          elapsed = time.time() - last_heartbeat

          # Fermer la connexion proprement après MAX_IDLE secondes
          if elapsed > MAX_IDLE:
            logger.info(f"[SSE] Timeout idle {client_id}, fermeture")
            break

          # Envoyer un heartbeat toutes les 30 secondes
          if elapsed > 30:
            yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
            last_heartbeat = time.time()

          # Attendre un message avec timeout
          try:
            message = q.get(timeout=1)
            yield f"event: {message['event']}\ndata: {json.dumps(message['data'])}\n\n"
          except queue.Empty:
            continue

        except GeneratorExit:
          break

    finally:
      # Retirer le listener
      sse_manager.remove_listener(client_id)

  return Response(
    generate(),
    mimetype='text/event-stream',
    headers={
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      'Connection': 'keep-alive'
    }
  )


# ========================
# DONNÉES DE BASE
# ========================
@app.route("/classes")
@login_required
def get_classes():
  try:
    cached = _cache.get("classes")
    if cached is not None:
      return jsonify(cached)
    conn = get_db_read()
    rows = conn.execute("SELECT * FROM classes ORDER BY nom").fetchall()
    result = [dict(r) for r in rows]
    _cache.set("classes", result, ttl=120)
    return jsonify(result)
  except Exception as e:
    logger.error(f"Erreur /classes: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/users")
@role_required('prof', 'admin')
def get_users():
  try:
    cached = _cache.get("users")
    if cached is not None:
      return jsonify(cached)
    conn = get_db_read()
    rows = conn.execute("SELECT id, prenom, nom, role, classe_id, email FROM users ORDER BY role, nom").fetchall()
    result = [dict(r) for r in rows]
    _cache.set("users", result, ttl=60)
    return jsonify(result)
  except Exception as e:
    logger.error(f"Erreur /users: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

# ========================
# ACTIVITÉS
# ========================
@app.route("/activites")
@login_required
def get_activites():
  try:
    role = session["role"]
    user_id = session["user_id"]
    classe_id = session.get("classe_id")

    conn = get_db_read()

    if role == "eleve":
      if not classe_id:
        return jsonify({"error": "Classe non définie"}), 400

      rows = conn.execute("""
        SELECT DISTINCT a.id, a.titre, a.description, a.prof_id, a.salle, a.separable,
              a.effectif_max, a.date_ouverture_inscriptions, a.date_fermeture_inscriptions,
              COALESCE(a.animateur_id, a.prof_id) as animateur_id,
              COALESCE(a.visible_avant, 0) as visible_avant, a.groupe_id,
                    u.prenom AS animateur_prenom,
                    u.nom AS animateur_nom
        FROM activites a
        JOIN activite_classes ac ON a.id = ac.activite_id
        LEFT JOIN users u ON u.id = COALESCE(a.animateur_id, a.prof_id)
        WHERE ac.classe_id = ?
        ORDER BY a.titre
      """, (classe_id,)).fetchall()
    else:
      rows = conn.execute("""
        SELECT
              a.id, a.titre, a.description, a.prof_id, a.salle, a.separable,
              a.effectif_max, a.date_ouverture_inscriptions, a.date_fermeture_inscriptions,
              COALESCE(a.animateur_id, a.prof_id) AS animateur_id,
              COALESCE(a.visible_avant, 0) AS visible_avant, a.groupe_id,
              u.prenom AS animateur_prenom,
              u.nom AS animateur_nom
        FROM activites a
        LEFT JOIN users u ON u.id = COALESCE(a.animateur_id, a.prof_id)
        ORDER BY a.titre
      """).fetchall()

    # Pour les élèves, récupérer inscriptions + dernières séances en 1 seule requête
    inscriptions_eleve = set()
    derniere_seance_par_activite = {}
    if role == "eleve":
      inscriptions = conn.execute("""
        SELECT activite_id FROM inscriptions WHERE eleve_id = ?
      """, (user_id,)).fetchall()
      inscriptions_eleve = {ins["activite_id"] for ins in inscriptions}

      seances_rows = conn.execute("""
        SELECT s.activite_id, MAX(s.date_heure) as derniere_seance
        FROM seances s
        JOIN activite_classes ac ON s.activite_id = ac.activite_id
        WHERE ac.classe_id = ?
        GROUP BY s.activite_id
      """, (classe_id,)).fetchall()
      derniere_seance_par_activite = {
        r["activite_id"]: datetime.fromisoformat(r["derniere_seance"])
        for r in seances_rows if r["derniere_seance"]
      }
    # conn read thread-local — pas de release

    result = []
    now = now_local()

    for a in rows:
      act = dict(a)

      if role == "eleve":
        ouverture = datetime.fromisoformat(act["date_ouverture_inscriptions"])
        fermeture = datetime.fromisoformat(act["date_fermeture_inscriptions"])
        derniere_seance = derniere_seance_par_activite.get(act["id"])

        # Pas encore visible (visible_avant désactivé et période pas ouverte)
        if not act["visible_avant"] and now < ouverture:
          continue

        # Masquer si période fermée ET toutes les séances sont passées
        if now > fermeture and (derniere_seance is None or now > derniere_seance):
          continue

      result.append(act)

    return jsonify(result)

  except Exception as e:
    logger.error(f"Erreur /activites: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500



@app.route("/activites", methods=["POST"])
@role_required('prof', 'admin')
def create_activite():
  try:
    data = request.json
    valid, error = validate_basic(data, ['titre', 'salle', 'effectif_max'])
    if not valid:
      return jsonify({"error": error}), 400

    # Utilisation des helpers sécurisés
    titre = safe_string(data.get("titre"), max_length=100)
    description = safe_string(data.get("description", ""), max_length=500)
    salle = safe_string(data.get("salle"), max_length=50)

    effectif = safe_int(data.get("effectif_max"), min_val=1, max_val=100)
    separable = InputValidator.validate_boolean(data.get("separable", False))
    visible_avant = InputValidator.validate_boolean(data.get("visible_avant", False))

    # Validation liste de classes
    classe_ids, classes_error = InputValidator.validate_list(
      data.get("classe_ids", []),
      expected_type=int,
      min_items=1,
      field_name="classe_ids"
    )
    if classes_error:
      return jsonify({"error": classes_error}), 400

    # Validation chaque classe_id individuellement
    for cid in classe_ids:
      safe_int(cid, min_val=1)

    # Validation séances
    seances = data.get("seances", [])
    if not isinstance(seances, list) or len(seances) == 0:
      return jsonify({"error": "Séances requises"}), 400

    # Validation dates avec InputValidator
    ouverture = data.get("date_ouverture_inscriptions")
    fermeture = data.get("date_fermeture_inscriptions")

    ouverture_valid, ouverture_error = InputValidator.validate_datetime(ouverture, "date d'ouverture")
    if not ouverture_valid:
      return jsonify({"error": ouverture_error}), 400

    fermeture_valid, fermeture_error = InputValidator.validate_datetime(fermeture, "date de fermeture")
    if not fermeture_valid:
      return jsonify({"error": fermeture_error}), 400

    date_ouverture = datetime.fromisoformat(ouverture)
    date_fermeture = datetime.fromisoformat(fermeture)

    # Vérifier que fermeture > ouverture
    if date_fermeture <= date_ouverture:
      return jsonify({"error": "La date de fermeture doit être après la date d'ouverture"}), 400

    # Vérifier que la première séance est après la fermeture des inscriptions
    seances_dates = []
    for s in seances:
      if 'date_heure' in s:
        date_valid, date_error = InputValidator.validate_datetime(s['date_heure'], "date de séance")
        if not date_valid:
          return jsonify({"error": date_error}), 400
        seances_dates.append(datetime.fromisoformat(s['date_heure']))

    if seances_dates:
      premiere_seance = min(seances_dates)
      if premiere_seance <= date_fermeture:
        return jsonify({"error": "La première séance doit être après la date de fermeture des inscriptions"}), 400

    animateur_id = safe_int(data.get("animateur_id", session["user_id"]), min_val=1)

    # Vérifier que l'animateur existe
    conn = get_db_connection()
    cur = conn.cursor()

    animateur_exists = cur.execute("SELECT 1 FROM users WHERE id=?", (animateur_id,)).fetchone()
    if not animateur_exists:
      conn.rollback()
      _release_db(conn)
      return jsonify({"error": f"Animateur invalide: {animateur_id}"}), 400

    groupe_id = data.get("groupe_id", None)
    if groupe_id is not None and groupe_id != "":
      groupe_id = safe_int(groupe_id, min_val=1)

    if groupe_id:
      groupe_exists = cur.execute("SELECT 1 FROM groupes_exclusivite WHERE id=?", (groupe_id,)).fetchone()
      if not groupe_exists:
        conn.rollback()
        _release_db(conn)
        return jsonify({"error": f"Groupe invalide: {groupe_id}"}), 400

    # Insertion avec requêtes préparées (protection SQL injection)
    cur.execute("""
      INSERT INTO activites
      (titre, description, prof_id, salle, separable, effectif_max,
        date_ouverture_inscriptions, date_fermeture_inscriptions, visible_avant, animateur_id, groupe_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (titre, description, session["user_id"], salle, int(separable), effectif,
        ouverture, fermeture, int(visible_avant), animateur_id, groupe_id))

    act_id = cur.lastrowid

    # Insertion classes avec requêtes préparées
    for cid in classe_ids:
      classe_exists = cur.execute("SELECT 1 FROM classes WHERE id=?", (cid,)).fetchone()
      if not classe_exists:
        conn.rollback()
        _release_db(conn)
        return jsonify({"error": f"Classe invalide: {cid}"}), 400

      cur.execute("INSERT INTO activite_classes (activite_id, classe_id) VALUES (?, ?)",
                  (act_id, cid))

    # Insertion séances avec requêtes préparées
    for s in seances:
      if 'date_heure' in s and s['date_heure']:
        duree = safe_int(s.get('duree', 60), min_val=1, max_val=300)
        cur.execute("INSERT INTO seances (activite_id, date_heure, duree) VALUES (?, ?, ?)",
                    (act_id, s["date_heure"], duree))

    conn.commit()
    _release_db(conn)

    logger.info(f"Activité créée: {titre} par user {session['user_id']}")
    sse_manager.broadcast('activite_created', {'id': act_id, 'titre': titre})
    return jsonify({"success": True, "id": act_id})

  except ValidationError as ve:
    logger.error(f"Erreur validation création activité: {str(ve)}")
    return jsonify({"error": str(ve)}), 400
  except Exception as e:
    logger.error(f"Erreur création activité: {str(e)}")
    return jsonify({"error": "Erreur lors de la création"}), 500

@app.route("/activites/<int:activite_id>", methods=["DELETE"])
@role_required('prof', 'admin')
def supprimer_activite(activite_id):
  try:
    conn = get_db_connection()
    cur = conn.cursor()

    # Vérifier que l'activité existe et que le user est le créateur
    activite = cur.execute("SELECT * FROM activites WHERE id=?", (activite_id,)).fetchone()

    if not activite:
      _release_db(conn)
      return jsonify({"error": "Activité introuvable"}), 404

    # Les admins peuvent tout supprimer, les profs seulement leurs créations
    if session["role"] != "admin" and activite["prof_id"] != session["user_id"]:
      _release_db(conn)
      return jsonify({"error": "Non autorisé : vous n'êtes pas le créateur de cette activité"}), 403

    # Supprimer en cascade
    # 1. Supprimer les présences liées aux séances de cette activité
    cur.execute("""
      DELETE FROM presences
      WHERE seance_id IN (SELECT id FROM seances WHERE activite_id=?)
    """, (activite_id,))

    # 2. Supprimer les séances
    cur.execute("DELETE FROM seances WHERE activite_id=?", (activite_id,))

    # 3. Supprimer les inscriptions
    cur.execute("DELETE FROM inscriptions WHERE activite_id=?", (activite_id,))

    # 4. Supprimer les associations activité-classes
    cur.execute("DELETE FROM activite_classes WHERE activite_id=?", (activite_id,))

    # 5. Supprimer l'activité
    cur.execute("DELETE FROM activites WHERE id=?", (activite_id,))

    conn.commit()
    _release_db(conn)

    logger.info(f"Activité {activite_id} supprimée par user {session['user_id']}")
    sse_manager.broadcast('activite_deleted', {'id': activite_id})
    return jsonify({"success": True})

  except Exception as e:
    logger.error(f"Erreur suppression activité : {str(e)}")
    return jsonify({"error": "Erreur lors de la suppression"}), 500

@app.route("/activites/<int:activite_id>", methods=["PUT"])
@role_required('prof', 'admin')
def modifier_activite(activite_id):
  try:
    data = request.json

    conn = get_db_connection()
    cur = conn.cursor()

    # Vérifier que l'activité existe et que le user est le créateur
    activite = cur.execute("SELECT * FROM activites WHERE id=?", (activite_id,)).fetchone()

    if not activite:
      _release_db(conn)
      return jsonify({"error": "Activité introuvable"}), 404

    # Les admins peuvent tout modifier, les profs seulement leurs créations
    if session["role"] != "admin" and activite["prof_id"] != session["user_id"]:
      _release_db(conn)
      return jsonify({"error": "Non autorisé : vous n'êtes pas le créateur"}), 403

    # Validation basique
    valid, error = validate_basic(data, ['titre', 'salle', 'effectif_max'])
    if not valid:
      _release_db(conn)
      return jsonify({"error": error}), 400

    titre = safe_string(data.get("titre"), max_length=100)
    description = safe_string(data.get("description", ""), max_length=500)
    salle = safe_string(data.get("salle"), max_length=50)
    effectif = safe_int(data.get("effectif_max"), min_val=1, max_val=100)
    visible_avant = InputValidator.validate_boolean(data.get("visible_avant", False))

    classe_ids, classes_error = InputValidator.validate_list(
      data.get("classe_ids", []),
      expected_type=int,
      min_items=1,
      field_name="classe_ids"
    )
    if classes_error:
      _release_db(conn)
      return jsonify({"error": classes_error}), 400

    for cid in classe_ids:
      safe_int(cid, min_val=1)

    # Validation dates
    ouverture = data.get("date_ouverture_inscriptions")
    fermeture = data.get("date_fermeture_inscriptions")

    ouverture_valid, ouverture_error = InputValidator.validate_datetime(ouverture, "date d'ouverture")
    if not ouverture_valid:
      _release_db(conn)
      return jsonify({"error": ouverture_error}), 400

    fermeture_valid, fermeture_error = InputValidator.validate_datetime(fermeture, "date de fermeture")
    if not fermeture_valid:
      _release_db(conn)
      return jsonify({"error": fermeture_error}), 400

    date_ouverture = datetime.fromisoformat(ouverture)
    date_fermeture = datetime.fromisoformat(fermeture)

    if date_fermeture <= date_ouverture:
      _release_db(conn)
      return jsonify({"error": "La date de fermeture doit être après la date d'ouverture"}), 400

    animateur_id = safe_int(data.get("animateur_id", session["user_id"]), min_val=1)

    animateur_exists = cur.execute("SELECT 1 FROM users WHERE id=?", (animateur_id,)).fetchone()
    if not animateur_exists:
      _release_db(conn)
      return jsonify({"error": f"Animateur invalide: {animateur_id}"}), 400

    groupe_id = data.get("groupe_id", None)
    if groupe_id is not None and groupe_id != "":
      groupe_id = safe_int(groupe_id, min_val=1)
      groupe_exists = cur.execute("SELECT 1 FROM groupes_exclusivite WHERE id=?", (groupe_id,)).fetchone()
      if not groupe_exists:
        _release_db(conn)
        return jsonify({"error": f"Groupe invalide: {groupe_id}"}), 400
    else:
      groupe_id = None

    # Mettre à jour l'activité
    cur.execute("""
      UPDATE activites
      SET titre=?, description=?, salle=?, effectif_max=?,
        date_ouverture_inscriptions=?, date_fermeture_inscriptions=?,
        visible_avant=?, animateur_id=?, groupe_id=?
      WHERE id=?
    """, (titre, description, salle, effectif, ouverture, fermeture,
        int(visible_avant), animateur_id, groupe_id, activite_id))

    # Mettre à jour les classes
    cur.execute("DELETE FROM activite_classes WHERE activite_id=?", (activite_id,))
    for cid in classe_ids:
      classe_exists = cur.execute("SELECT 1 FROM classes WHERE id=?", (cid,)).fetchone()
      if not classe_exists:
        conn.rollback()
        _release_db(conn)
        return jsonify({"error": f"Classe invalide: {cid}"}), 400
      cur.execute("INSERT INTO activite_classes (activite_id, classe_id) VALUES (?, ?)",
                  (activite_id, cid))

    # Gérer les séances
    seances_data = data.get("seances", [])
    if not isinstance(seances_data, list) or len(seances_data) == 0:
      conn.rollback()
      _release_db(conn)
      return jsonify({"error": "Séances requises"}), 400

    # Récupérer les IDs des séances existantes
    existing_seances = cur.execute("SELECT id FROM seances WHERE activite_id=?", (activite_id,)).fetchall()
    existing_ids = {s["id"] for s in existing_seances}

    # Séparer séances à mettre à jour et nouvelles séances
    seances_to_keep = set()

    for s in seances_data:
      if 'id' in s and s['id']:
        # Séance existante - mise à jour
        seance_id = safe_int(s['id'], min_val=1)
        if seance_id in existing_ids:
          date_valid, date_error = InputValidator.validate_datetime(s['date_heure'], "date de séance")
          if not date_valid:
            conn.rollback()
            _release_db(conn)
            return jsonify({"error": date_error}), 400

          duree = safe_int(s.get('duree', 60), min_val=1, max_val=300)
          cur.execute("UPDATE seances SET date_heure=?, duree=? WHERE id=?",
                      (s['date_heure'], duree, seance_id))
          seances_to_keep.add(seance_id)
      else:
        # Nouvelle séance
        date_valid, date_error = InputValidator.validate_datetime(s['date_heure'], "date de séance")
        if not date_valid:
          conn.rollback()
          _release_db(conn)
          return jsonify({"error": date_error}), 400

        duree = safe_int(s.get('duree', 60), min_val=1, max_val=300)
        cur.execute("INSERT INTO seances (activite_id, date_heure, duree) VALUES (?, ?, ?)",
                    (activite_id, s['date_heure'], duree))

    # Supprimer les séances qui n'existent plus
    seances_to_delete = existing_ids - seances_to_keep
    for sid in seances_to_delete:
      # Supprimer les présences liées
      cur.execute("DELETE FROM presences WHERE seance_id=?", (sid,))
      cur.execute("DELETE FROM seances WHERE id=?", (sid,))

    conn.commit()
    _release_db(conn)

    logger.info(f"Activité {activite_id} modifiée par user {session['user_id']}")
    sse_manager.broadcast('activite_updated', {'id': activite_id})
    return jsonify({"success": True})

  except ValidationError as ve:
    logger.error(f"Erreur validation modification activité: {str(ve)}")
    return jsonify({"error": str(ve)}), 400
  except Exception as e:
    logger.error(f"Erreur modification activité: {str(e)}")
    return jsonify({"error": "Erreur lors de la modification"}), 500




@app.route("/seances/<int:seance_id>/pdf", methods=["POST"])
@role_required('prof', 'admin')
def generer_pdf_seance(seance_id):
  try:
    data = request.json
    options = {
      'show_emargement': data.get('show_emargement', True),
      'show_appel': data.get('show_appel', True),
      'show_commentaire': data.get('show_commentaire', False)
    }

    conn = get_db_connection()
    cur = conn.cursor()

    seance_data = cur.execute("""
      SELECT s.*, a.titre, a.description, a.salle, a.effectif_max,
            a.animateur_id, a.prof_id, a.separable
      FROM seances s
      JOIN activites a ON s.activite_id = a.id
      WHERE s.id = ?
    """, (seance_id,)).fetchone()

    if not seance_data:
      _release_db(conn)
      return jsonify({"error": "Séance introuvable"}), 404

    if session["role"] != "admin" and seance_data["prof_id"] != session["user_id"] and seance_data["animateur_id"] != session["user_id"]:
      _release_db(conn)
      return jsonify({"error": "Non autorisé"}), 403

    presences = cur.execute("""
      SELECT p.*, u.prenom, u.nom, c.nom as classe_nom
      FROM presences p
      JOIN users u ON p.eleve_id = u.id
      LEFT JOIN classes c ON u.classe_id = c.id
      WHERE p.seance_id = ?
      ORDER BY u.nom, u.prenom
    """, (seance_id,)).fetchall()

    animateur_id = seance_data["animateur_id"] or seance_data["prof_id"]
    animateur = cur.execute("SELECT prenom, nom FROM users WHERE id=?", (animateur_id,)).fetchone()

    _release_db(conn)

    # PDF ULTRA COMPACT
    buffer = BytesIO()
    doc = SimpleDocTemplate(
      buffer,
      pagesize=A4,
      topMargin=1*cm,
      bottomMargin=1*cm,
      leftMargin=1*cm,
      rightMargin=1*cm
    )

    styles = getSampleStyleSheet()
    story = []

    # TITRE SIMPLE, AUCUNE COULEUR
    title = Paragraph(
      f"<b>LYCÉE ASSOMPTION - LISTE D'APPEL<br/>{seance_data['titre']}</b>",
      ParagraphStyle(
        "Title",
        parent=styles["Normal"],
        fontSize=13,
        alignment=TA_CENTER,
        spaceAfter=6,
        leading=13
      )
    )
    story.append(title)

    # INFOS SÉANCE (compact)
    date_seance = formatDateLocal(seance_data['date_heure']) if seance_data['date_heure'] else '—'
    duree = seance_data['duree'] or 60
    anim = f"{animateur['prenom']} {animateur['nom']}" if animateur else "—"

    info = [
      ["Date :", date_seance],
      ["Durée :", f"{duree} min"],
      ["Salle :", seance_data['salle'] or "—"],
      ["Animateur :", anim],
      ["Inscrits :", f"{len(presences)}/{seance_data['effectif_max']}"]
    ]

    info_table = Table(info, colWidths=[2.5*cm, 11*cm])
    info_table.setStyle(TableStyle([
      ("ALIGN", (0, 0), (0, -1), "RIGHT"),
      ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
      ("FONTSIZE", (0, 0), (-1, -1), 9),
      ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
      ("TOPPADDING", (0, 0), (-1, -1), 1),
    ]))
    story.append(info_table)
    story.append(Spacer(1, 0.2*cm))

    # TABLEAU ÉLÈVES — STYLE REGISTRE
    headers = ["N°", "Nom", "Prénom", "Classe"]

    # Largeur A4 utilisable (21cm - 2cm de marges)
    PAGE_W = 19 * cm
    # Largeur fixe réservée aux colonnes non-texte
    FIXED_W = 0.9 * cm  # N°

    # Calculer la largeur minimale nécessaire pour Nom et Prénom
    # Helvetica ≈ 0.55pt par caractère à 8pt → ~0.194mm/char
    CHAR_W_CM = 0.194 / 10  # en cm par caractère à taille 8pt
    PAD_CM    = 0.4          # padding interne (2+2)

    max_nom    = max((len(p["nom"])    for p in presences), default=6)
    max_prenom = max((len(p["prenom"]) for p in presences), default=6)
    max_classe = max((len(p["classe_nom"] or "—") for p in presences), default=4)

    # Min 3cm, Max 7cm pour Nom/Prénom, adaptatif sinon
    w_num    = 0.9 * cm
    w_classe = max(1.5 * cm, min(2.5 * cm, (max_classe * CHAR_W_CM + PAD_CM) * cm))
    w_appel  = 1.5 * cm if options["show_appel"]      else 0
    w_emarg  = 3.5 * cm if options["show_emargement"] else 0

    # Budget restant pour Nom + Prénom
    budget = PAGE_W - w_num - w_classe - w_appel - w_emarg

    # Répartir proportionnellement au contenu (ratio noms)
    total_chars = max_nom + max_prenom or 1
    raw_nom    = budget * (max_nom    / total_chars)
    raw_prenom = budget * (max_prenom / total_chars)

    w_nom    = max(3.0 * cm, min(8.0 * cm, raw_nom))
    w_prenom = max(2.5 * cm, min(7.0 * cm, raw_prenom))

    # Si les deux débordent, réduire proportionnellement
    total_np = w_nom + w_prenom
    if total_np > budget:
        factor   = budget / total_np
        w_nom    = w_nom    * factor
        w_prenom = w_prenom * factor

    col_widths = [w_num, w_nom, w_prenom, w_classe]

    if options["show_appel"]:
      headers.append("Présent")
      col_widths.append(w_appel)

    if options["show_emargement"]:
      headers.append("Signature")
      col_widths.append(w_emarg)

    rows = [headers]

    for i, p in enumerate(presences, 1):
      row = [
        str(i),
        p["nom"],
        p["prenom"],
        p["classe_nom"] or "—"
      ]

      if options["show_appel"]:
        row.append("")

      if options["show_emargement"]:
        row.append("")

      rows.append(row)

    table = Table(rows, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle([
      # En-tête
      ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
      ("FONTSIZE", (0, 0), (-1, 0), 9),
      ("ALIGN", (0, 0), (-1, 0), "CENTER"),
      ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
      ("TOPPADDING", (0, 0), (-1, 0), 2),

      # Corps
      ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
      ("FONTSIZE", (0, 1), (-1, -1), 8),
      ("ALIGN", (0, 1), (0, -1), "CENTER"),
      ("ALIGN", (1, 1), (1, -1), "LEFT"),

      ("GRID", (0, 0), (-1, -1), 0.4, colors.black),

      ("LEFTPADDING", (0, 0), (-1, -1), 2),
      ("RIGHTPADDING", (0, 0), (-1, -1), 2),
      ("TOPPADDING", (0, 1), (-1, -1), 1),
      ("BOTTOMPADDING", (0, 1), (-1, -1), 1)
    ]))

    story.append(table)

    # Build
    doc.build(story)

    buffer.seek(0)
    return send_file(
      buffer,
      mimetype="application/pdf",
      as_attachment=True,
      download_name=f"appel_{seance_id}.pdf"
    )

  except Exception as e:
    logger.error(f"Erreur PDF : {e}")
    return jsonify({"error": "Erreur PDF"}), 500

# Fonction helper pour le formatage de date (à ajouter si pas déjà présente)
def formatDateLocal(date_str):
  try:
    d = datetime.fromisoformat(date_str.replace(' ', 'T'))
    return d.strftime('%d/%m/%Y à %H:%M')
  except:
    return date_str

# ========================
# INSCRIPTIONS
# ========================
@app.route("/inscriptions", methods=["POST"])
@role_required('eleve')
def inscrire():
  try:
    data = request.json
    if not data or 'activite_id' not in data:
      return jsonify({"error": "Données manquantes"}), 400

    activite_id = validate_integer(data.get("activite_id"), min_val=1)
    user_id = session["user_id"]
    classe_id = session["classe_id"]

    if not classe_id:
      return jsonify({"error": "Classe non définie"}), 400

    conn = get_db_connection()
    cur = conn.cursor()

    act = cur.execute("""
      SELECT a.* FROM activites a
      JOIN activite_classes ac ON a.id = ac.activite_id
      WHERE a.id = ? AND ac.classe_id = ?
    """, (activite_id, classe_id)).fetchone()

    if not act:
      _release_db(conn)
      return jsonify({"error": "Activité non accessible à votre classe"}), 403

    if act["separable"]:
      _release_db(conn)
      return jsonify({"error": "Cette activité est sécable, inscrivez-vous séance par séance"}), 400

    now = now_local()
    ouverture = datetime.fromisoformat(act["date_ouverture_inscriptions"])
    fermeture = datetime.fromisoformat(act["date_fermeture_inscriptions"])

    if now < ouverture or now > fermeture:
      _release_db(conn)
      return jsonify({"error": "Période d'inscription fermée"}), 400

    if act["groupe_id"]:
      conflits = cur.execute("""
        SELECT DISTINCT a.titre
        FROM activites a
        JOIN seances s ON a.id = s.activite_id
        JOIN presences p ON s.id = p.seance_id
        WHERE a.groupe_id = ?
        AND p.eleve_id = ?
        AND a.id != ?
      """, (act["groupe_id"], user_id, activite_id)).fetchall()

      if conflits:
        _release_db(conn)
        activite_conflit = conflits[0]["titre"]
        return jsonify({
          "error": f"Vous êtes déjà inscrit à '{activite_conflit}' du même groupe exclusif"
        }), 400

    seances = cur.execute("SELECT id FROM seances WHERE activite_id=?", (activite_id,)).fetchall()

    if not seances:
      _release_db(conn)
      return jsonify({"error": "Aucune séance pour cette activité"}), 400

    existing = cur.execute("""
      SELECT 1 FROM presences
      WHERE eleve_id=? AND seance_id IN (SELECT id FROM seances WHERE activite_id=?)
    """, (user_id, activite_id)).fetchone()

    if existing:
      _release_db(conn)
      return jsonify({"error": "Déjà inscrit"}), 400

    for seance in seances:
      count = cur.execute("""
        SELECT COUNT(*) FROM presences WHERE seance_id=?
      """, (seance["id"],)).fetchone()[0]

      if count >= act["effectif_max"]:
        _release_db(conn)
        return jsonify({"error": f"Effectif complet pour au moins une séance"}), 400

    for seance in seances:
      cur.execute("""
        INSERT INTO presences (seance_id, eleve_id, present, commentaire)
        VALUES (?, ?, 0, '')
      """, (seance["id"], user_id))

    cur.execute("""
      INSERT INTO inscriptions (eleve_id, activite_id, date_inscription)
      VALUES (?, ?, ?)
    """, (user_id, activite_id, now_local_str()))

    conn.commit()

    # Compter les inscrits actuels pour mise à jour UI sans refetch
    nb_inscrits = get_db_read().execute(
      "SELECT COUNT(*) FROM inscriptions WHERE activite_id=?", (activite_id,)
    ).fetchone()[0]

    # Broadcast SSE
    sse_manager.broadcast('inscription_created', {
      'eleve_id': user_id,
      'activite_id': activite_id,
      'nb_inscrits': nb_inscrits
    })
    logger.info(f"Inscription (NON sécable): user {user_id} -> activité {activite_id} (toutes séances)")
    return jsonify({"success": True})

  except ValueError as ve:
    return jsonify({"error": str(ve)}), 400
  except Exception as e:
    logger.error(f"Erreur inscription: {str(e)}")
    return jsonify({"error": "Erreur lors de l'inscription"}), 500

@app.route("/inscriptions", methods=["DELETE"])
@login_required
def desinscrire():
  try:
    data = request.json
    if not data or 'activite_id' not in data:
      return jsonify({"error": "Données manquantes"}), 400

    activite_id = validate_integer(data.get("activite_id"), min_val=1)

    # Support pour désinscription par admin/prof
    eleve_id = data.get("eleve_id")

    if eleve_id:
      # Vérifier que l'utilisateur est admin ou prof créateur
      if session.get("role") not in ['admin', 'prof']:
        return jsonify({"error": "Non autorisé"}), 403

      eleve_id = validate_integer(eleve_id, min_val=1)
    else:
      # Désinscription de soi-même (élève)
      if session.get("role") != 'eleve':
        return jsonify({"error": "Non autorisé"}), 403
      eleve_id = session["user_id"]

    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute("""
      DELETE FROM presences
      WHERE eleve_id=? AND seance_id IN (SELECT id FROM seances WHERE activite_id=?)
    """, (eleve_id, activite_id))

    result = cur.execute("DELETE FROM inscriptions WHERE eleve_id=? AND activite_id=?",
                        (eleve_id, activite_id))

    affected = result.rowcount
    conn.commit()

    nb_inscrits = get_db_read().execute(
      "SELECT COUNT(*) FROM inscriptions WHERE activite_id=?", (activite_id,)
    ).fetchone()[0]

    # Broadcast SSE
    sse_manager.broadcast('inscription_deleted', {
      'eleve_id': eleve_id,
      'activite_id': activite_id,
      'nb_inscrits': nb_inscrits
    })
    if affected == 0:
      return jsonify({"error": "Inscription non trouvée"}), 400

    logger.info(f"Désinscription (NON sécable): user {eleve_id} <- activité {activite_id}")
    return jsonify({"success": True})

  except ValueError as ve:
    return jsonify({"error": str(ve)}), 400
  except Exception as e:
    logger.error(f"Erreur désinscription: {str(e)}")
    return jsonify({"error": "Erreur lors de la désinscription"}), 500

@app.route("/inscriptions/seance", methods=["POST"])
@role_required('eleve')
def inscrire_seance():
  try:
    data = request.json
    if not data or 'seance_id' not in data:
      return jsonify({"error": "Données manquantes"}), 400

    seance_id = validate_integer(data.get("seance_id"), min_val=1)
    user_id = session["user_id"]
    classe_id = session["classe_id"]

    if not classe_id:
      return jsonify({"error": "Classe non définie"}), 400

    conn = get_db_connection()
    cur = conn.cursor()

    seance = cur.execute("SELECT * FROM seances WHERE id=?", (seance_id,)).fetchone()
    if not seance:
      _release_db(conn)
      return jsonify({"error": "Séance introuvable"}), 404

    activite_id = seance["activite_id"]

    act = cur.execute("""
      SELECT a.* FROM activites a
      JOIN activite_classes ac ON a.id = ac.activite_id
      WHERE a.id = ? AND ac.classe_id = ?
    """, (activite_id, classe_id)).fetchone()

    if not act:
      _release_db(conn)
      return jsonify({"error": "Activité non accessible"}), 403

    if not act["separable"]:
      _release_db(conn)
      return jsonify({"error": "Cette activité n'est pas sécable"}), 400

    now = now_local()
    ouverture = datetime.fromisoformat(act["date_ouverture_inscriptions"])
    fermeture = datetime.fromisoformat(act["date_fermeture_inscriptions"])

    if now < ouverture or now > fermeture:
      _release_db(conn)
      return jsonify({"error": "Période d'inscription fermée"}), 400

    if act["groupe_id"]:
      conflits = cur.execute("""
        SELECT DISTINCT a.titre
        FROM activites a
        JOIN seances s ON a.id = s.activite_id
        JOIN presences p ON s.id = p.seance_id
        WHERE a.groupe_id = ?
        AND p.eleve_id = ?
        AND a.id != ?
      """, (act["groupe_id"], user_id, activite_id)).fetchall()

      if conflits:
        _release_db(conn)
        activite_conflit = conflits[0]["titre"]
        return jsonify({
          "error": f"Vous êtes déjà inscrit à '{activite_conflit}' du même groupe exclusif"
        }), 400

    count = cur.execute("SELECT COUNT(*) FROM presences WHERE seance_id=?",
                        (seance_id,)).fetchone()[0]
    if count >= act["effectif_max"]:
      _release_db(conn)
      return jsonify({"error": "Séance complète"}), 400

    existing = cur.execute("SELECT 1 FROM presences WHERE eleve_id=? AND seance_id=?",
                          (user_id, seance_id)).fetchone()
    if existing:
      _release_db(conn)
      return jsonify({"error": "Déjà inscrit à cette séance"}), 400

    cur.execute("""
      INSERT INTO presences (seance_id, eleve_id, present, commentaire)
      VALUES (?, ?, 0, '')
    """, (seance_id, user_id))

    conn.commit()

    nb_inscrits_seance = get_db_read().execute(
      "SELECT COUNT(*) FROM presences WHERE seance_id=?", (seance_id,)
    ).fetchone()[0]

    # Broadcast SSE
    sse_manager.broadcast('inscription_seance_created', {
      'eleve_id': user_id,
      'seance_id': seance_id,
      'activite_id': activite_id,
      'nb_inscrits_seance': nb_inscrits_seance
    })
    logger.info(f"Inscription séance: user {user_id} -> séance {seance_id}")
    return jsonify({"success": True})

  except ValueError as ve:
    return jsonify({"error": str(ve)}), 400
  except Exception as e:
    logger.error(f"Erreur inscription séance: {str(e)}")
    return jsonify({"error": "Erreur lors de l'inscription"}), 500

@app.route("/inscriptions/seance", methods=["DELETE"])
@login_required
def desinscrire_seance():
  try:
    data = request.json
    if not data or 'seance_id' not in data:
      return jsonify({"error": "Données manquantes"}), 400

    seance_id = validate_integer(data.get("seance_id"), min_val=1)

    # Support pour désinscription par admin/prof
    eleve_id = data.get("eleve_id")

    if eleve_id:
      # Vérifier que l'utilisateur est admin ou prof créateur
      if session.get("role") not in ['admin', 'prof']:
        return jsonify({"error": "Non autorisé"}), 403

      eleve_id = validate_integer(eleve_id, min_val=1)
    else:
      # Désinscription de soi-même (élève)
      if session.get("role") != 'eleve':
        return jsonify({"error": "Non autorisé"}), 403
      eleve_id = session["user_id"]

    conn = get_db_connection()
    cur = conn.cursor()

    result = cur.execute("DELETE FROM presences WHERE eleve_id=? AND seance_id=?",
                        (eleve_id, seance_id))
    affected = result.rowcount

    # Nettoyer inscriptions si l'élève n'a plus aucune présence dans cette activité
    cur.execute("""
        DELETE FROM inscriptions
        WHERE eleve_id = ?
          AND activite_id = (SELECT activite_id FROM seances WHERE id = ?)
          AND NOT EXISTS (
              SELECT 1 FROM presences p
              JOIN seances s ON s.id = p.seance_id
              WHERE p.eleve_id = ?
                AND s.activite_id = (SELECT activite_id FROM seances WHERE id = ?)
          )
    """, (eleve_id, seance_id, eleve_id, seance_id))

    conn.commit()

    nb_inscrits_seance = get_db_read().execute(
      "SELECT COUNT(*) FROM presences WHERE seance_id=?", (seance_id,)
    ).fetchone()[0]
    activite_id_row = get_db_read().execute(
      "SELECT activite_id FROM seances WHERE id=?", (seance_id,)
    ).fetchone()
    activite_id_val = activite_id_row["activite_id"] if activite_id_row else None

    # Broadcast SSE
    sse_manager.broadcast('inscription_seance_deleted', {
      'eleve_id': eleve_id,
      'seance_id': seance_id,
      'activite_id': activite_id_val,
      'nb_inscrits_seance': nb_inscrits_seance
    })
    if affected == 0:
      return jsonify({"error": "Inscription non trouvée"}), 400

    logger.info(f"Désinscription séance: user {eleve_id} <- séance {seance_id}")
    return jsonify({"success": True})

  except ValueError as ve:
    return jsonify({"error": str(ve)}), 400
  except Exception as e:
    logger.error(f"Erreur désinscription séance: {str(e)}")
    return jsonify({"error": "Erreur lors de la désinscription"}), 500

# ========================
# DONNÉES ENRICHIES
# ========================
@app.route("/seances")
@login_required
def get_seances():
  try:
    role = session["role"]
    classe_id = session.get("classe_id")

    conn = get_db_connection()

    if role == "eleve" and classe_id:
      rows = conn.execute("""
        SELECT DISTINCT s.* FROM seances s
        JOIN activites a ON s.activite_id = a.id
        JOIN activite_classes ac ON a.id = ac.activite_id
        WHERE ac.classe_id = ?
        ORDER BY s.date_heure
      """, (classe_id,)).fetchall()
    else:
      rows = conn.execute("SELECT * FROM seances ORDER BY date_heure").fetchall()

    _release_db(conn)
    return jsonify([dict(r) for r in rows])
  except Exception as e:
    logger.error(f"Erreur /seances: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/inscriptions")
@login_required
def get_inscriptions():
  try:
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM inscriptions ORDER BY date_inscription").fetchall()
    _release_db(conn)
    return jsonify([dict(r) for r in rows])
  except Exception as e:
    logger.error(f"Erreur /inscriptions: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/inscriptions/seances")
@login_required
def get_inscriptions_seances():
  try:
    conn = get_db_connection()
    rows = conn.execute("""
      SELECT seance_id, eleve_id
      FROM presences
    """).fetchall()
    _release_db(conn)
    return jsonify([dict(r) for r in rows])
  except Exception as e:
    logger.error(f"Erreur /inscriptions/seances: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/inscriptions/delta")
@login_required
def get_inscriptions_delta():
  """Retourne uniquement les données de comptage d'une activité spécifique.
  Utilisé par le SSE pour éviter de tout recharger.
  ?activite_id=X  → compte inscrits + séances avec comptes."""
  try:
    activite_id = request.args.get("activite_id", type=int)
    if not activite_id:
      return jsonify({"error": "activite_id requis"}), 400

    conn = get_db_read()
    nb_inscrits = conn.execute(
      "SELECT COUNT(*) FROM inscriptions WHERE activite_id=?", (activite_id,)
    ).fetchone()[0]

    seances_counts = conn.execute("""
      SELECT s.id AS seance_id, COUNT(p.eleve_id) AS nb_inscrits
      FROM seances s
      LEFT JOIN presences p ON p.seance_id = s.id
      WHERE s.activite_id = ?
      GROUP BY s.id
    """, (activite_id,)).fetchall()

    return jsonify({
      "activite_id": activite_id,
      "nb_inscrits": nb_inscrits,
      "seances": [dict(r) for r in seances_counts]
    })
  except Exception as e:
    logger.error(f"Erreur /inscriptions/delta: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/activite_classes")
@login_required
def get_activite_classes():
  try:
    role = session["role"]
    classe_id = session.get("classe_id")

    conn = get_db_read()

    if role == "eleve" and classe_id:
      rows = conn.execute("SELECT * FROM activite_classes WHERE classe_id = ?",
                          (classe_id,)).fetchall()
    else:
      rows = conn.execute("SELECT * FROM activite_classes").fetchall()

    return jsonify([dict(r) for r in rows])
  except Exception as e:
    logger.error(f"Erreur /activite_classes: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

# ========================
# GROUPES D'EXCLUSIVITÉ - ÉLÈVES NON INSCRITS
# ========================
@app.route("/groupes/<int:groupe_id>/eleves-non-inscrits", methods=["GET"])
@role_required('prof', 'admin')
def get_eleves_non_inscrits(groupe_id):
  """Récupère la liste des élèves non inscrits à un groupe d'activités"""
  try:
    conn = get_db_connection()
    cur = conn.cursor()

    # Vérifier que le groupe existe
    groupe = cur.execute("SELECT * FROM groupes_exclusivite WHERE id=?", (groupe_id,)).fetchone()
    if not groupe:
      _release_db(conn)
      return jsonify({"error": "Groupe introuvable"}), 404

    # Récupérer toutes les activités du groupe
    activites = cur.execute("""
      SELECT id FROM activites WHERE groupe_id = ?
    """, (groupe_id,)).fetchall()

    if not activites:
      _release_db(conn)
      return jsonify({"eleves": []})

    activite_ids = [a["id"] for a in activites]

    # Récupérer toutes les classes concernées par ces activités
    classes_ids = cur.execute("""
      SELECT DISTINCT classe_id
      FROM activite_classes
      WHERE activite_id IN ({})
    """.format(','.join('?' * len(activite_ids))), activite_ids).fetchall()

    if not classes_ids:
      _release_db(conn)
      return jsonify({"eleves": []})

    classe_ids_list = [c["classe_id"] for c in classes_ids]

    # Récupérer tous les élèves de ces classes
    eleves_concernes = cur.execute("""
      SELECT u.id, u.prenom, u.nom, u.email, u.classe_id, c.nom as classe_nom
      FROM users u
      LEFT JOIN classes c ON u.classe_id = c.id
      WHERE u.role = 'eleve'
      AND u.classe_id IN ({})
      ORDER BY u.nom, u.prenom
    """.format(','.join('?' * len(classe_ids_list))), classe_ids_list).fetchall()

    # Pour chaque élève, vérifier s'il est inscrit à au moins une activité du groupe
    eleves_non_inscrits = []

    for eleve in eleves_concernes:
      # Vérifier s'il existe une inscription
      inscription = cur.execute("""
        SELECT 1
        FROM presences p
        JOIN seances s ON p.seance_id = s.id
        JOIN activites a ON s.activite_id = a.id
        WHERE p.eleve_id = ?
        AND a.groupe_id = ?
        LIMIT 1
      """, (eleve["id"], groupe_id)).fetchone()

      if not inscription:
        eleve_dict = dict(eleve)
        # Vérifier si un mail a déjà été envoyé récemment (dans les 7 derniers jours)
        mail_recent = cur.execute("""
          SELECT date_envoi
          FROM rappels_inscription
          WHERE eleve_id = ? AND groupe_id = ?
          AND datetime(date_envoi) > datetime('now', '-7 days')
          ORDER BY date_envoi DESC
          LIMIT 1
        """, (eleve["id"], groupe_id)).fetchone()

        eleve_dict["dernier_mail"] = mail_recent["date_envoi"] if mail_recent else None
        eleves_non_inscrits.append(eleve_dict)

    _release_db(conn)

    return jsonify({
      "groupe": dict(groupe),
      "eleves": eleves_non_inscrits
    })

  except Exception as e:
    logger.error(f"Erreur get_eleves_non_inscrits: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/groupes/<int:groupe_id>/rappel-inscription", methods=["POST"])
@role_required('prof', 'admin')
def envoyer_rappel_inscription(groupe_id):
  """Envoie un mail de rappel d'inscription à un élève"""
  try:
    data = request.json
    if not data or 'eleve_id' not in data:
      return jsonify({"error": "Données manquantes"}), 400

    eleve_id = validate_integer(data.get("eleve_id"), min_val=1)

    # Toutes les lectures sur la connexion thread-local (pas de pool write gaspillé)
    rconn = get_db_read()

    groupe = rconn.execute(
      "SELECT * FROM groupes_exclusivite WHERE id=?", (groupe_id,)
    ).fetchone()
    if not groupe:
      return jsonify({"error": "Groupe introuvable"}), 404

    eleve = rconn.execute("""
      SELECT u.*, c.nom as classe_nom
      FROM users u
      LEFT JOIN classes c ON u.classe_id = c.id
      WHERE u.id = ? AND u.role = 'eleve'
    """, (eleve_id,)).fetchone()
    if not eleve:
      return jsonify({"error": "Élève introuvable"}), 404
    if not eleve["email"]:
      return jsonify({"error": "Cet élève n'a pas d'adresse email"}), 400

    prof = rconn.execute(
      "SELECT prenom, nom FROM users WHERE id=?", (session["user_id"],)
    ).fetchone()

    # Préparer l'email
    subject = f"Rappel d'inscription - Groupe {groupe['nom']}"

    html_content = f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
body{{font-family: 'Arial', sans-serif;line-height: 1.6;color: #222;background: #f6f8fb;margin: 0;padding: 20px;}}
.container{{max-width: 600px;margin: 0 auto;background: white;border-radius: 12px;overflow: hidden;box-shadow: 0 8px 24px rgba(20, 30, 60, 0.1);border: 1px solid #e2e8f0;}}
.header{{background: linear-gradient(135deg, #0b72ff, #d63384);padding: 35px 20px;text-align: center;}}
.header h1{{color: white;margin: 0;font-size: 28px;font-weight: 700;}}
.content{{padding: 40px 30px;font-size: 15px;color: #333;}}
.content p{{margin-bottom: 20px;}}
.warning{{background: #fff5f7;border-left: 5px solid #dd1738;padding: 20px 15px;margin: 20px 0;border-radius: 8px;font-weight: 600;color: #9b1c31;}}
.btn{{display: inline-block;background: linear-gradient(135deg, #0b72ff, #0052cc );color: #fff !important;padding: 14px 32px;text-decoration: none;border-radius: 10px;font-weight: 600;font-size: 16px;box-shadow: 0 6px 16px rgba(11, 114, 255, 0.3);transition: all 0.3s ease;}}
.btn:hover{{transform: translateY(-2px);box-shadow: 0 10px 20px rgba(11, 114, 255, 0.4);}}
.footer{{background: #f8fafc;padding: 20px;text-align: center;color: #666;font-size: 12px;}}
.footer p{{margin: 5px 0;}}
.highlight{{font-weight: 700;color: #0b72ff;}}
a {{color: inherit;}}
</style></head><body>
<div class="container">
<div class="header"><h1>Rappel D'inscription</h1></div>
<div class="content">
<p>Bonjour <strong>{eleve['prenom']} {eleve['nom']}</strong>,</p>
<p>Vous recevez ce message car vous ne vous êtes pas encore inscrit(e) à une activité du groupe d'activités <strong>«&nbsp;{groupe['nom']}&nbsp;»</strong>.</p>
<div class="warning">⚠️ Action requise : Ce groupe d'activités est <strong>obligatoire</strong>. Veuillez vous inscrire dans la limite des places disponibles.</div>
<p>Pour vous inscrire, cliquez sur le bouton ci-dessous pour accéder à la plateforme <span class="highlight">CONCORDE</span> :</p>
<p style="text-align:center;margin:35px 0"><a href="{BASE_URL}" class="btn">Accéder à CONCORDE</a></p>
<p><strong>Si vous pensez qu'il s'agit d'une erreur</strong>, veuillez contacter&nbsp;:</p>
<p style="margin-left:20px">{prof['prenom']} {prof['nom']}</p>
</div>
<div class="footer">
<p>Cet email a été envoyé automatiquement - <strong>NE PAS RÉPONDRE</strong></p>
<p>© 2025 CONCORDE</p>
</div>
</div>
</body></html>"""

    text_content = f"""Bonjour {eleve['prenom']} {eleve['nom']},

Vous ne vous êtes pas encore inscrit(e) à une activité du groupe "{groupe['nom']}".

⚠️ Ce groupe est OBLIGATOIRE. Inscrivez-vous à une activité dans la limite des places disponibles.

Pour vous inscrire, connectez-vous sur : {BASE_URL}

Si vous pensez que c'est une erreur, contactez : {prof['prenom']} {prof['nom']}

Email automatique — NE PAS RÉPONDRE
CONCORDE © 2025"""

    success, message = send_email(eleve["email"], subject, html_content, text_content)
    if not success:
      return jsonify({"error": message}), 500

    # Écriture uniquement ici — connexion write pool
    conn = get_db_connection()
    try:
      conn.execute("""
        INSERT INTO rappels_inscription (eleve_id, groupe_id, date_envoi, envoye_par)
        VALUES (?, ?, ?, ?)
      """, (eleve_id, groupe_id, now_local_str(), session["user_id"]))
      conn.commit()
    finally:
      _release_db(conn)

    logger.info(f"Rappel inscription envoyé: groupe {groupe_id} -> élève {eleve_id}")
    return jsonify({"success": True, "message": "Email envoyé avec succès"})

  except ValueError as ve:
    return jsonify({"error": str(ve)}), 400
  except Exception as e:
    logger.error(f"Erreur envoi rappel: {str(e)}")
    return jsonify({"error": "Erreur lors de l'envoi"}), 500

@app.route("/inscriptions/manuel", methods=["POST"])
@role_required('prof', 'admin')
def inscription_manuelle():
  """Inscription manuelle d'un élève par un prof ou admin"""
  try:
    data = request.json
    if not data or 'eleve_id' not in data or 'activite_id' not in data:
      return jsonify({"error": "Données manquantes"}), 400

    eleve_id = validate_integer(data.get("eleve_id"), min_val=1)
    activite_id = validate_integer(data.get("activite_id"), min_val=1)

    conn = get_db_connection()
    cur = conn.cursor()

    # Vérifier que l'élève existe
    eleve = cur.execute("SELECT * FROM users WHERE id=? AND role='eleve'", (eleve_id,)).fetchone()
    if not eleve:
      _release_db(conn)
      return jsonify({"error": "Élève introuvable"}), 404

    # Vérifier que l'activité existe
    act = cur.execute("SELECT * FROM activites WHERE id=?", (activite_id,)).fetchone()
    if not act:
      _release_db(conn)
      return jsonify({"error": "Activité introuvable"}), 404

    # Vérifier que l'utilisateur est autorisé (admin ou créateur)
    if session.get("role") != 'admin' and act["prof_id"] != session["user_id"]:
      _release_db(conn)
      return jsonify({"error": "Non autorisé"}), 403

    # Vérifier que l'élève peut accéder à cette activité (classe)
    classe_valide = cur.execute("""
      SELECT 1 FROM activite_classes
      WHERE activite_id=? AND classe_id=?
    """, (activite_id, eleve["classe_id"])).fetchone()

    if not classe_valide:
      _release_db(conn)
      return jsonify({"error": "L'élève n'a pas accès à cette activité (classe différente)"}), 400

    # Vérifier le groupe d'exclusivité
    if act["groupe_id"]:
      conflits = cur.execute("""
        SELECT DISTINCT a.titre
        FROM activites a
        JOIN seances s ON a.id = s.activite_id
        JOIN presences p ON s.id = p.seance_id
        WHERE a.groupe_id = ?
        AND p.eleve_id = ?
        AND a.id != ?
      """, (act["groupe_id"], eleve_id, activite_id)).fetchall()

      if conflits:
        _release_db(conn)
        activite_conflit = conflits[0]["titre"]
        return jsonify({
          "error": f"L'élève est déjà inscrit à '{activite_conflit}' du même groupe exclusif"
        }), 400

    # Récupérer les séances
    seances = cur.execute("SELECT id FROM seances WHERE activite_id=?", (activite_id,)).fetchall()

    if not seances:
      _release_db(conn)
      return jsonify({"error": "Aucune séance pour cette activité"}), 400

    # Vérifier si déjà inscrit
    existing = cur.execute("""
      SELECT 1 FROM presences
      WHERE eleve_id=? AND seance_id IN (SELECT id FROM seances WHERE activite_id=?)
    """, (eleve_id, activite_id)).fetchone()

    if existing:
      _release_db(conn)
      return jsonify({"error": "Élève déjà inscrit"}), 400

    # IMPORTANT : Inscription manuelle bypasse l'effectif max
    # Pas de vérification d'effectif max ici

    # Inscrire à toutes les séances
    for seance in seances:
      cur.execute("""
        INSERT INTO presences (seance_id, eleve_id, present, commentaire)
        VALUES (?, ?, 0, '')
      """, (seance["id"], eleve_id))

    # Ajouter l'inscription
    cur.execute("""
      INSERT INTO inscriptions (eleve_id, activite_id, date_inscription)
      VALUES (?, ?, ?)
    """, (eleve_id, activite_id, now_local_str()))

    conn.commit()

    nb_inscrits = get_db_read().execute(
      "SELECT COUNT(*) FROM inscriptions WHERE activite_id=?", (activite_id,)
    ).fetchone()[0]

    # Broadcast SSE
    sse_manager.broadcast('inscription_manuelle_created', {
      'eleve_id': eleve_id,
      'activite_id': activite_id,
      'by_user_id': session['user_id'],
      'nb_inscrits': nb_inscrits
    })
    logger.info(f"Inscription manuelle: élève {eleve_id} -> activité {activite_id} par {session['user_id']}")
    return jsonify({"success": True})

  except ValueError as ve:
    return jsonify({"error": str(ve)}), 400
  except Exception as e:
    logger.error(f"Erreur inscription manuelle: {str(e)}")
    return jsonify({"error": "Erreur lors de l'inscription"}), 500

# ========================
# GROUPES D'EXCLUSIVITÉ
# ========================

@app.route("/groupes", methods=["GET"])
@login_required
def get_groupes():
  """Récupérer tous les groupes d'exclusivité"""
  try:
    cached = _cache.get("groupes")
    if cached is not None:
      return jsonify(cached)
    conn = get_db_read()
    rows = conn.execute("SELECT * FROM groupes_exclusivite ORDER BY nom").fetchall()
    result = [dict(r) for r in rows]
    _cache.set("groupes", result, ttl=60)
    return jsonify(result)
  except Exception as e:
    logger.error(f"Erreur /groupes: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/groupes", methods=["POST"])
@role_required('prof', 'admin')
def create_groupe():
  """Créer un nouveau groupe d'exclusivité avec classes"""
  try:
    data = request.json
    valid, error = validate_basic(data, ['nom'])
    if not valid:
      return jsonify({"error": error}), 400

    nom = sanitize_string(data.get("nom"), 100)
    description = sanitize_string(data.get("description", ""), 255)
    classe_ids = data.get("classe_ids", [])

    # Validation : au moins une classe requise
    if not isinstance(classe_ids, list) or len(classe_ids) == 0:
      return jsonify({"error": "Au moins une classe est requise"}), 400

    for cid in classe_ids:
      validate_integer(cid, min_val=1)

    conn = get_db_connection()
    cur = conn.cursor()

    existing = cur.execute("SELECT 1 FROM groupes_exclusivite WHERE nom=?", (nom,)).fetchone()
    if existing:
      _release_db(conn)
      return jsonify({"error": "Un groupe avec ce nom existe déjà"}), 400

    # Créer le groupe
    echanges_actifs = 1 if data.get("echanges_actifs") else 0
    cur.execute("INSERT INTO groupes_exclusivite (nom, description, echanges_actifs) VALUES (?, ?, ?)",
                (nom, description, echanges_actifs))
    groupe_id = cur.lastrowid

    # Associer les classes
    for cid in classe_ids:
      classe_exists = cur.execute("SELECT 1 FROM classes WHERE id=?", (cid,)).fetchone()
      if not classe_exists:
        conn.rollback()
        _release_db(conn)
        return jsonify({"error": f"Classe invalide: {cid}"}), 400

      cur.execute("INSERT INTO groupe_classes (groupe_id, classe_id) VALUES (?, ?)",
                  (groupe_id, cid))

    conn.commit()
    _release_db(conn)

    logger.info(f"Groupe créé: {nom} (ID: {groupe_id}) avec {len(classe_ids)} classe(s)")
    _cache.invalidate("groupes", "groupe_classes")
    sse_manager.broadcast('groupe_created', {'id': groupe_id, 'nom': nom})
    return jsonify({"success": True, "id": groupe_id})

  except ValueError as ve:
    return jsonify({"error": str(ve)}), 400
  except Exception as e:
    logger.error(f"Erreur création groupe: {str(e)}")
    return jsonify({"error": "Erreur lors de la création"}), 500

@app.route("/groupes/<int:groupe_id>", methods=["DELETE"])
@role_required('prof', 'admin')
def delete_groupe(groupe_id):
  """Supprimer un groupe d'exclusivité"""
  try:
    conn = get_db_connection()
    cur = conn.cursor()

    activites_count = cur.execute(
      "SELECT COUNT(*) FROM activites WHERE groupe_id=?",
      (groupe_id,)
    ).fetchone()[0]

    if activites_count > 0:
      _release_db(conn)
      return jsonify({
        "error": f"Impossible de supprimer : {activites_count} activité(s) utilisent ce groupe"
      }), 400

    # Supprimer les associations classe (CASCADE devrait le faire, mais soyons explicites)
    cur.execute("DELETE FROM groupe_classes WHERE groupe_id=?", (groupe_id,))

    result = cur.execute("DELETE FROM groupes_exclusivite WHERE id=?", (groupe_id,))

    if result.rowcount == 0:
      _release_db(conn)
      return jsonify({"error": "Groupe introuvable"}), 404

    conn.commit()
    _release_db(conn)

    logger.info(f"Groupe supprimé: ID {groupe_id}")
    _cache.invalidate("groupes", "groupe_classes")
    sse_manager.broadcast('groupe_deleted', {'id': groupe_id})
    return jsonify({"success": True})

  except Exception as e:
    logger.error(f"Erreur suppression groupe: {str(e)}")
    return jsonify({"error": "Erreur lors de la suppression"}), 500


@app.route("/groupes/<int:groupe_id>", methods=["PUT"])
@role_required('prof', 'admin')
def update_groupe(groupe_id):
  """Modifier un groupe d'exclusivité"""
  try:
    data = request.json
    valid, error = validate_basic(data, ['nom'])
    if not valid:
      return jsonify({"error": error}), 400

    nom = sanitize_string(data.get("nom"), 100)
    description = sanitize_string(data.get("description", ""), 255)
    classe_ids = data.get("classe_ids", [])

    # Validation : au moins une classe requise
    if not isinstance(classe_ids, list) or len(classe_ids) == 0:
      return jsonify({"error": "Au moins une classe est requise"}), 400

    for cid in classe_ids:
      validate_integer(cid, min_val=1)

    conn = get_db_connection()
    cur = conn.cursor()

    # Vérifier que le groupe existe
    groupe = cur.execute("SELECT * FROM groupes_exclusivite WHERE id=?", (groupe_id,)).fetchone()
    if not groupe:
      _release_db(conn)
      return jsonify({"error": "Groupe introuvable"}), 404

    # Vérifier unicité du nom (sauf pour le groupe actuel)
    existing = cur.execute(
      "SELECT 1 FROM groupes_exclusivite WHERE nom=? AND id!=?",
      (nom, groupe_id)
    ).fetchone()
    if existing:
      _release_db(conn)
      return jsonify({"error": "Un groupe avec ce nom existe déjà"}), 400

    echanges_actifs = 1 if data.get("echanges_actifs") else 0
    # Mettre à jour le groupe
    cur.execute(
      "UPDATE groupes_exclusivite SET nom=?, description=?, echanges_actifs=? WHERE id=?",
      (nom, description, echanges_actifs, groupe_id)
    )

    # Supprimer les anciennes associations
    cur.execute("DELETE FROM groupe_classes WHERE groupe_id=?", (groupe_id,))

    # Ajouter les nouvelles associations
    for cid in classe_ids:
      classe_exists = cur.execute("SELECT 1 FROM classes WHERE id=?", (cid,)).fetchone()
      if not classe_exists:
        conn.rollback()
        _release_db(conn)
        return jsonify({"error": f"Classe invalide: {cid}"}), 400

      cur.execute("INSERT INTO groupe_classes (groupe_id, classe_id) VALUES (?, ?)",
                  (groupe_id, cid))

    conn.commit()
    _release_db(conn)

    logger.info(f"Groupe modifié: {nom} (ID: {groupe_id})")
    _cache.invalidate("groupes", "groupe_classes")
    sse_manager.broadcast('groupe_updated', {'id': groupe_id, 'nom': nom})
    return jsonify({"success": True})

  except ValueError as ve:
    return jsonify({"error": str(ve)}), 400
  except Exception as e:
    logger.error(f"Erreur modification groupe: {str(e)}")
    return jsonify({"error": "Erreur lors de la modification"}), 500


@app.route("/groupe_classes", methods=["GET"])
@login_required
def get_groupe_classes():
  """Récupérer toutes les associations groupe-classe"""
  try:
    cached = _cache.get("groupe_classes")
    if cached is not None:
      return jsonify(cached)
    conn = get_db_read()
    rows = conn.execute("SELECT * FROM groupe_classes ORDER BY groupe_id").fetchall()
    result = [dict(r) for r in rows]
    _cache.set("groupe_classes", result, ttl=60)
    return jsonify(result)
  except Exception as e:
    logger.error(f"Erreur /groupe_classes: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

# ========================
# GESTION DE L'APPEL
# ========================

@app.route("/seances/<int:seance_id>/appel", methods=["GET"])
@role_required('prof', 'admin')
def get_appel_info(seance_id):
  """Récupère les infos pour faire l'appel d'une séance"""
  try:
    conn = get_db_connection()

    seance = conn.execute("""
      SELECT s.*, a.titre, a.salle, a.prof_id, a.animateur_id
      FROM seances s
      JOIN activites a ON s.activite_id = a.id
      WHERE s.id = ?
    """, (seance_id,)).fetchone()

    if not seance:
      _release_db(conn)
      return jsonify({"error": "Séance introuvable"}), 404

    if session["role"] != "admin" and seance["prof_id"] != session["user_id"] and seance["animateur_id"] != session["user_id"]:
      _release_db(conn)
      return jsonify({"error": "Non autorisé"}), 403

    presences = conn.execute("""
      SELECT p.*, u.prenom, u.nom, u.classe_id, c.nom as classe_nom
      FROM presences p
      JOIN users u ON p.eleve_id = u.id
      LEFT JOIN classes c ON u.classe_id = c.id
      WHERE p.seance_id = ?
      ORDER BY u.nom, u.prenom
    """, (seance_id,)).fetchall()

    _release_db(conn)

    return jsonify({
      "seance": dict(seance),
      "presences": [dict(p) for p in presences]
    })

  except Exception as e:
    logger.error(f"Erreur get_appel_info: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/seances/<int:seance_id>/appel", methods=["POST"])
@role_required('prof', 'admin')
def save_appel(seance_id):
  """Enregistre l'appel d'une séance"""
  try:
    data = request.json
    if not data or 'presences' not in data:
      return jsonify({"error": "Données manquantes"}), 400

    presences_data = data['presences']
    if not isinstance(presences_data, list):
      return jsonify({"error": "Format invalide"}), 400

    conn = get_db_connection()
    cur = conn.cursor()

    seance = cur.execute("""
      SELECT a.prof_id, a.animateur_id
      FROM seances s
      JOIN activites a ON s.activite_id = a.id
      WHERE s.id = ?
    """, (seance_id,)).fetchone()

    if not seance:
      _release_db(conn)
      return jsonify({"error": "Séance introuvable"}), 404

    if session["role"] != "admin" and seance["prof_id"] != session["user_id"] and seance["animateur_id"] != session["user_id"]:
      _release_db(conn)
      return jsonify({"error": "Non autorisé"}), 403

    for presence in presences_data:
      eleve_id = validate_integer(presence.get('eleve_id'), min_val=1)
      present = 1 if presence.get('present') else 0
      commentaire = sanitize_string(presence.get('commentaire', ''), 500)

      cur.execute("""
        UPDATE presences
        SET present = ?, commentaire = ?
        WHERE seance_id = ? AND eleve_id = ?
      """, (present, commentaire, seance_id, eleve_id))

    conn.commit()
    _release_db(conn)

    logger.info(f"Appel enregistré pour séance {seance_id} par user {session['user_id']}")
    sse_manager.broadcast('appel_updated', {'seance_id': seance_id})
    return jsonify({"success": True})

  except ValueError as ve:
    return jsonify({"error": str(ve)}), 400
  except Exception as e:
    logger.error(f"Erreur save_appel: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/seances/<int:seance_id>/appel-status", methods=["GET"])
@role_required('prof', 'admin')
def get_appel_status(seance_id):
  """Vérifie si l'appel a été fait pour une séance"""
  try:
    conn = get_db_connection()

    seance = conn.execute("""
      SELECT s.*, a.prof_id, a.animateur_id
      FROM seances s
      JOIN activites a ON s.activite_id = a.id
      WHERE s.id = ?
    """, (seance_id,)).fetchone()

    if not seance:
      _release_db(conn)
      return jsonify({"error": "Séance introuvable"}), 404

    animateur_id = seance["animateur_id"] if seance["animateur_id"] else seance["prof_id"]

    if session["role"] != "admin" and seance["prof_id"] != session["user_id"] and animateur_id != session["user_id"]:
      _release_db(conn)
      return jsonify({"error": "Non autorisé"}), 403

    result = conn.execute("""
      SELECT COUNT(*) as total,
            SUM(CASE WHEN present = 1 THEN 1 ELSE 0 END) as presents
      FROM presences
      WHERE seance_id = ?
    """, (seance_id,)).fetchone()

    _release_db(conn)

    presents = result["presents"] if result and result["presents"] else 0
    appel_fait = presents > 0

    return jsonify({
      "appel_fait": appel_fait,
      "total": result["total"] if result else 0,
      "presents": presents
    })

  except Exception as e:
    logger.error(f"Erreur get_appel_status: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

# ========================
# INVITATIONS PROFESSEURS
# ========================
# send_invitation_email est importée depuis mail_service

@app.route("/admin/invitations", methods=["POST"])
@role_required('admin')
def create_invitation():
  """Crée et envoie une invitation professeur"""
  try:
    data = request.json
    valid, error = validate_basic(data, ['email'])
    if not valid:
      return jsonify({"error": error}), 400

    email = sanitize_string(data.get("email"), 100).lower()

    if '@' not in email or '.' not in email:
      return jsonify({"error": "Format d'email invalide"}), 400

    conn = get_db_connection()

    existing = conn.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone()
    if existing:
      _release_db(conn)
      return jsonify({"error": "Un compte existe déjà avec cet email"}), 400

    existing_token = conn.execute("""
      SELECT 1 FROM invitation_tokens
      WHERE email=? AND used=0 AND datetime(expires_at) > ?
    """, (email, now_local_str())).fetchone()

    if existing_token:
      _release_db(conn)
      return jsonify({"error": "Une invitation est déjà en attente pour cet email"}), 400

    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now() + timedelta(days=7)).isoformat()

    cur = conn.cursor()
    cur.execute("""
      INSERT INTO invitation_tokens (token, email, expires_at, created_by)
      VALUES (?, ?, ?, ?)
    """, (token, email, expires_at, session["user_id"]))

    conn.commit()
    _release_db(conn)

    success, message = send_invitation_email(email, token)

    if not success:
      return jsonify({"error": message}), 500

    logger.info(f"Invitation créée pour {email}")
    return jsonify({"success": True, "message": "Invitation envoyée"})

  except Exception as e:
    logger.error(f"Erreur création invitation : {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/admin/invitations", methods=["GET"])
@role_required('admin')
def list_invitations():
  """Liste toutes les invitations"""
  try:
    conn = get_db_connection()
    invitations = conn.execute("""
      SELECT
        it.*,
        u.prenom || ' ' || u.nom as created_by_name,
        uu.username as used_by_username
      FROM invitation_tokens it
      LEFT JOIN users u ON it.created_by = u.id
      LEFT JOIN users uu ON it.used_by_user_id = uu.id
      ORDER BY it.created_at DESC
    """).fetchall()
    _release_db(conn)

    return jsonify([dict(inv) for inv in invitations])
  except Exception as e:
    logger.error(f"Erreur liste invitations : {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/admin/invitations/<int:invitation_id>", methods=["DELETE"])
@role_required('admin')
def delete_invitation(invitation_id):
  """Supprime une invitation non utilisée"""
  try:
    conn = get_db_connection()
    cur = conn.cursor()

    invitation = cur.execute(
      "SELECT * FROM invitation_tokens WHERE id=? AND used=0",
      (invitation_id,)
    ).fetchone()

    if not invitation:
      _release_db(conn)
      return jsonify({"error": "Invitation introuvable ou déjà utilisée"}), 404

    cur.execute("DELETE FROM invitation_tokens WHERE id=?", (invitation_id,))
    conn.commit()
    _release_db(conn)

    logger.info(f"Invitation {invitation_id} supprimée")
    return jsonify({"success": True})

  except Exception as e:
    logger.error(f"Erreur suppression invitation : {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/api/invitation-info")
def get_invitation_info():
  """Retourne les infos d'une invitation"""
  try:
    token = request.args.get('token')
    if not token:
      return jsonify({"error": "Token manquant"}), 400

    conn = get_db_connection()
    invitation = conn.execute("""
      SELECT email
      FROM invitation_tokens
      WHERE token=? AND used=0 AND datetime(expires_at) > ?
    """, (token, now_local_str())).fetchone()
    _release_db(conn)

    if not invitation:
      return jsonify({"error": "Token invalide ou expiré"}), 404

    return jsonify(dict(invitation))

  except Exception as e:
    logger.error(f"Erreur info invitation : {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/inscription")
def signup_form():
  """Affiche le formulaire d'inscription"""
  token = request.args.get('token')

  if not token:
    return "Token manquant", 400

  conn = get_db_connection()
  invitation = conn.execute("""
    SELECT * FROM invitation_tokens
    WHERE token=? AND used=0 AND datetime(expires_at) > ?
  """, (token, now_local_str())).fetchone()
  _release_db(conn)

  if not invitation:
    return """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Lien expiré</title>
<style>body{font-family:Arial;text-align:center;padding:50px}h1{color:#dd1738}</style>
</head><body>
<h1>❌ Lien d'invitation expiré ou invalide</h1>
<p>Ce lien a expiré ou a déjà été utilisé.</p>
<p>Contactez l'administrateur pour obtenir une nouvelle invitation.</p>
</body></html>""", 404

  return send_from_directory("prof_signup", "prof_signup.html")

@app.route("/inscription", methods=["POST"])
def process_signup():
  try:
    data = request.json

    required_fields = ['token', 'username', 'prenom', 'nom', 'matiere', 'password']
    valid, error = validate_basic(data, required_fields)
    if not valid:
      return jsonify({"error": error}), 400

    token = safe_string(data.get("token"), max_length=200)

    # Validation username avec règles strictes
    username_valid, username_error = InputValidator.validate_username(data.get("username"))
    if not username_valid:
      return jsonify({"error": username_error}), 400
    username = data.get("username").strip()

    prenom = safe_string(data.get("prenom"), max_length=50)
    nom = safe_string(data.get("nom"), max_length=50)
    matiere = safe_string(data.get("matiere"), max_length=100)
    password = data.get("password")

    # Validation password
    if len(password) < 8:
      return jsonify({"error": "Mot de passe trop court (min 8 caractères)"}), 400
    if len(password) > 200:
      return jsonify({"error": "Mot de passe trop long"}), 400

    classe_id = data.get("classe_id")

    conn = get_db_connection()
    cur = conn.cursor()

    # Vérification token avec requête préparée
    invitation = cur.execute("""
      SELECT * FROM invitation_tokens
      WHERE token=? AND used=0 AND datetime(expires_at) > ?
    """, (token, now_local_str())).fetchone()

    if not invitation:
      _release_db(conn)
      return jsonify({"error": "Token invalide ou expiré"}), 400

    # Vérification username unique
    existing = cur.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone()
    if existing:
      _release_db(conn)
      return jsonify({"error": "Ce nom d'utilisateur existe déjà"}), 400

    # Vérification email unique
    existing_email = cur.execute("SELECT 1 FROM users WHERE email=?", (invitation["email"],)).fetchone()
    if existing_email:
      _release_db(conn)
      return jsonify({"error": "Un compte existe déjà avec cet email"}), 400

    # Validation classe_id si fournie
    if classe_id:
      classe_id = safe_int(classe_id, min_val=1)
      classe_exists = cur.execute("SELECT 1 FROM classes WHERE id=?", (classe_id,)).fetchone()
      if not classe_exists:
        _release_db(conn)
        return jsonify({"error": "Classe invalide"}), 400
    else:
      classe_id = None

    password_hash = generate_password_hash(password)

    # Insertion avec requêtes préparées
    cur.execute("""
      INSERT INTO users (prenom, nom, username, password_hash, role, email, classe_id)
      VALUES (?, ?, ?, ?, 'prof', ?, ?)
    """, (prenom, nom, username, password_hash, invitation["email"], classe_id))

    user_id = cur.lastrowid

    cur.execute("""
      INSERT INTO professeurs (id, matiere)
      VALUES (?, ?)
    """, (user_id, matiere))

    cur.execute("""
      UPDATE invitation_tokens
      SET used=1, used_at=?, used_by_user_id=?,
        prenom=?, nom=?
      WHERE token=?
    """, (now_local_str(), user_id, prenom, nom, token))

    conn.commit()
    _release_db(conn)

    logger.info(f"Nouveau professeur inscrit : {username} ({prenom} {nom}) - Matière: {matiere}")
    return jsonify({"success": True, "message": "Compte créé avec succès"})

  except ValidationError as ve:
    logger.error(f"Erreur validation inscription: {str(ve)}")
    return jsonify({"error": str(ve)}), 400
  except Exception as e:
    logger.error(f"Erreur inscription : {str(e)}")
    return jsonify({"error": "Erreur lors de l'inscription"}), 500

# ========================
# PREMIÈRE CONNEXION ÉLÈVE
# ========================

@app.route("/first-login")
def first_login_page():
  """Affiche la page de première connexion."""
  return send_from_directory("first_login", "first_login.html")

@app.route("/api/first-login/send-code", methods=["POST"])
def first_login_send_code():
  """
  Étape 1 : l'élève soumet son username.
  On vérifie que c'est bien une première connexion, on génère le code et on l'envoie.
  """
  try:
    data = request.json or {}
    user_id = data.get("user_id")
    if not user_id:
      return jsonify({"error": "user_id requis"}), 400

    try:
      user_id = int(user_id)
    except (TypeError, ValueError):
      return jsonify({"error": "user_id invalide"}), 400

    # Vérifier session temporaire first_login
    if session.get("pending_first_login_user_id") != user_id:
      return jsonify({"error": "Session invalide"}), 403

    conn = get_db_connection()
    user = conn.execute(
      "SELECT id, email, prenom, role FROM users WHERE id=?", (user_id,)
    ).fetchone()
    _release_db(conn)

    if not user or user["role"] != "eleve":
      return jsonify({"error": "Utilisateur invalide"}), 400

    if not PasswordResetManager.is_first_login(user_id):
      return jsonify({"error": "Pas de première connexion en attente"}), 400

    ok, code = PasswordResetManager.create_first_login_code(user_id, ip_address=request.remote_addr)
    if not ok:
      return jsonify({"error": code}), 500

    _send_first_login_code_email(user["email"], user["prenom"], code)
    logger.info(f"Code first_login (re)envoyé pour user_id={user_id}")
    return jsonify({"success": True, "message": "Code envoyé par email"})

  except Exception as e:
    logger.error(f"Erreur first_login send_code: {e}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/api/first-login/verify", methods=["POST"])
def first_login_verify():
  """
  Étape 2 : l'élève soumet le code + nouveau mot de passe.
  On valide le code, on met à jour le mot de passe.
  """
  try:
    data = request.json or {}
    user_id     = data.get("user_id")
    code        = str(data.get("code", "")).strip()
    new_password = data.get("password", "")
    confirm_pwd  = data.get("confirm_password", "")

    if not user_id or not code:
      return jsonify({"error": "Données manquantes"}), 400

    try:
      user_id = int(user_id)
    except (TypeError, ValueError):
      return jsonify({"error": "user_id invalide"}), 400

    # Vérifier session temporaire
    if session.get("pending_first_login_user_id") != user_id:
      return jsonify({"error": "Session invalide"}), 403

    if len(new_password) < 8:
      return jsonify({"error": "Mot de passe trop court (min 8 caractères)"}), 400
    if len(new_password) > 200:
      return jsonify({"error": "Mot de passe trop long"}), 400
    if new_password != confirm_pwd:
      return jsonify({"error": "Les mots de passe ne correspondent pas"}), 400

    result = PasswordResetManager.validate_code(user_id, code, "first_login")
    if not result:
      return jsonify({"error": "Code invalide ou expiré"}), 400

    # Mettre à jour le mot de passe
    password_hash = generate_password_hash(new_password)
    conn = get_db_connection()
    cur  = conn.cursor()
    cur.execute("UPDATE users SET password_hash=? WHERE id=?", (password_hash, user_id))
    conn.commit()

    # Récupérer les infos pour la session
    user = conn.execute(
      "SELECT id, role, prenom, nom, classe_id FROM users WHERE id=?", (user_id,)
    ).fetchone()
    _release_db(conn)

    # Invalider le code
    PasswordResetManager.mark_code_used(user_id, "first_login", ip_address=request.remote_addr)

    # Ouvrir la session normale
    session.pop("pending_first_login_user_id", None)
    session["user_id"]       = user["id"]
    session["role"]          = user["role"]
    session["classe_id"]     = user["classe_id"]
    session["last_activity"] = datetime.now().timestamp()

    logger.info(f"Première connexion validée pour user_id={user_id}")
    return jsonify({
      "success": True,
      "id":       user["id"],
      "role":     user["role"],
      "prenom":   user["prenom"],
      "nom":      user["nom"],
      "classe_id": user["classe_id"]
    })

  except Exception as e:
    logger.error(f"Erreur first_login verify: {e}")
    return jsonify({"error": "Erreur serveur"}), 500


# ========================
# MOT DE PASSE OUBLIÉ
# ========================

@app.route("/forgot-password")
def forgot_password_page():
  """Affiche la page mot de passe oublié."""
  return send_from_directory("forgot_password", "forgot_password.html")

@app.route("/api/forgot-password/request", methods=["POST"])
def forgot_password_request():
  """
  Etape 1 : username OU email acceptes.
  Cherche le compte dans les deux champs, envoie le code au mail associe.
  Reponse toujours generique pour ne pas reveler si le compte existe.
  """
  try:
    data       = request.json or {}
    identifier = data.get("identifier", "").strip()

    if not identifier:
      return jsonify({"error": "Identifiant requis"}), 400
    if len(identifier) > 150:
      return jsonify({"error": "Identifiant trop long"}), 400

    # Chercher par username d'abord, puis par email
    user = PasswordResetManager.get_user_by_username(identifier)
    if not user:
      user = PasswordResetManager.get_user_by_email(identifier.lower())

    generic = {"success": True, "message": "Si ce compte existe, un code a ete envoye."}

    if not user or not user.get("email"):
      logger.warning(f"Tentative reset identifiant inconnu: {identifier}")
      return jsonify(generic)

    ok, code = PasswordResetManager.create_password_reset_code(
      user["id"], ip_address=request.remote_addr
    )
    if not ok:
      return jsonify(generic)

    _send_reset_code_email(user["email"], user["prenom"], code)

    session["pending_reset_user_id"] = user["id"]
    logger.info(f"Code reset envoye pour identifier={identifier}")
    return jsonify(generic)

  except Exception as e:
    logger.error(f"Erreur forgot_password request: {e}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/api/forgot-password/verify", methods=["POST"])
def forgot_password_verify():
  """
  Etape 2 : code 6 chiffres + nouveau mot de passe.
  user_id recupere depuis session["pending_reset_user_id"].
  """
  try:
    data         = request.json or {}
    code         = str(data.get("code", "")).strip()
    new_password = data.get("password", "")
    confirm_pwd  = data.get("confirm_password", "")

    user_id = session.get("pending_reset_user_id")
    if not user_id:
      return jsonify({"error": "Session expiree. Recommencez depuis le debut."}), 400

    if not code:
      return jsonify({"error": "Code requis"}), 400

    if len(new_password) < 8:
      return jsonify({"error": "Mot de passe trop court (min 8 caracteres)"}), 400
    if len(new_password) > 200:
      return jsonify({"error": "Mot de passe trop long"}), 400
    if new_password != confirm_pwd:
      return jsonify({"error": "Les mots de passe ne correspondent pas"}), 400

    result = PasswordResetManager.validate_code(user_id, code, "password_reset")
    if not result:
      return jsonify({"error": "Code invalide ou expire"}), 400

    password_hash = generate_password_hash(new_password)
    conn = get_db_connection()
    conn.execute("UPDATE users SET password_hash=? WHERE id=?", (password_hash, user_id))
    conn.commit()
    _release_db(conn)

    PasswordResetManager.mark_code_used(user_id, "password_reset", ip_address=request.remote_addr)
    session.pop("pending_reset_user_id", None)

    logger.info(f"Mot de passe reinitialise pour user_id={user_id}")
    return jsonify({"success": True, "message": "Mot de passe reinitialise avec succes."})

  except Exception as e:
    logger.error(f"Erreur forgot_password verify: {e}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/")
def index():
  return send_from_directory(".", "Concorde.html")

# ========================
# SERVIR LE FRONT
# ========================
@app.route("/<path:filename>")
def serve_static(filename):
  # Liste blanche des fichiers autorisés pour la sécurité
  # Fichiers servis depuis la racine
  root_files = {
    "styles.css", "script.js",
    "Input_Comp.css", "Input_Comp.js",
  }
  # Fichiers servis depuis leur sous-dossier
  subdir_files = {
    "forgot_password/forgot_password.css":  ("forgot_password", "forgot_password.css"),
    "forgot_password/forgot_password.js":   ("forgot_password", "forgot_password.js"),
    "first_login/first_login.css":          ("first_login",     "first_login.css"),
    "first_login/first_login.js":           ("first_login",     "first_login.js"),
    "reset_password/reset_password.css":    ("reset_password",  "reset_password.css"),
    "reset_password/reset_password.js":     ("reset_password",  "reset_password.js"),
    "prof_signup/prof_signup.css":          ("prof_signup",     "prof_signup.css"),
    "prof_signup/prof_signup.js":           ("prof_signup",     "prof_signup.js"),
  }

  if filename in root_files:
    return send_from_directory(".", filename)
  if filename in subdir_files:
    folder, fname = subdir_files[filename]
    return send_from_directory(folder, fname)
  else:
    return "File not found", 404


# ============================================================
# ÉCHANGES
# ============================================================

@app.route("/echanges/voeux/<int:groupe_id>", methods=["GET"])
@login_required
def get_voeux(groupe_id):
  """Tous les vœux actifs d'un groupe (vue élève)."""
  try:
    conn = get_db_connection()
    cur  = conn.cursor()

    groupe = cur.execute("SELECT * FROM groupes_exclusivite WHERE id=?", (groupe_id,)).fetchone()
    if not groupe or not groupe["echanges_actifs"]:
      _release_db(conn)
      return jsonify({"error": "Groupe introuvable ou échanges désactivés"}), 404

    rows = cur.execute("""
      SELECT v.id, v.eleve_id, v.activite_actuelle_id, v.activite_cible_id,
             v.statut, v.created_at AS date_creation,
             u.prenom, u.nom, u.classe_id,
             c.nom     AS classe_nom,
             ao.titre  AS activite_actuelle_titre,
             ac2.titre AS activite_cible_titre
      FROM voeux_echange v
      JOIN users u   ON u.id   = v.eleve_id
      LEFT JOIN classes c   ON c.id  = u.classe_id
      JOIN activites ao     ON ao.id = v.activite_actuelle_id
      JOIN activites ac2    ON ac2.id = v.activite_cible_id
      WHERE v.groupe_id = ? AND v.statut IN ('actif', 'en_procedure')
      ORDER BY v.created_at DESC
    """, (groupe_id,)).fetchall()

    _release_db(conn)
    return jsonify([dict(r) for r in rows])
  except Exception as e:
    logger.error(f"Erreur get_voeux: {e}")
    return jsonify({"error": "Erreur serveur"}), 500


@app.route("/echanges/voeux", methods=["POST"])
@login_required
def create_voeu():
  """Formuler un vœu d'échange."""
  try:
    data = request.json
    eleve_id   = session["user_id"]
    groupe_id  = safe_int(data.get("groupe_id"), min_val=1)
    cible_id   = safe_int(data.get("activite_cible_id"), min_val=1)

    conn = get_db_connection()
    cur  = conn.cursor()

    groupe = cur.execute("SELECT * FROM groupes_exclusivite WHERE id=?", (groupe_id,)).fetchone()
    if not groupe or not groupe["echanges_actifs"]:
      _release_db(conn)
      return jsonify({"error": "Échanges non autorisés pour ce groupe"}), 400

    # Trouver l'activité actuelle de l'élève dans ce groupe (via presences, source de vérité)
    actuelle = cur.execute("""
      SELECT DISTINCT a.id FROM presences p
      JOIN seances s ON s.id = p.seance_id
      JOIN activites a ON a.id = s.activite_id
      WHERE p.eleve_id = ? AND a.groupe_id = ?
      LIMIT 1
    """, (eleve_id, groupe_id)).fetchone()

    if not actuelle:
      _release_db(conn)
      return jsonify({"error": "Vous n'êtes pas inscrit dans ce groupe"}), 400

    actuelle_id = actuelle["id"]

    # L'activité cible doit appartenir au groupe et être différente de l'actuelle
    cible = cur.execute(
      "SELECT 1 FROM activites WHERE id=? AND groupe_id=? AND id!=?",
      (cible_id, groupe_id, actuelle_id)
    ).fetchone()
    if not cible:
      _release_db(conn)
      return jsonify({"error": "Activité cible invalide ou identique à votre activité actuelle"}), 400

    # L'élève n'est pas déjà inscrit à la cible
    deja = cur.execute("""
      SELECT 1 FROM presences p
      JOIN seances s ON s.id = p.seance_id
      WHERE p.eleve_id = ? AND s.activite_id = ?
      LIMIT 1
    """, (eleve_id, cible_id)).fetchone()
    if deja:
      _release_db(conn)
      return jsonify({"error": "Vous êtes déjà inscrit à cette activité"}), 400

    try:
      cur.execute("""
        INSERT INTO voeux_echange
          (eleve_id, groupe_id, activite_actuelle_id, activite_cible_id, statut, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'actif', datetime('now'), datetime('now'))
      """, (eleve_id, groupe_id, actuelle_id, cible_id))
      conn.commit()
    except sqlite3.IntegrityError:
      _release_db(conn)
      return jsonify({"error": "Vous avez déjà un vœu actif dans ce groupe. Retirez-le d'abord."}), 400

    voeu_id = cur.lastrowid
    _release_db(conn)
    sse_manager.broadcast("echanges_update", {"groupe_id": groupe_id})
    return jsonify({"success": True, "id": voeu_id})
  except Exception as e:
    logger.error(f"Erreur create_voeu: {e}")
    return jsonify({"error": "Erreur serveur"}), 500


@app.route("/echanges/voeux/<int:voeu_id>", methods=["DELETE"])
@login_required
def delete_voeu(voeu_id):
  """Retirer un vœu."""
  try:
    eleve_id = session["user_id"]
    conn = get_db_connection()
    cur  = conn.cursor()

    voeu = cur.execute("SELECT * FROM voeux_echange WHERE id=?", (voeu_id,)).fetchone()
    if not voeu:
      _release_db(conn)
      return jsonify({"error": "Vœu introuvable"}), 404
    if voeu["eleve_id"] != eleve_id and session.get("role") not in ("prof","admin"):
      _release_db(conn)
      return jsonify({"error": "Non autorisé"}), 403

    groupe_id = voeu["groupe_id"]
    # Annuler les procédures en cours liées à ce vœu
    cur.execute("""
      UPDATE procedures_echange SET statut='annule'
      WHERE (voeu_a_id=? OR voeu_b_id=?) AND statut NOT IN ('valide','annule')
    """, (voeu_id, voeu_id))
    cur.execute("DELETE FROM voeux_echange WHERE id=?", (voeu_id,))
    conn.commit()
    _release_db(conn)
    sse_manager.broadcast("echanges_update", {"groupe_id": groupe_id})
    return jsonify({"success": True})
  except Exception as e:
    logger.error(f"Erreur delete_voeu: {e}")
    return jsonify({"error": "Erreur serveur"}), 500


@app.route("/echanges/procedures", methods=["POST"])
@login_required
def create_procedure():
  """Initier une procédure d'échange (élève A propose à élève B)."""
  try:
    data      = request.json
    init_id   = session["user_id"]
    voeu_a_id = safe_int(data.get("voeu_a_id"), min_val=1)
    voeu_b_id = safe_int(data.get("voeu_b_id"), min_val=1)

    conn = get_db_connection()
    cur  = conn.cursor()

    va = cur.execute("SELECT * FROM voeux_echange WHERE id=? AND statut='actif'", (voeu_a_id,)).fetchone()
    vb = cur.execute("SELECT * FROM voeux_echange WHERE id=? AND statut='actif'", (voeu_b_id,)).fetchone()
    if not va or not vb:
      _release_db(conn)
      return jsonify({"error": "Vœu(x) introuvable(s) ou inactif(s)"}), 400

    # Vérifier compatibilité : A veut aller là où B est, B veut aller là où A est
    act_a = cur.execute("""
      SELECT a.id FROM inscriptions i JOIN activites a ON a.id=i.activite_id
      WHERE i.eleve_id=? AND a.groupe_id=?
    """, (va["eleve_id"], va["groupe_id"])).fetchone()
    act_b = cur.execute("""
      SELECT a.id FROM inscriptions i JOIN activites a ON a.id=i.activite_id
      WHERE i.eleve_id=? AND a.groupe_id=?
    """, (vb["eleve_id"], vb["groupe_id"])).fetchone()

    if not act_a or not act_b:
      _release_db(conn)
      return jsonify({"error": "Inscriptions introuvables"}), 400
    if va["activite_cible_id"] != act_b["id"] or vb["activite_cible_id"] != act_a["id"]:
      _release_db(conn)
      return jsonify({"error": "Les vœux ne sont pas compatibles"}), 400

    # Pas déjà une procédure active entre ces deux vœux
    existing = cur.execute("""
      SELECT 1 FROM procedures_echange
      WHERE voeu_a_id IN (?,?) AND voeu_b_id IN (?,?)
      AND statut NOT IN ('annule')
    """, (voeu_a_id, voeu_b_id, voeu_a_id, voeu_b_id)).fetchone()
    if existing:
      _release_db(conn)
      return jsonify({"error": "Une procédure est déjà en cours"}), 400

    cur.execute("""
      INSERT INTO procedures_echange (voeu_a_id, voeu_b_id, statut, created_at)
      VALUES (?, ?, 'en_attente', datetime('now'))
    """, (voeu_a_id, voeu_b_id))
    proc_id = cur.lastrowid
    # Marquer les vœux en_procedure
    cur.execute("UPDATE voeux_echange SET statut='en_procedure' WHERE id IN (?,?)", (voeu_a_id, voeu_b_id))
    conn.commit()
    _release_db(conn)
    sse_manager.broadcast("echanges_update", {"groupe_id": va["groupe_id"]})
    return jsonify({"success": True, "id": proc_id})
  except Exception as e:
    logger.error(f"Erreur create_procedure: {e}")
    return jsonify({"error": "Erreur serveur"}), 500


@app.route("/echanges/procedures/<int:proc_id>/repondre", methods=["POST"])
@login_required
def repondre_procedure(proc_id):
  """Élève B accepte ou refuse."""
  try:
    data    = request.json
    user_id = session["user_id"]
    action  = data.get("action")  # 'accepter' | 'refuser'

    conn = get_db_connection()
    cur  = conn.cursor()

    proc = cur.execute("SELECT * FROM procedures_echange WHERE id=?", (proc_id,)).fetchone()
    if not proc or proc["statut"] != "en_attente":
      _release_db(conn)
      return jsonify({"error": "Procédure introuvable ou déjà traitée"}), 404

    va = cur.execute("SELECT * FROM voeux_echange WHERE id=?", (proc["voeu_a_id"],)).fetchone()
    vb = cur.execute("SELECT * FROM voeux_echange WHERE id=?", (proc["voeu_b_id"],)).fetchone()

    # Vérifier que c'est bien l'un des deux élèves qui répond
    if user_id not in (va["eleve_id"], vb["eleve_id"]):
      if session.get("role") not in ("prof","admin"):
        _release_db(conn)
        return jsonify({"error": "Non autorisé"}), 403

    groupe_id = va["groupe_id"]

    if action == "refuser":
      cur.execute("UPDATE procedures_echange SET statut='annule' WHERE id=?", (proc_id,))
      cur.execute("UPDATE voeux_echange SET statut='actif' WHERE id IN (?,?)", (va["id"], vb["id"]))
      conn.commit()
      _release_db(conn)
      sse_manager.broadcast("echanges_update", {"groupe_id": groupe_id})
      return jsonify({"success": True, "statut": "annule"})

    if action == "accepter":
      cur.execute("UPDATE procedures_echange SET statut='accord_b', date_accord_b=? WHERE id=?",
                  (now_local_str(), proc_id))

      if not VALIDATION_PROF_ECHANGES:
        _executer_echange(cur, proc, va, vb)
        cur.execute("UPDATE procedures_echange SET statut='valide', date_validation=? WHERE id=?",
                    (now_local_str(), proc_id))
        conn.commit()
        _release_db(conn)
        sse_manager.broadcast("echanges_update", {"groupe_id": groupe_id})
        return jsonify({"success": True, "statut": "valide"})
      else:
        cur.execute("UPDATE procedures_echange SET statut='accord_b', date_accord_b=? WHERE id=?",
                    (now_local_str(), proc_id))
        conn.commit()
        _release_db(conn)
        sse_manager.broadcast("echanges_update", {"groupe_id": groupe_id})
        return jsonify({"success": True, "statut": "accord_b"})

    _release_db(conn)
    return jsonify({"error": "Action invalide"}), 400
  except Exception as e:
    logger.error(f"Erreur repondre_procedure: {e}")
    return jsonify({"error": "Erreur serveur"}), 500


@app.route("/echanges/procedures/<int:proc_id>/valider", methods=["POST"])
@role_required("prof", "admin")
def valider_procedure(proc_id):
  """Prof valide l'échange (si VALIDATION_PROF_ECHANGES=True)."""
  try:
    conn = get_db_connection()
    cur  = conn.cursor()

    proc = cur.execute("SELECT * FROM procedures_echange WHERE id=?", (proc_id,)).fetchone()
    if not proc or proc["statut"] not in ("accord_b", "en_attente"):
      _release_db(conn)
      return jsonify({"error": "Procédure introuvable ou déjà traitée"}), 404

    va = cur.execute("SELECT * FROM voeux_echange WHERE id=?", (proc["voeu_a_id"],)).fetchone()
    vb = cur.execute("SELECT * FROM voeux_echange WHERE id=?", (proc["voeu_b_id"],)).fetchone()

    _executer_echange(cur, proc, va, vb)
    cur.execute("UPDATE procedures_echange SET statut='valide', date_validation=? WHERE id=?",
                (now_local_str(), proc_id))
    conn.commit()
    groupe_id = va["groupe_id"]
    _release_db(conn)
    sse_manager.broadcast("echanges_update", {"groupe_id": groupe_id})
    sse_manager.broadcast("data_update", {})
    return jsonify({"success": True})
  except Exception as e:
    logger.error(f"Erreur valider_procedure: {e}")
    return jsonify({"error": "Erreur serveur"}), 500


@app.route("/echanges/procedures/<int:proc_id>/annuler", methods=["POST"])
@login_required
def annuler_procedure(proc_id):
  """Désistement d'un des deux élèves (ou refus prof)."""
  try:
    user_id = session["user_id"]
    conn    = get_db_connection()
    cur     = conn.cursor()

    proc = cur.execute("SELECT * FROM procedures_echange WHERE id=?", (proc_id,)).fetchone()
    if not proc or proc["statut"] in ("valide","annule"):
      _release_db(conn)
      return jsonify({"error": "Procédure introuvable ou déjà terminée"}), 404

    va = cur.execute("SELECT * FROM voeux_echange WHERE id=?", (proc["voeu_a_id"],)).fetchone()
    vb = cur.execute("SELECT * FROM voeux_echange WHERE id=?", (proc["voeu_b_id"],)).fetchone()

    if user_id not in (va["eleve_id"], vb["eleve_id"]) and session.get("role") not in ("prof","admin"):
      _release_db(conn)
      return jsonify({"error": "Non autorisé"}), 403

    cur.execute("UPDATE procedures_echange SET statut='annule' WHERE id=?", (proc_id,))
    # Le vœu de l'autre reste actif (spec)
    cur.execute("UPDATE voeux_echange SET statut='actif' WHERE id IN (?,?)", (va["id"], vb["id"]))
    conn.commit()
    groupe_id = va["groupe_id"]
    _release_db(conn)
    sse_manager.broadcast("echanges_update", {"groupe_id": groupe_id})
    return jsonify({"success": True})
  except Exception as e:
    logger.error(f"Erreur annuler_procedure: {e}")
    return jsonify({"error": "Erreur serveur"}), 500


@app.route("/echanges/procedures/pending", methods=["GET"])
@role_required("prof", "admin")
def get_pending_procedures():
  """Liste des procédures en attente de validation prof.
  - Admin : voit TOUTES les procédures actives (en_attente + accord_b)
  - Prof  : voit seulement les accord_b (prêtes à valider)
  """
  try:
    is_admin = session.get("role") == "admin"
    statut_filter = "p.statut IN ('en_attente','accord_b')" if is_admin else "p.statut = 'accord_b'"

    conn = get_db_read()
    rows = conn.execute(f"""
      SELECT
        p.id, p.statut, p.created_at AS date_init, p.date_accord_b,
        va.eleve_id AS eleve_a_id, vb.eleve_id AS eleve_b_id,
        ua.prenom AS prenom_a, ua.nom AS nom_a,
        ub.prenom AS prenom_b, ub.nom AS nom_b,
        act_a.titre  AS titre_a,      act_b.titre  AS titre_b,
        act_ac.titre AS titre_cible_a, act_bc.titre AS titre_cible_b,
        ge.nom AS groupe_nom, ge.id AS groupe_id
      FROM procedures_echange p
      JOIN voeux_echange va   ON va.id = p.voeu_a_id
      JOIN voeux_echange vb   ON vb.id = p.voeu_b_id
      JOIN users ua           ON ua.id = va.eleve_id
      JOIN users ub           ON ub.id = vb.eleve_id
      JOIN activites act_a    ON act_a.id  = va.activite_actuelle_id
      JOIN activites act_b    ON act_b.id  = vb.activite_actuelle_id
      JOIN activites act_ac   ON act_ac.id = va.activite_cible_id
      JOIN activites act_bc   ON act_bc.id = vb.activite_cible_id
      JOIN groupes_exclusivite ge ON ge.id = va.groupe_id
      WHERE {statut_filter}
      ORDER BY p.created_at ASC
    """).fetchall()
    return jsonify([dict(r) for r in rows])
  except Exception as e:
    logger.error(f"Erreur get_pending_procedures: {e}")
    return jsonify({"error": "Erreur serveur"}), 500


def _executer_echange(cur, proc, va, vb):
  """Permute les inscriptions et présences entre les deux élèves."""
  eleve_a   = va["eleve_id"]
  eleve_b   = vb["eleve_id"]
  act_a     = va["activite_actuelle_id"]   # activité actuelle de A (stockée dans le vœu)
  act_b     = vb["activite_actuelle_id"]   # activité actuelle de B

  # Supprimer anciennes inscriptions
  cur.execute("DELETE FROM inscriptions WHERE eleve_id=? AND activite_id=?", (eleve_a, act_a))
  cur.execute("DELETE FROM inscriptions WHERE eleve_id=? AND activite_id=?", (eleve_b, act_b))

  # Supprimer anciennes présences
  cur.execute("""
    DELETE FROM presences WHERE eleve_id=?
    AND seance_id IN (SELECT id FROM seances WHERE activite_id=?)
  """, (eleve_a, act_a))
  cur.execute("""
    DELETE FROM presences WHERE eleve_id=?
    AND seance_id IN (SELECT id FROM seances WHERE activite_id=?)
  """, (eleve_b, act_b))

  now = now_local_str()

  # Nouvelles inscriptions (permutées)
  cur.execute("INSERT OR IGNORE INTO inscriptions (eleve_id, activite_id, date_inscription) VALUES (?,?,?)",
              (eleve_a, act_b, now))
  cur.execute("INSERT OR IGNORE INTO inscriptions (eleve_id, activite_id, date_inscription) VALUES (?,?,?)",
              (eleve_b, act_a, now))

  # Nouvelles présences
  seances_b = cur.execute("SELECT id FROM seances WHERE activite_id=?", (act_b,)).fetchall()
  for s in seances_b:
    cur.execute("INSERT OR IGNORE INTO presences (seance_id, eleve_id, present, commentaire) VALUES (?,?,0,'')",
                (s["id"], eleve_a))

  seances_a = cur.execute("SELECT id FROM seances WHERE activite_id=?", (act_a,)).fetchall()
  for s in seances_a:
    cur.execute("INSERT OR IGNORE INTO presences (seance_id, eleve_id, present, commentaire) VALUES (?,?,0,'')",
                (s["id"], eleve_b))

  # Marquer les vœux comme réalisés + annuler les autres vœux liés
  cur.execute("UPDATE voeux_echange SET statut='realise' WHERE id IN (?,?)", (va["id"], vb["id"]))
  cur.execute("""
    UPDATE voeux_echange SET statut='annule'
    WHERE eleve_id IN (?,?) AND groupe_id=? AND statut IN ('actif','en_procedure')
    AND id NOT IN (?,?)
  """, (eleve_a, eleve_b, va["groupe_id"], va["id"], vb["id"]))


# ========================
# GESTION ERREURS
# ========================
@app.errorhandler(404)
def not_found(error):
  logger.warning(f"404 - {request.url} depuis {request.remote_addr}")
  return jsonify({"error": "Ressource non trouvée"}), 404

@app.errorhandler(500)
def internal_error(error):
  logger.error(f"500 - Erreur serveur: {error}")
  return jsonify({"error": "Erreur serveur interne"}), 500

if __name__ == "__main__":
  init_db()
  _write_pool = WritePool(size=5)
  logger.info("Démarrage de l'application")
  app.run(
    debug=False,
    host='0.0.0.0',
    port=5000,
    threaded=True
  )