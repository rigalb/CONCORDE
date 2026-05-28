#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
real_data.py - Import des élèves depuis un fichier .ODS
CONCORDE

Usage :
    python3 real_data.py --ods eleves.ods --db essaie.db [--site rennes|retiers|tous]

Ce script :
  1. Vérifie que le fichier ODS contient bien toutes les colonnes obligatoires
     (détection résiliente : insensible à la casse, aux accents, aux espaces)
  2. Vide UNIQUEMENT les données élèves + activités + inscriptions + groupes + classes
     (les comptes admin et prof sont PRÉSERVÉS)
  3. Relit les classes depuis le .ODS et les crée à la volée (une seule fois par classe)
  4. Insère les élèves avec mot de passe haché (werkzeug)
  5. Filtre optionnel par site (colonne "Site")
"""

import sqlite3
import argparse
import hashlib
import os
import secrets
import sys
import unicodedata
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash

try:
  import pandas as pd
except ImportError:
  print("[KO] pandas manquant : pip install pandas odfpy")
  sys.exit(1)


# ==============================================================================
# COLONNES OBLIGATOIRES
# ==============================================================================

# Clé interne -> liste des variantes acceptées (insensible casse/accents/espaces)
COLONNES_REQUISES = {
  "nom":          ["nom", "name", "lastname", "last name"],
  "prenom":       ["prénom", "prenom", "firstname", "first name", "given name"],
  "sexe":         ["sexe", "genre", "sex", "gender", "civilite", "civilité"],
  "date":         ["date", "date de naissance", "datenaissance", "birthdate", "birth date", "naissance"],
  "classe":       ["classe", "class", "group", "groupe", "division"],
  "site":         ["site", "localisation", "location", "etablissement", "établissement", "lieu"],
  "login":        ["login", "identifiant", "username", "user name", "user"],
  "mot_de_passe": ["mot de passe", "motdepasse", "password", "mdp", "pwd", "pass"],
  "email":        ["email", "e-mail", "mail", "courriel", "adresse mail", "adresse email"],
}


def _normaliser(s: str) -> str:
  """Supprime accents, met en minuscules, compresse les espaces."""
  s = unicodedata.normalize("NFD", str(s))
  s = "".join(c for c in s if unicodedata.category(c) != "Mn")
  return " ".join(s.lower().split())

def _mapper_colonnes(df_columns: list[str]) -> dict[str, str]:
  """
  Construit le mapping {clé_interne -> nom_colonne_réel}.
  Lève ValueError si une colonne obligatoire est introuvable.
  """
  colonnes_norm = {col: _normaliser(col) for col in df_columns}
  mapping = {}
  for cle, variantes in COLONNES_REQUISES.items():
    trouve = None
    for col, col_norm in colonnes_norm.items():
      if any(col_norm == _normaliser(v) for v in variantes):
        trouve = col
        break
    if trouve is None:
      raise ValueError(
        f"Colonne obligatoire introuvable : '{cle}'\n"
        f"  Variantes acceptées : {variantes}\n"
        f"  Colonnes présentes  : {list(df_columns)}"
      )
    mapping[cle] = trouve
  return mapping


# ==============================================================================
# LECTURE DU FICHIER ODS
# ==============================================================================
def lire_ods(chemin: str):
  """
  Lit le fichier ODS et retourne (DataFrame normalisée, mapping colonnes).
  La détection des colonnes est résiliente : casse, accents et espaces ignorés.
  """
  try:
    df = pd.read_excel(chemin, engine="odf")
  except Exception as e:
    print(f"[KO] Impossible de lire le fichier ODS : {e}")
    sys.exit(1)

  # Supprimer les colonnes et lignes entièrement vides
  df = df.dropna(axis=1, how="all").dropna(axis=0, how="all")

  # Détecter et valider les colonnes
  try:
    mapping = _mapper_colonnes(list(df.columns))
  except ValueError as e:
    print(f"\n[KO] Validation des colonnes échouée :\n{e}")
    sys.exit(1)

  print("[OK] Colonnes détectées :")
  for cle, col in mapping.items():
    print(f"     {cle:15s} → « {col} »")

  # Renommer vers les noms internes
  rename = {v: k for k, v in mapping.items()}
  df = df.rename(columns=rename)

  # Conserver uniquement les colonnes utiles
  df = df[[k for k in COLONNES_REQUISES.keys() if k in df.columns]]

  # Nettoyage des chaînes
  for col in ["nom", "prenom", "classe", "login", "mot_de_passe", "email", "sexe", "site"]:
    if col in df.columns:
      df[col] = df[col].astype(str).str.strip()

  df["nom"]    = df["nom"].str.upper()
  df["prenom"] = df["prenom"].str.capitalize()
  df["login"]  = df["login"].str.strip()

  # Supprimer les lignes sans login (colonnes pivot)
  avant = len(df)
  df = df[
    df["login"].notna()
    & (df["login"] != "")
    & (df["login"].str.lower() != "nan")
  ]
  if len(df) != avant:
    print(f"[!] {avant - len(df)} ligne(s) ignorée(s) (login vide ou absent)")

  # Parser la date de naissance
  def parse_date(d):
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d.%m.%Y"):
      try:
        return datetime.strptime(str(d).strip(), fmt).date()
      except Exception:
        pass
    return None

  df["date"] = df["date"].apply(parse_date)

  print(f"[OK] {len(df)} ligne(s) valide(s) dans le fichier ODS")
  return df, mapping


# ==============================================================================
# NETTOYAGE CIBLÉ DE LA BASE
# ==============================================================================
def vider_donnees_eleves(conn: sqlite3.Connection) -> None:
  """
  Supprime UNIQUEMENT les données élèves et les données associées
  (activités, inscriptions, présences, séances, groupes, classes, rappels,
    tokens d'invitation non utilisés, voeux/procédures d'échange).
  Les comptes admin et prof sont CONSERVÉS intacts.
  """
  cur = conn.cursor()
  cur.execute("PRAGMA foreign_keys = OFF;")

  etapes = [
    # Échanges
    ("procedures_echange",  "DELETE FROM procedures_echange"),
    ("voeux_echange",       "DELETE FROM voeux_echange"),
    # Inscriptions / présences
    ("presences",           "DELETE FROM presences"),
    ("rappels_inscription",  "DELETE FROM rappels_inscription"),
    ("inscriptions",        "DELETE FROM inscriptions"),
    # Activités
    ("activite_classes",    "DELETE FROM activite_classes"),
    ("seances",             "DELETE FROM seances"),
    ("activites",           "DELETE FROM activites"),
    # Groupes et classes
    ("groupe_classes",      "DELETE FROM groupe_classes"),
    ("groupes_exclusivite", "DELETE FROM groupes_exclusivite"),
    ("classes",             "DELETE FROM classes"),
    # Élèves uniquement
    ("password_reset_tokens (eleves)",
      "DELETE FROM password_reset_tokens "
      "WHERE user_id IN (SELECT id FROM users WHERE role='eleve')"),
    ("users (eleves)",      "DELETE FROM users WHERE role = 'eleve'"),
    # Tokens d'invitation
    ("invitation_tokens",   "DELETE FROM invitation_tokens"),
    # Logs admin (optionnel - conservés)
  ]

  for label, sql in etapes:
    cur.execute(sql)
    print(f"  [vide] {label:<38} -> {cur.rowcount} ligne(s) supprimée(s)")

  # Réinitialiser les séquences auto-increment pour les tables vidées complètement
  tables_full = [
    "procedures_echange", "voeux_echange", "rappels_inscription",
    "inscriptions", "activite_classes", "seances", "activites",
    "groupe_classes", "groupes_exclusivite", "classes",
    "invitation_tokens", "password_reset_tokens",
  ]
  for t in tables_full:
    cur.execute(f"DELETE FROM sqlite_sequence WHERE name='{t}';")

  conn.commit()
  cur.execute("PRAGMA foreign_keys = ON;")
  print("[OK] Nettoyage total terminé (admin et prof préservés).")


# ==============================================================================
# INSERTION DES DONNÉES
# ==============================================================================
def inserer_donnees(conn: sqlite3.Connection, df, site: str = "tous") -> list:
  """
  Insère les élèves dans la base depuis le DataFrame.
  - Filtre par site si demandé
  - Crée les classes à la volée (une seule fois par nom de classe)
  - Hache les mots de passe
  """
  cur = conn.cursor()

  if site != "tous" and "site" in df.columns:
    df_filtree = df[df["site"].str.lower() == site.lower()].copy()
    print(f"[OK] Filtre site='{site}' : {len(df_filtree)}/{len(df)} élèves retenus")
    if len(df_filtree) == 0:
      dispo = sorted(df["site"].str.lower().unique().tolist())
      print(f"[!] Aucun élève pour ce site '{site}'. Sites disponibles : {dispo}")
      return []
  else:
    df_filtree = df.copy()

  # Cache des classes : nom -> id
  classes_cache: dict[str, int] = {}
  nb_inseres = 0
  nb_erreurs = 0
  ids = []

  for i, (_, row) in enumerate(df_filtree.iterrows(), start=1):
    login  = str(row.get("login", "")).strip()
    nom    = str(row.get("nom", "")).strip()
    prenom = str(row.get("prenom", "")).strip()
    email  = str(row.get("email", "")).strip()
    mdp    = str(row.get("mot_de_passe", "")).strip()
    classe_nom = str(row.get("classe", "")).strip()

    # Vérifications minimales
    if not login or login.lower() in ("nan", "none", ""):
      print(f"  [!] Ligne {i} ignorée : login vide")
      nb_erreurs += 1
      continue
    if not mdp or mdp.lower() in ("nan", "none", ""):
      print(f"  [!] Ligne {i} ({login}) ignorée : mot de passe vide")
      nb_erreurs += 1
      continue

    # Création de la classe si nécessaire
    if classe_nom and classe_nom.lower() not in ("nan", "none", ""):
      if classe_nom not in classes_cache:
        existing = cur.execute(
          "SELECT id FROM classes WHERE nom = ?", (classe_nom,)
        ).fetchone()
        if existing:
          classes_cache[classe_nom] = existing[0]
        else:
          cur.execute("INSERT INTO classes (nom) VALUES (?)", (classe_nom,))
          classes_cache[classe_nom] = cur.lastrowid
          print(f"  [+] Classe créée : « {classe_nom} »")
      classe_id = classes_cache[classe_nom]
    else:
      classe_id = None

    try:
      cur.execute(
        "INSERT INTO users "
        "(username, password_hash, role, nom, prenom, email, classe_id) "
        "VALUES (?, ?, 'eleve', ?, ?, ?, ?)",
        (login, generate_password_hash(mdp), nom, prenom, email, classe_id)
      )
      ids.append(cur.lastrowid)
      nb_inseres += 1
    except sqlite3.IntegrityError as e:
      print(f"  [!] Ligne {i} ({login}) : doublon ignoré ({e})")
      nb_erreurs += 1

  conn.commit()
  print(f"[OK] Élèves : {nb_inseres} insérés, {nb_erreurs} ignorés - "
      f"{len(classes_cache)} classe(s) créée(s)")
  return ids


# ==============================================================================
# TOKENS PREMIÈRE CONNEXION
# ==============================================================================
def _hash_code(code: str) -> str:
  return hashlib.sha256(code.encode()).hexdigest()

def creer_tokens_first_login(conn: sqlite3.Connection, user_ids: list) -> None:
  """
  Crée un token 'first_login' pour chaque élève de la liste.

  Ce token est un MARQUEUR stocké en base.  À la première connexion,
  Flask le détecte via is_first_login(), redirige l'élève vers /first-login,
  génère un vrai OTP 6 chiffres et l'envoie par email.
  Le placeholder stocké ici est un hash aléatoire : il n'est jamais comparé
  à une saisie utilisateur.

  Peut aussi être appelé seul sur une base existante :
    from real_data import creer_tokens_first_login
    conn = sqlite3.connect("essaie.db")
    conn.row_factory = sqlite3.Row
    ids = [r["id"] for r in conn.execute(
      "SELECT id FROM users WHERE role='eleve' "
      "AND NOT EXISTS (SELECT 1 FROM password_reset_tokens "
      "WHERE user_id=users.id AND token_type='first_login' AND used=0)"
    ).fetchall()]
    creer_tokens_first_login(conn, ids)
    conn.close()
  """
  if not user_ids:
    print("[!] Aucun token first_login à créer (liste vide).")
    return

  cur = conn.cursor()
  expires_at = (datetime.now() + timedelta(days=90)).isoformat()
  nb = 0

  for uid in user_ids:
    placeholder = _hash_code(secrets.token_hex(32))
    try:
      cur.execute(
        "INSERT INTO password_reset_tokens "
        "(user_id, token, token_type, expires_at) "
        "VALUES (?, ?, 'first_login', ?)",
        (uid, placeholder, expires_at)
      )
      nb += 1
    except sqlite3.IntegrityError:
      pass  # token déjà présent

  conn.commit()
  print(f"[OK] {nb} token(s) 'first_login' créés (expiration : 90 jours).")


# ==============================================================================
# POINT D'ENTRÉE
# ==============================================================================
def main():
  parser = argparse.ArgumentParser(
    description="Import des élèves depuis un .ODS vers la base SQLite CONCORDE",
    formatter_class=argparse.RawDescriptionHelpFormatter,
    epilog="""
