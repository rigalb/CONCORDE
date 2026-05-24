#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
create_tables.py — Initialisation du schéma SQLite CONCORDE
CONCORDE

Usage :
    python3 create_tables.py --db essaie.db

Ce script crée toutes les tables, index et colonnes nécessaires au fonctionnement
de l'application CONCORDE. Il est idempotent : peut être relancé sans risque sur
une base existante (CREATE IF NOT EXISTS + ALTER TABLE ignoré si déjà présent).

Il NE supprime aucune donnée existante.
Pour une remise à zéro complète, utiliser real_data.py.
"""

import sqlite3
import argparse
import os
import sys


# ==============================================================================
# SCHÉMA COMPLET
# ==============================================================================
TABLES = [
  # --- Tables de base -------------------------------------------------------
  """
  CREATE TABLE IF NOT EXISTS classes (
    id  INTEGER PRIMARY KEY,
    nom TEXT NOT NULL
  )
  """,

  """
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    username      TEXT    UNIQUE NOT NULL,
    password_hash TEXT    NOT NULL,
    role          TEXT    CHECK(role IN ('admin', 'prof', 'eleve')) NOT NULL,
    nom           TEXT    NOT NULL,
    prenom        TEXT    NOT NULL,
    email         TEXT    NOT NULL,
    classe_id     INTEGER,
    blocked_until TEXT    DEFAULT NULL,
    FOREIGN KEY(classe_id) REFERENCES classes(id)
  )
  """,

  """
  CREATE TABLE IF NOT EXISTS professeurs (
    id      INTEGER PRIMARY KEY,
    matiere TEXT,
    FOREIGN KEY(id) REFERENCES users(id)
  )
  """,

  # --- Groupes d'exclusivité ------------------------------------------------
  """
  CREATE TABLE IF NOT EXISTS groupes_exclusivite (
    id              INTEGER PRIMARY KEY,
    nom             TEXT    NOT NULL,
    description     TEXT,
    echanges_actifs INTEGER DEFAULT 0
  )
  """,

  # --- Activités ------------------------------------------------------------
  """
  CREATE TABLE IF NOT EXISTS activites (
    id                          INTEGER PRIMARY KEY,
    titre                       TEXT    NOT NULL,
    description                 TEXT,
    prof_id                     INTEGER NOT NULL,
    salle                       TEXT,
    separable                   INTEGER DEFAULT 0,
    effectif_max                INTEGER,
    date_ouverture_inscriptions TEXT,
    date_fermeture_inscriptions TEXT,
    visible_avant               INTEGER DEFAULT 0,
    animateur_id                INTEGER,
    groupe_id                   INTEGER,
    FOREIGN KEY(prof_id)      REFERENCES users(id),
    FOREIGN KEY(animateur_id) REFERENCES users(id),
    FOREIGN KEY(groupe_id)    REFERENCES groupes_exclusivite(id)
  )
  """,

  """
  CREATE TABLE IF NOT EXISTS activite_classes (
    activite_id INTEGER,
    classe_id   INTEGER,
    PRIMARY KEY (activite_id, classe_id),
    FOREIGN KEY(activite_id) REFERENCES activites(id),
    FOREIGN KEY(classe_id)   REFERENCES classes(id)
  )
  """,

  # --- Séances --------------------------------------------------------------
  """
  CREATE TABLE IF NOT EXISTS seances (
    id          INTEGER PRIMARY KEY,
    activite_id INTEGER NOT NULL,
    date_heure  TEXT,
    duree       INTEGER DEFAULT 60,
    FOREIGN KEY(activite_id) REFERENCES activites(id)
  )
  """,

  # --- Inscriptions & présences ---------------------------------------------
  """
  CREATE TABLE IF NOT EXISTS inscriptions (
    id               INTEGER PRIMARY KEY,
    eleve_id         INTEGER NOT NULL,
    activite_id      INTEGER NOT NULL,
    date_inscription TEXT,
    FOREIGN KEY(eleve_id)    REFERENCES users(id),
    FOREIGN KEY(activite_id) REFERENCES activites(id)
  )
  """,

  """
  CREATE TABLE IF NOT EXISTS presences (
    id          INTEGER PRIMARY KEY,
    seance_id   INTEGER NOT NULL,
    eleve_id    INTEGER NOT NULL,
    present     INTEGER DEFAULT 0,
    commentaire TEXT,
    FOREIGN KEY(seance_id) REFERENCES seances(id),
    FOREIGN KEY(eleve_id)  REFERENCES users(id)
  )
  """,

  # --- Invitations professeurs ----------------------------------------------
  """
  CREATE TABLE IF NOT EXISTS invitation_tokens (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    token            TEXT    UNIQUE NOT NULL,
    email            TEXT    NOT NULL,
    prenom           TEXT    NOT NULL,
    nom              TEXT    NOT NULL,
    created_at       TEXT    DEFAULT (datetime('now')),
    expires_at       TEXT    NOT NULL,
    used             INTEGER DEFAULT 0,
    used_at          TEXT,
    used_by_user_id  INTEGER,
    created_by       INTEGER NOT NULL,
    FOREIGN KEY(created_by)       REFERENCES users(id),
    FOREIGN KEY(used_by_user_id)  REFERENCES users(id)
  )
  """,

  # --- Rappels d'inscription ------------------------------------------------
  """
  CREATE TABLE IF NOT EXISTS rappels_inscription (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    eleve_id    INTEGER NOT NULL,
    groupe_id   INTEGER NOT NULL,
    date_envoi  TEXT    NOT NULL,
    envoye_par  INTEGER NOT NULL,
    FOREIGN KEY(eleve_id)   REFERENCES users(id)                 ON DELETE CASCADE,
    FOREIGN KEY(groupe_id)  REFERENCES groupes_exclusivite(id)   ON DELETE CASCADE,
    FOREIGN KEY(envoye_par) REFERENCES users(id)                 ON DELETE CASCADE
  )
  """,

  # --- Liaison groupes / classes --------------------------------------------
  """
  CREATE TABLE IF NOT EXISTS groupe_classes (
    groupe_id INTEGER NOT NULL,
    classe_id INTEGER NOT NULL,
    PRIMARY KEY (groupe_id, classe_id),
    FOREIGN KEY(groupe_id) REFERENCES groupes_exclusivite(id) ON DELETE CASCADE,
    FOREIGN KEY(classe_id) REFERENCES classes(id)             ON DELETE CASCADE
  )
  """,

  # --- Réinitialisation de mot de passe -------------------------------------
  """
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    token      TEXT    UNIQUE NOT NULL,
    token_type TEXT    CHECK(token_type IN ('first_login', 'password_reset')) NOT NULL,
    created_at TEXT    DEFAULT (datetime('now')),
    expires_at TEXT    NOT NULL,
    used       INTEGER DEFAULT 0,
    used_at    TEXT,
    ip_address TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )
  """,

  # --- Échanges -------------------------------------------------------------
  """
  CREATE TABLE IF NOT EXISTS voeux_echange (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    eleve_id             INTEGER NOT NULL,
    groupe_id            INTEGER NOT NULL,
    activite_actuelle_id INTEGER NOT NULL,
    activite_cible_id    INTEGER NOT NULL,
    statut               TEXT    CHECK(statut IN ('actif','en_procedure','realise','annule'))
                          DEFAULT 'actif',
    created_at           TEXT    DEFAULT (datetime('now')),
    updated_at           TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY(eleve_id)             REFERENCES users(id)                ON DELETE CASCADE,
    FOREIGN KEY(groupe_id)            REFERENCES groupes_exclusivite(id)  ON DELETE CASCADE,
    FOREIGN KEY(activite_actuelle_id) REFERENCES activites(id)            ON DELETE CASCADE,
    FOREIGN KEY(activite_cible_id)    REFERENCES activites(id)            ON DELETE CASCADE
  )
  """,

  """
  CREATE TABLE IF NOT EXISTS procedures_echange (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    voeu_a_id       INTEGER NOT NULL,
    voeu_b_id       INTEGER NOT NULL,
    statut          TEXT    CHECK(statut IN ('en_attente','accord_b','valide','refuse','annule'))
                    DEFAULT 'en_attente',
    created_at      TEXT    DEFAULT (datetime('now')),
    date_accord_b   TEXT,
    date_validation TEXT,
    valide_par      INTEGER,
    FOREIGN KEY(voeu_a_id)  REFERENCES voeux_echange(id) ON DELETE CASCADE,
    FOREIGN KEY(voeu_b_id)  REFERENCES voeux_echange(id) ON DELETE CASCADE,
    FOREIGN KEY(valide_par) REFERENCES users(id)
  )
  """,

  # --- Logs administration --------------------------------------------------
  """
  CREATE TABLE IF NOT EXISTS admin_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL,
    message    TEXT NOT NULL,
    user_id    INTEGER,
    actor_id   INTEGER,
    ip         TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
  """,
]

# ==============================================================================
# INDEX
# ==============================================================================
INDEXES = [
  # Activités
  "CREATE INDEX IF NOT EXISTS idx_activites_groupe    ON activites(groupe_id)",
  "CREATE INDEX IF NOT EXISTS idx_activites_prof      ON activites(prof_id)",

  # Invitations
  "CREATE INDEX IF NOT EXISTS idx_invitation_token   ON invitation_tokens(token)",
  "CREATE INDEX IF NOT EXISTS idx_invitation_email   ON invitation_tokens(email)",
  "CREATE INDEX IF NOT EXISTS idx_invitation_expires ON invitation_tokens(expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_invitation_used    ON invitation_tokens(used)",

  # Rappels
  "CREATE INDEX IF NOT EXISTS idx_rappels_eleve_groupe ON rappels_inscription(eleve_id, groupe_id)",
  "CREATE INDEX IF NOT EXISTS idx_rappels_date         ON rappels_inscription(date_envoi)",

  # Séances
  "CREATE INDEX IF NOT EXISTS idx_seances_activite ON seances(activite_id)",
  "CREATE INDEX IF NOT EXISTS idx_seances_date     ON seances(date_heure)",

  # Présences
  "CREATE INDEX IF NOT EXISTS idx_presences_seance      ON presences(seance_id)",
  "CREATE INDEX IF NOT EXISTS idx_presences_eleve       ON presences(eleve_id)",
  "CREATE INDEX IF NOT EXISTS idx_presences_eleve_seance ON presences(eleve_id, seance_id)",

  # Activite_classes
  "CREATE INDEX IF NOT EXISTS idx_activite_classes_activite ON activite_classes(activite_id)",
  "CREATE INDEX IF NOT EXISTS idx_activite_classes_classe   ON activite_classes(classe_id)",

  # Password reset
  "CREATE INDEX IF NOT EXISTS idx_reset_token   ON password_reset_tokens(token)",
  "CREATE INDEX IF NOT EXISTS idx_reset_user    ON password_reset_tokens(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_reset_expires ON password_reset_tokens(expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_reset_used    ON password_reset_tokens(used)",

  # Users
  "CREATE INDEX IF NOT EXISTS idx_users_email      ON users(email)",
  "CREATE INDEX IF NOT EXISTS idx_users_username   ON users(username)",
  "CREATE INDEX IF NOT EXISTS idx_users_role       ON users(role)",
  "CREATE INDEX IF NOT EXISTS idx_users_classe     ON users(classe_id)",
  "CREATE INDEX IF NOT EXISTS idx_users_classe_role ON users(classe_id, role)",

  # Professeurs
  "CREATE INDEX IF NOT EXISTS idx_professeurs_matiere ON professeurs(matiere)",

  # Inscriptions
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_inscriptions_unique  ON inscriptions(eleve_id, activite_id)",
  "CREATE INDEX IF NOT EXISTS idx_inscriptions_activite ON inscriptions(activite_id)",
  "CREATE INDEX IF NOT EXISTS idx_inscriptions_eleve    ON inscriptions(eleve_id)",
  "CREATE INDEX IF NOT EXISTS idx_inscriptions_date     ON inscriptions(date_inscription)",

  # Voeux & procédures échange
  """CREATE UNIQUE INDEX IF NOT EXISTS idx_voeux_eleve_groupe_actif
      ON voeux_echange(eleve_id, groupe_id)
      WHERE statut IN ('actif','en_procedure')""",
  "CREATE INDEX IF NOT EXISTS idx_voeux_eleve_groupe ON voeux_echange(eleve_id, groupe_id)",
  "CREATE INDEX IF NOT EXISTS idx_voeux_eleve        ON voeux_echange(eleve_id)",
  "CREATE INDEX IF NOT EXISTS idx_voeux_groupe       ON voeux_echange(groupe_id)",
  "CREATE INDEX IF NOT EXISTS idx_voeux_statut       ON voeux_echange(statut)",
  "CREATE INDEX IF NOT EXISTS idx_voeux_actuelle     ON voeux_echange(activite_actuelle_id)",
  "CREATE INDEX IF NOT EXISTS idx_voeux_cible        ON voeux_echange(activite_cible_id)",
  "CREATE INDEX IF NOT EXISTS idx_procedures_voeu_a  ON procedures_echange(voeu_a_id)",
  "CREATE INDEX IF NOT EXISTS idx_procedures_voeu_b  ON procedures_echange(voeu_b_id)",
  "CREATE INDEX IF NOT EXISTS idx_procedures_statut  ON procedures_echange(statut)",
]

# ==============================================================================
# COLONNES À AJOUTER SI ABSENTES (migrations idempotentes)
# ==============================================================================
COLONNES_MIGRATION = [
  # (table, colonne, définition SQL)
  ("users",               "blocked_until",    "TEXT DEFAULT NULL"),
  ("groupes_exclusivite", "echanges_actifs",  "INTEGER DEFAULT 0"),
]


# ==============================================================================
# FONCTIONS
# ==============================================================================
def creer_schema(conn: sqlite3.Connection, verbose: bool = True) -> None:
  """Crée toutes les tables et index. Idempotent."""
  cur = conn.cursor()
  cur.execute("PRAGMA foreign_keys = ON")
  cur.execute("PRAGMA journal_mode = WAL")
  cur.execute("PRAGMA synchronous = NORMAL")

  # Tables
  nb_tables = 0
  for ddl in TABLES:
    cur.execute(ddl)
    nb_tables += 1
  if verbose:
    print(f"[OK] {nb_tables} tables vérifiées / créées")

  # Migrations colonnes
  for table, colonne, definition in COLONNES_MIGRATION:
    try:
      cur.execute(f"ALTER TABLE {table} ADD COLUMN {colonne} {definition}")
      if verbose:
        print(f"[+] Colonne ajoutée : {table}.{colonne}")
    except sqlite3.OperationalError:
      pass  # Colonne déjà présente - normal

  # Index
  nb_idx = 0
  for ddl in INDEXES:
    try:
      cur.execute(ddl)
      nb_idx += 1
    except sqlite3.OperationalError as e:
      if verbose:
        print(f"[!] Index ignoré : {e}")
  if verbose:
    print(f"[OK] {nb_idx} index vérifiés / créés")

  conn.commit()


# ==============================================================================
# POINT D'ENTRÉE
# ==============================================================================
def main():
  parser = argparse.ArgumentParser(
    description="Initialise ou met à jour le schéma SQLite de CONCORDE",
    formatter_class=argparse.RawDescriptionHelpFormatter,
    epilog="""
