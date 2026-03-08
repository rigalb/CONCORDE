import sqlite3
import pandas as pd
from datetime import datetime
import argparse
import os
import sys
from werkzeug.security import generate_password_hash

DB_PATH = "essaie.db"
ODS_PATH = "eleves_col_lyc.ods"

def hash_password(password: str) -> str:
  """Retourne un hash SHA-256 du mot de passe."""
  return generate_password_hash(password)

def vider_tables(conn):
  """Vide toutes les tables de la base sans supprimer la structure."""
  cursor = conn.cursor()
  cursor.execute("PRAGMA foreign_keys = OFF;")

  tables = [
    "users", "classes", "professeurs", "activites", "activite_classes",
    "seances", "inscriptions", "presences", "groupes_exclusivite",
    "invitation_tokens", "rappels_inscription", "groupe_classes"
  ]

  for t in tables:
    cursor.execute(f"DELETE FROM {t};")
    cursor.execute(f"DELETE FROM sqlite_sequence WHERE name='{t}';")

  conn.commit()
  cursor.execute("PRAGMA foreign_keys = ON;")
  print("[OK] Toutes les tables ont été vidées.")

def lire_donnees_ods_pandas(fichier_ods: str):
  """Lit un fichier ODS avec pandas et retourne une DataFrame nettoyée."""
  df = pd.read_excel(fichier_ods, engine="odf")
  df.columns = [c.strip() for c in df.columns]

  # Renommer les colonnes pour normaliser
  mapping = {
    "Nom": "nom",
    "Prénom": "prenom",
    "Sexe": "sexe",
    "Date": "date_naissance",
    "Classe": "classe",
    "Login": "login",
    "Mot de passe": "mot_de_passe",
    "Email": "email",
    "Site": "site" if "Site" in df.columns else None
  }
  mapping = {k: v for k, v in mapping.items() if v is not None}
  df = df.rename(columns=mapping)

  # Nettoyage des données
  df["nom"] = df["nom"].astype(str).str.upper().str.strip()
  df["prenom"] = df["prenom"].astype(str).str.capitalize().str.strip()
  df["classe"] = df["classe"].astype(str).str.strip()
  df["login"] = df["login"].astype(str).str.strip()
  df["mot_de_passe"] = df["mot_de_passe"].astype(str).str.strip()
  df["email"] = df["email"].astype(str).str.strip()

  # Convertir la date (si possible)
  def parse_date(d):
    try:
      return datetime.strptime(str(d), "%d/%m/%Y").date()
    except Exception:
      return None

  df["date_naissance"] = df["date_naissance"].apply(parse_date)

  return df

def inserer_donnees(conn, df, site="tous"):
  """Insère les utilisateurs à partir de la DataFrame."""
  cursor = conn.cursor()
  classes_cache = {}

  if site != "tous" and "site" in df.columns:
    df = df[df["site"].str.lower() == site.lower()]
    print(f"Import limité au site : {site} ({len(df)} lignes)")

  for _, row in df.iterrows():
    classe_nom = row["classe"]

    # Création automatique des classes
    if classe_nom not in classes_cache:
      cursor.execute("SELECT id FROM classes WHERE nom = ?", (classe_nom,))
      res = cursor.fetchone()
      if res:
        classe_id = res[0]
      else:
        cursor.execute("INSERT INTO classes (nom) VALUES (?)", (classe_nom,))
        classe_id = cursor.lastrowid
      classes_cache[classe_nom] = classe_id
    else:
      classe_id = classes_cache[classe_nom]

    password_hash = hash_password(row["mot_de_passe"])

    cursor.execute("""
      INSERT INTO users (username, password_hash, role, nom, prenom, email, classe_id)
      VALUES (?, ?, 'eleve', ?, ?, ?, ?)
    """, (
      row["login"],
      password_hash,
      row["nom"],
      row["prenom"],
      row["email"],
      classe_id
    ))

  # Compte admin root
  cursor.execute("""
    INSERT INTO users (username, password_hash, role, nom, prenom, email)
    VALUES ('root', ?, 'admin', 'ROOT', 'Administrateur', 'root@example.com')
  """, (hash_password("root"),))

  conn.commit()
  print(f"[OK] {len(df)} utilisateurs importés + compte admin 'root' ajouté.")

def main():
  parser = argparse.ArgumentParser(description="Importation des élèves depuis un fichier .ODS avec pandas")
  parser.add_argument("--db", default=DB_PATH, help="Chemin vers la base SQLite")
  parser.add_argument("--ods", default=ODS_PATH, help="Chemin vers le fichier .ODS")
  parser.add_argument("--site", choices=["rennes", "retiers", "tous"], default="tous",
                      help="Choix du site à importer")
  args = parser.parse_args()

  if not os.path.exists(args.ods):
    print(f"[KO] Fichier introuvable : {args.ods}")
    return

  conn = sqlite3.connect(args.db)
  vider_tables(conn)

  df = lire_donnees_ods_pandas(args.ods)
  print(f"[OK] {len(df)} lignes lues depuis {args.ods}")

  inserer_donnees(conn, df, args.site)
  conn.close()
  print("[OK] Import terminé avec succès.")

if __name__ == "__main__":
  main()