Exemples :
  python3 real_data.py --ods eleves.ods --db essaie.db
  python3 real_data.py --ods eleves.ods --db essaie.db --site rennes
  python3 real_data.py --ods eleves.ods --db essaie.db --site tous

Ce script SUPPRIME les élèves existants et les données associées.
Les comptes admin et prof sont PRÉSERVÉS.
    """
  )
  parser.add_argument("--ods", required=True, help="Chemin vers le fichier .ODS à importer")
  parser.add_argument("--db",  required=True, help="Chemin vers la base SQLite CONCORDE")
  parser.add_argument("--site", default="tous", help="Filtrer par site (colonne Site du fichier). Défaut : 'tous' (pas de filtre)")
  args = parser.parse_args()

  # Vérifications préliminaires
  if not os.path.exists(args.ods):
    print(f"[KO] Fichier ODS introuvable : {args.ods}")
    sys.exit(1)
  if not os.path.exists(args.db):
    print(f"[KO] Base de données introuvable : {args.db}")
    sys.exit(1)

  print(f"\n{'='*60}")
  print(f"  CONCORDE - Import élèves")
  print(f"  ODS : {args.ods}")
  print(f"  DB  : {args.db}")
  print(f"  Site : {args.site}")
  print(f"{'='*60}\n")

  # Lecture et validation du fichier ODS
  print(">> Étape 1 : Lecture du fichier ODS...")
  df, _ = lire_ods(args.ods)

  # Connexion base
  conn = sqlite3.connect(args.db)
  conn.row_factory = sqlite3.Row

  # Nettoyage ciblé
  print("\n>> Étape 2 : Nettoyage de la base de données...")
  vider_donnees_eleves(conn)

  # Insertion
  print("\n>> Étape 3 : Insertion des élèves...")
  ids = inserer_donnees(conn, df, site=args.site)

  print("\n>> Étape 4 : Tokens première connexion...")
  creer_tokens_first_login(conn, ids)

  conn.close()

  print(f"\n{'='*60}")
  print(f"  Import terminé - {len(ids)} élève(s) prêt(s).")
  print(f"{'='*60}\n")


if __name__ == "__main__":
  main()
