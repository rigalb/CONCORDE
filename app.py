#!/usr/bin/python3
# -*- coding: utf-8 -*-

from flask import Flask, request, session, jsonify, send_from_directory
import sqlite3
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta
import secrets
import functools
import os
import logging

app = Flask(__name__)

# ========================
# CONFIGURATION SÉCURISÉE
# ========================
app.config.update(
  SECRET_KEY=os.environ.get('SECRET_KEY', secrets.token_hex(32)),
  SESSION_COOKIE_HTTPONLY=True,
  SESSION_COOKIE_SAMESITE='Lax',
  PERMANENT_SESSION_LIFETIME=timedelta(hours=8)
)

DB = "essaie.db"

# Configuration logging sécurisé
logging.basicConfig(
  level=logging.INFO,
  format='%(asctime)s - %(levelname)s - %(message)s',
  handlers=[
    logging.FileHandler('security.log'),
    logging.StreamHandler()
  ]
)
logger = logging.getLogger(__name__)

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
# UTILITAIRES DE SÉCURITÉ
# ========================
def get_db_connection():
  conn = sqlite3.connect(DB)
  conn.row_factory = sqlite3.Row
  return conn

def validate_basic(data, required_fields):
  """Validation sécurisée des données"""
  if not data:
    return False, "Données manquantes"

  for field in required_fields:
    if field not in data or not str(data[field]).strip():
      return False, f"Champ requis: {field}"

    # Validation longueur
    if isinstance(data[field], str) and len(data[field]) > 255:
      return False, f"Champ trop long: {field}"

  return True, None

def sanitize_string(value, max_length=255):
  """Nettoie une chaîne de caractères"""
  if not isinstance(value, str):
    return str(value)[:max_length]
  return value.strip()[:max_length]

def validate_integer(value, min_val=None, max_val=None):
  """Valide un entier avec limites"""
  try:
    int_val = int(value)
    if min_val is not None and int_val < min_val:
      raise ValueError(f"Valeur minimale: {min_val}")
    if max_val is not None and int_val > max_val:
      raise ValueError(f"Valeur maximale: {max_val}")
    return int_val
  except (ValueError, TypeError):
    raise ValueError("Valeur entière requise")