Exemples :
  python3 create_tables.py --db essaie.db
  python3 create_tables.py --db /var/www/concorde/essaie.db

Ce script est idempotent : il peut être relancé sans risque sur une base existante.
Il ne supprime aucune donnée.
    """
  )
  parser.add_argument(
    "--db", required=True,
    help="Chemin vers la base SQLite (sera créée si elle n'existe pas)"
  )
  parser.add_argument(
    "--quiet", "-q", action="store_true",
    help="Mode silencieux (erreurs uniquement)"
  )
  args = parser.parse_args()

  verbose = not args.quiet

  if verbose:
    print(f"\n{'='*60}")
    print(f"  CONCORDE - Initialisation du schéma")
    print(f"  Base : {args.db}")
    print(f"{'='*60}\n")

  nouveau = not os.path.exists(args.db)
  conn = sqlite3.connect(args.db)
  conn.row_factory = sqlite3.Row

  try:
    creer_schema(conn, verbose=verbose)
  except Exception as e:
    print(f"[KO] Erreur lors de la création du schéma : {e}")
    conn.close()
    sys.exit(1)

  conn.close()

  if verbose:
    statut = "créée" if nouveau else "mise à jour"
    print(f"\n[OK] Base '{args.db}' {statut} avec succès.")


if __name__ == "__main__":
  main()