# ========================
# AUTHENTIFICATION
# ========================
@app.route("/login", methods=["POST"])
def login():
  try:
    data = request.json
    valid, error = validate_basic(data, ['username', 'password'])
    if not valid:
      return jsonify({"error": error}), 400

    username = sanitize_string(data.get("username"), 50)
    password = data.get("password")

    if len(password) > 200:  # Limite raisonnable
      return jsonify({"error": "Mot de passe trop long"}), 400

    conn = get_db_connection()
    user = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    conn.close()

    if user and check_password_hash(user["password_hash"], password):
      session["user_id"] = user["id"]
      session["role"] = user["role"]
      session["classe_id"] = user["classe_id"]
      session['last_activity'] = datetime.now().timestamp()

      logger.info(f"Connexion réussie: {username} (ID: {user['id']}) depuis {request.remote_addr}")

      return jsonify({
        "success": True,
        "id": user["id"],
        "role": user["role"],
        "prenom": user["prenom"],
        "nom": user["nom"],
        "classe_id": user["classe_id"]
      })

    logger.warning(f"Tentative de connexion échouée: {username} depuis {request.remote_addr}")
    return jsonify({"success": False, "error": "Identifiants incorrects"}), 401

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
  try:
    conn = get_db_connection()
    user = conn.execute("SELECT id, prenom, nom, role, classe_id FROM users WHERE id=?",
                        (session["user_id"],)).fetchone()
    conn.close()

    if not user:
      return jsonify({"error": "Utilisateur introuvable"}), 404

    return jsonify(dict(user))
  except Exception as e:
    logger.error(f"Erreur /me: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

# ========================
# DONNÉES DE BASE
# ========================
@app.route("/classes")
@login_required
def get_classes():
  try:
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM classes ORDER BY nom").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])
  except Exception as e:
    logger.error(f"Erreur /classes: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/users")
@role_required('prof', 'admin')
def get_users():
  try:
    conn = get_db_connection()
    # Ne jamais retourner les mots de passe
    rows = conn.execute("SELECT id, prenom, nom, role, classe_id FROM users ORDER BY role, nom").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])
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

    conn = get_db_connection()

    if role == "eleve":
      if not classe_id:
        conn.close()
        return jsonify({"error": "Classe non définie"}), 400

      # Élèves : seulement les activités de leur classe
      rows = conn.execute("""
        SELECT DISTINCT a.id, a.titre, a.description, a.prof_id, a.salle, a.separable,
              a.effectif_max, a.date_ouverture_inscriptions, a.date_fermeture_inscriptions,
              COALESCE(a.animateur_id, a.prof_id) as animateur_id,
              COALESCE(a.visible_avant, 0) as visible_avant, a.groupe_id
        FROM activites a
        JOIN activite_classes ac ON a.id = ac.activite_id
        WHERE ac.classe_id = ?
        ORDER BY a.titre
      """, (classe_id,)).fetchall()
    else:
      # Prof/Admin : toutes les activités
      rows = conn.execute("""
          SELECT a.id, a.titre, a.description, a.prof_id, a.salle, a.separable,
                a.effectif_max, a.date_ouverture_inscriptions, a.date_fermeture_inscriptions,
                COALESCE(a.animateur_id, a.prof_id) as animateur_id,
                COALESCE(a.visible_avant, 0) as visible_avant, a.groupe_id
          FROM activites a
          WHERE a.prof_id = ? OR a.animateur_id = ?
          ORDER BY a.titre
      """, (session["user_id"], session["user_id"])).fetchall()

    conn.close()

    result = []
    now = datetime.now()

    for a in rows:
      act = dict(a)

      # Filtres spécifiques aux élèves
      if role == "eleve":
        ouverture = datetime.fromisoformat(act["date_ouverture_inscriptions"])
        fermeture = datetime.fromisoformat(act["date_fermeture_inscriptions"])

        if not act["visible_avant"] and now < ouverture:
          continue
        if now > fermeture:
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

    # Validation sécurisée des données
    titre = sanitize_string(data.get("titre"), 100)
    description = sanitize_string(data.get("description", ""), 500)
    salle = sanitize_string(data.get("salle"), 50)

    effectif = validate_integer(data.get("effectif_max"), min_val=1, max_val=100)
    separable = bool(data.get("separable", False))
    visible_avant = bool(data.get("visible_avant", False))

    classe_ids = data.get("classe_ids", [])
    if not isinstance(classe_ids, list) or len(classe_ids) == 0:
      return jsonify({"error": "Classes requises"}), 400

    # Valider les classe_ids
    for cid in classe_ids:
      validate_integer(cid, min_val=1)

    seances = data.get("seances", [])
    if not isinstance(seances, list) or len(seances) == 0:
      return jsonify({"error": "Séances requises"}), 400

    # Valider les dates
    ouverture = data.get("date_ouverture_inscriptions")
    fermeture = data.get("date_fermeture_inscriptions")

    try:
      datetime.fromisoformat(ouverture)
      datetime.fromisoformat(fermeture)
    except ValueError:
      return jsonify({"error": "Format de date invalide"}), 400

    animateur_id = validate_integer(data.get("animateur_id", session["user_id"]), min_val=1)

    # Gestion du groupe d'exclusivité
    groupe_id = data.get("groupe_id", None)
    if groupe_id is not None and groupe_id != "":
      groupe_id = validate_integer(groupe_id, min_val=1)

    conn = get_db_connection()
    cur = conn.cursor()

    # Vérifier que le groupe existe si spécifié
    if groupe_id:
      groupe_exists = cur.execute("SELECT 1 FROM groupes_exclusivite WHERE id=?", (groupe_id,)).fetchone()
      if not groupe_exists:
        conn.rollback()
        conn.close()
        return jsonify({"error": f"Groupe invalide: {groupe_id}"}), 400

    # Insertion de l'activité
    cur.execute("""
      INSERT INTO activites
      (titre, description, prof_id, salle, separable, effectif_max,
        date_ouverture_inscriptions, date_fermeture_inscriptions, visible_avant, animateur_id, groupe_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (titre, description, session["user_id"], salle, int(separable), effectif,
        ouverture, fermeture, int(visible_avant), animateur_id, groupe_id))

    act_id = cur.lastrowid

    # Liaison classes (vérifier que les classes existent)
    for cid in classe_ids:
      # Vérifier que la classe existe
      classe_exists = cur.execute("SELECT 1 FROM classes WHERE id=?", (cid,)).fetchone()
      if not classe_exists:
        conn.rollback()
        conn.close()
        return jsonify({"error": f"Classe invalide: {cid}"}), 400

      cur.execute("INSERT INTO activite_classes (activite_id, classe_id) VALUES (?, ?)",
                  (act_id, cid))

    # Séances (valider les dates)
    for s in seances:
      if 'date_heure' in s and s['date_heure']:
          try:
            datetime.fromisoformat(s['date_heure'])
            cur.execute("INSERT INTO seances (activite_id, date_heure) VALUES (?, ?)",
                      (act_id, s["date_heure"]))
          except ValueError:
            conn.rollback()
            conn.close()
            return jsonify({"error": "Format de date séance invalide"}), 400

    conn.commit()
    conn.close()

    logger.info(f"Activité créée: {titre} par user {session['user_id']}")
    return jsonify({"success": True, "id": act_id})

  except ValueError as ve:
    return jsonify({"error": str(ve)}), 400
  except Exception as e:
    logger.error(f"Erreur création activité: {str(e)}")
    return jsonify({"error": "Erreur lors de la création"}), 500

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

    # Vérifier que l'activité est accessible à cette classe
    act = cur.execute("""
      SELECT a.* FROM activites a
      JOIN activite_classes ac ON a.id = ac.activite_id
      WHERE a.id = ? AND ac.classe_id = ?
    """, (activite_id, classe_id)).fetchone()

    if not act:
      conn.close()
      return jsonify({"error": "Activité non accessible à votre classe"}), 403

    # Vérifier que l'activité est NON sécable
    if act["separable"]:
      conn.close()
      return jsonify({"error": "Cette activité est sécable, inscrivez-vous séance par séance"}), 400

    # Vérifier les dates
    now = datetime.now()
    ouverture = datetime.fromisoformat(act["date_ouverture_inscriptions"])
    fermeture = datetime.fromisoformat(act["date_fermeture_inscriptions"])

    if now < ouverture or now > fermeture:
      conn.close()
      return jsonify({"error": "Période d'inscription fermée"}), 400

    # VÉRIFICATION D'EXCLUSIVITÉ DE GROUPE
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
        conn.close()
        activite_conflit = conflits[0]["titre"]
        return jsonify({
          "error": f"Vous êtes déjà inscrit à '{activite_conflit}' du même groupe exclusif"
        }), 400

    # Récupérer toutes les séances de l'activité
    seances = cur.execute("SELECT id FROM seances WHERE activite_id=?", (activite_id,)).fetchall()

    if not seances:
      conn.close()
      return jsonify({"error": "Aucune séance pour cette activité"}), 400

    # Vérifier si déjà inscrit à une séance
    existing = cur.execute("""
      SELECT 1 FROM presences
      WHERE eleve_id=? AND seance_id IN (SELECT id FROM seances WHERE activite_id=?)
    """, (user_id, activite_id)).fetchone()

    if existing:
      conn.close()
      return jsonify({"error": "Déjà inscrit"}), 400

    # Vérifier l'effectif pour chaque séance
    for seance in seances:
      count = cur.execute("""
        SELECT COUNT(*) FROM presences WHERE seance_id=?
      """, (seance["id"],)).fetchone()[0]

      if count >= act["effectif_max"]:
        conn.close()
        return jsonify({"error": f"Effectif complet pour au moins une séance"}), 400

    # Inscrire à TOUTES les séances
    for seance in seances:
      cur.execute("""
        INSERT INTO presences (seance_id, eleve_id, present, commentaire)
        VALUES (?, ?, 0, '')
      """, (seance["id"], user_id))

    # Garder l'ancienne table inscriptions pour compatibilité
    cur.execute("""
      INSERT INTO inscriptions (eleve_id, activite_id, date_inscription)
      VALUES (?, ?, ?)
    """, (user_id, activite_id, datetime.now().isoformat()))

    conn.commit()
    conn.close()

    logger.info(f"Inscription (NON sécable): user {user_id} -> activité {activite_id} (toutes séances)")
    return jsonify({"success": True})

  except ValueError as ve:
    return jsonify({"error": str(ve)}), 400
  except Exception as e:
    logger.error(f"Erreur inscription: {str(e)}")
    return jsonify({"error": "Erreur lors de l'inscription"}), 500


@app.route("/inscriptions", methods=["DELETE"])
@role_required('eleve')
def desinscrire():
  try:
    data = request.json
    if not data or 'activite_id' not in data:
      return jsonify({"error": "Données manquantes"}), 400

    activite_id = validate_integer(data.get("activite_id"), min_val=1)
    user_id = session["user_id"]

    conn = get_db_connection()
    cur = conn.cursor()

    # Supprimer de presences (toutes les séances)
    cur.execute("""
      DELETE FROM presences
      WHERE eleve_id=? AND seance_id IN (SELECT id FROM seances WHERE activite_id=?)
    """, (user_id, activite_id))

    # Supprimer de inscriptions
    result = cur.execute("DELETE FROM inscriptions WHERE eleve_id=? AND activite_id=?",
                        (user_id, activite_id))

    affected = result.rowcount
    conn.commit()
    conn.close()

    if affected == 0:
      return jsonify({"error": "Inscription non trouvée"}), 400

    logger.info(f"Désinscription (NON sécable): user {user_id} <- activité {activite_id}")
    return jsonify({"success": True})

  except ValueError as ve:
    return jsonify({"error": str(ve)}), 400
  except Exception as e:
    logger.error(f"Erreur désinscription: {str(e)}")
    return jsonify({"error": "Erreur lors de la désinscription"}), 500


# Inscription à UNE séance (activité sécable)
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

    # Récupérer l'activité via la séance
    seance = cur.execute("SELECT * FROM seances WHERE id=?", (seance_id,)).fetchone()
    if not seance:
      conn.close()
      return jsonify({"error": "Séance introuvable"}), 404

    activite_id = seance["activite_id"]

    # Vérifier accès à l'activité
    act = cur.execute("""
      SELECT a.* FROM activites a
      JOIN activite_classes ac ON a.id = ac.activite_id
      WHERE a.id = ? AND ac.classe_id = ?
    """, (activite_id, classe_id)).fetchone()

    if not act:
      conn.close()
      return jsonify({"error": "Activité non accessible"}), 403

    # Vérifier que l'activité est sécable
    if not act["separable"]:
      conn.close()
      return jsonify({"error": "Cette activité n'est pas sécable"}), 400

    # Vérifier dates
    now = datetime.now()
    ouverture = datetime.fromisoformat(act["date_ouverture_inscriptions"])
    fermeture = datetime.fromisoformat(act["date_fermeture_inscriptions"])

    if now < ouverture or now > fermeture:
      conn.close()
      return jsonify({"error": "Période d'inscription fermée"}), 400

    # VÉRIFICATION D'EXCLUSIVITÉ DE GROUPE
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
        conn.close()
        activite_conflit = conflits[0]["titre"]
        return jsonify({
          "error": f"Vous êtes déjà inscrit à '{activite_conflit}' du même groupe exclusif"
        }), 400


    # Vérifier effectif de la séance
    count = cur.execute("SELECT COUNT(*) FROM presences WHERE seance_id=?",
                        (seance_id,)).fetchone()[0]
    if count >= act["effectif_max"]:
      conn.close()
      return jsonify({"error": "Séance complète"}), 400

    # Vérifier si déjà inscrit à cette séance
    existing = cur.execute("SELECT 1 FROM presences WHERE eleve_id=? AND seance_id=?",
                          (user_id, seance_id)).fetchone()
    if existing:
      conn.close()
      return jsonify({"error": "Déjà inscrit à cette séance"}), 400

    # Inscription
    cur.execute("""
      INSERT INTO presences (seance_id, eleve_id, present, commentaire)
      VALUES (?, ?, 0, '')
    """, (seance_id, user_id))

    conn.commit()
    conn.close()

    logger.info(f"Inscription séance: user {user_id} -> séance {seance_id}")
    return jsonify({"success": True})

  except ValueError as ve:
    return jsonify({"error": str(ve)}), 400
  except Exception as e:
    logger.error(f"Erreur inscription séance: {str(e)}")
    return jsonify({"error": "Erreur lors de l'inscription"}), 500

# Désinscription d'UNE séance
@app.route("/inscriptions/seance", methods=["DELETE"])
@role_required('eleve')
def desinscrire_seance():
  try:
    data = request.json
    if not data or 'seance_id' not in data:
      return jsonify({"error": "Données manquantes"}), 400

    seance_id = validate_integer(data.get("seance_id"), min_val=1)
    user_id = session["user_id"]

    conn = get_db_connection()
    cur = conn.cursor()

    result = cur.execute("DELETE FROM presences WHERE eleve_id=? AND seance_id=?",
                        (user_id, seance_id))
    affected = result.rowcount
    conn.commit()
    conn.close()

    if affected == 0:
      return jsonify({"error": "Inscription non trouvée"}), 400

    logger.info(f"Désinscription séance: user {user_id} <- séance {seance_id}")
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
      # Élèves : seulement les séances de leur classe
      rows = conn.execute("""
        SELECT DISTINCT s.* FROM seances s
        JOIN activites a ON s.activite_id = a.id
        JOIN activite_classes ac ON a.id = ac.activite_id
        WHERE ac.classe_id = ?
        ORDER BY s.date_heure
      """, (classe_id,)).fetchall()
    else:
      # Prof/Admin : toutes les séances
      rows = conn.execute("SELECT * FROM seances ORDER BY date_heure").fetchall()

    conn.close()
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

    conn.close()
    return jsonify([dict(r) for r in rows])
  except Exception as e:
    logger.error(f"Erreur /inscriptions: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

# Nouvelle route pour récupérer les inscriptions par séance (manquante)
@app.route("/inscriptions/seances")
@login_required
def get_inscriptions_seances():
  try:
    conn = get_db_connection()

    # TOUJOURS retourner TOUTES les inscriptions (pour tous les rôles sinon les comptes ne sont pas bons)
    rows = conn.execute("""
        SELECT seance_id, eleve_id
        FROM presences
    """).fetchall()

    conn.close()
    return jsonify([dict(r) for r in rows])
  except Exception as e:
    logger.error(f"Erreur /inscriptions/seances: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/activite_classes")
@login_required
def get_activite_classes():
  try:
    role = session["role"]
    classe_id = session.get("classe_id")

    conn = get_db_connection()

    if role == "eleve" and classe_id:
      # Élèves : seulement les relations de leur classe
      rows = conn.execute("SELECT * FROM activite_classes WHERE classe_id = ?",
                          (classe_id,)).fetchall()
    else:
      # Prof/Admin : toutes les relations
      rows = conn.execute("SELECT * FROM activite_classes").fetchall()

    conn.close()
    return jsonify([dict(r) for r in rows])
  except Exception as e:
    logger.error(f"Erreur /activite_classes: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500



# ========================
# GROUPES D'EXCLUSIVITÉ
# ========================

@app.route("/groupes", methods=["GET"])
@login_required    ##@role_required('prof', 'admin')
def get_groupes():
  """Récupérer tous les groupes d'exclusivité"""
  try:
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM groupes_exclusivite ORDER BY nom").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])
  except Exception as e:
    logger.error(f"Erreur /groupes: {str(e)}")
    return jsonify({"error": "Erreur serveur"}), 500

@app.route("/groupes", methods=["POST"])
@role_required('prof', 'admin')
def create_groupe():
  """Créer un nouveau groupe d'exclusivité"""
  try:
    data = request.json
    valid, error = validate_basic(data, ['nom'])
    if not valid:
      return jsonify({"error": error}), 400

    nom = sanitize_string(data.get("nom"), 100)
    description = sanitize_string(data.get("description", ""), 255)

    conn = get_db_connection()
    cur = conn.cursor()

    # Vérifier si le nom existe déjà
    existing = cur.execute("SELECT 1 FROM groupes_exclusivite WHERE nom=?", (nom,)).fetchone()
    if existing:
      conn.close()
      return jsonify({"error": "Un groupe avec ce nom existe déjà"}), 400

    cur.execute("INSERT INTO groupes_exclusivite (nom, description) VALUES (?, ?)",
              (nom, description))
    groupe_id = cur.lastrowid

    conn.commit()
    conn.close()

    logger.info(f"Groupe créé: {nom} (ID: {groupe_id})")
    return jsonify({"success": True, "id": groupe_id})

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

    # Vérifier si des activités utilisent ce groupe
    activites_count = cur.execute(
      "SELECT COUNT(*) FROM activites WHERE groupe_id=?",
      (groupe_id,)
    ).fetchone()[0]

    if activites_count > 0:
      conn.close()
      return jsonify({
        "error": f"Impossible de supprimer : {activites_count} activité(s) utilisent ce groupe"
      }), 400

    result = cur.execute("DELETE FROM groupes_exclusivite WHERE id=?", (groupe_id,))

    if result.rowcount == 0:
      conn.close()
      return jsonify({"error": "Groupe introuvable"}), 404

    conn.commit()
    conn.close()

    logger.info(f"Groupe supprimé: ID {groupe_id}")
    return jsonify({"success": True})

  except Exception as e:
    logger.error(f"Erreur suppression groupe: {str(e)}")
    return jsonify({"error": "Erreur lors de la suppression"}), 500



# ========================
# SERVIR LE FRONT
# ========================
@app.route("/")
def index():
  return send_from_directory(".", "Concorde.html")

@app.route("/styles.css")
def styles():
  return send_from_directory(".", "styles.css")

@app.route("/script.js")
def script():
  return send_from_directory(".", "script.js")

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
  logger.info("Démarrage de l'application en mode production")
  # Version sécurisée pour production
  app.run(
    debug=False,
    host='0.0.0.0',  # Accessible sur le réseau local
    port=5000,
    threaded=True
  )
