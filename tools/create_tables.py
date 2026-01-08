#!/usr/bin/python3
# -*- coding: utf-8 -*-

import sqlite3

db_file = "essaie.db"
conn = sqlite3.connect(db_file)
c = conn.cursor()

# Activer les clés étrangères
c.execute("PRAGMA foreign_keys = ON;")

# ----------------------------
# Tables de base
# ----------------------------
c.execute("""
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY,
  nom TEXT NOT NULL
);
""")

c.execute("""
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT CHECK(role IN ('admin', 'prof', 'eleve')) NOT NULL,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  email TEXT NOT NULL,
  classe_id INTEGER,
  FOREIGN KEY(classe_id) REFERENCES classes(id)
);
""")

c.execute("""
CREATE TABLE IF NOT EXISTS professeurs (
  id INTEGER PRIMARY KEY,
  matiere TEXT,
  FOREIGN KEY(id) REFERENCES users(id)
);
""")

# ----------------------------
# Groupes d'exclusivité
# ----------------------------
c.execute("""
CREATE TABLE IF NOT EXISTS groupes_exclusivite (
  id INTEGER PRIMARY KEY,
  nom TEXT NOT NULL,
  description TEXT
);
""")

# ----------------------------
# Activités
# ----------------------------
c.execute("""
CREATE TABLE IF NOT EXISTS activites (
  id INTEGER PRIMARY KEY,
  titre TEXT NOT NULL,
  description TEXT,
  prof_id INTEGER NOT NULL,
  salle TEXT,
  separable INTEGER DEFAULT 0,
  effectif_max INTEGER,
  date_ouverture_inscriptions TEXT,
  date_fermeture_inscriptions TEXT,
  visible_avant INTEGER DEFAULT 0,
  animateur_id INTEGER,
  groupe_id INTEGER,
  FOREIGN KEY(prof_id) REFERENCES users(id),
  FOREIGN KEY(animateur_id) REFERENCES users(id),
  FOREIGN KEY(groupe_id) REFERENCES groupes_exclusivite(id)
);
""")

c.execute("""
CREATE TABLE IF NOT EXISTS activite_classes (
  activite_id INTEGER,
  classe_id INTEGER,
  PRIMARY KEY (activite_id, classe_id),
  FOREIGN KEY(activite_id) REFERENCES activites(id),
  FOREIGN KEY(classe_id) REFERENCES classes(id)
);
""")

# ----------------------------
# Séances
# ----------------------------
c.execute("""
CREATE TABLE IF NOT EXISTS seances (
  id INTEGER PRIMARY KEY,
  activite_id INTEGER NOT NULL,
  date_heure TEXT,
  duree INTEGER DEFAULT 60,
  FOREIGN KEY(activite_id) REFERENCES activites(id)
);
""")

# ----------------------------
# Inscriptions & présences
# ----------------------------
c.execute("""
CREATE TABLE IF NOT EXISTS inscriptions (
  id INTEGER PRIMARY KEY,
  eleve_id INTEGER NOT NULL,
  activite_id INTEGER NOT NULL,
  date_inscription TEXT,
  FOREIGN KEY(eleve_id) REFERENCES users(id),
  FOREIGN KEY(activite_id) REFERENCES activites(id)
);
""")

c.execute("""
CREATE TABLE IF NOT EXISTS presences (
  id INTEGER PRIMARY KEY,
  seance_id INTEGER NOT NULL,
  eleve_id INTEGER NOT NULL,
  present INTEGER DEFAULT 0,
  commentaire TEXT,
  FOREIGN KEY(seance_id) REFERENCES seances(id),
  FOREIGN KEY(eleve_id) REFERENCES users(id)
);
""")

# ----------------------------
# Invitations
# ----------------------------
c.execute("""
CREATE TABLE IF NOT EXISTS invitation_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  prenom TEXT NOT NULL,
  nom TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  used_at TEXT,
  used_by_user_id INTEGER,
  created_by INTEGER NOT NULL,
  FOREIGN KEY(created_by) REFERENCES users(id),
  FOREIGN KEY(used_by_user_id) REFERENCES users(id)
);
""")

# ----------------------------
# Rappels d'inscription
# ----------------------------
c.execute("""
CREATE TABLE IF NOT EXISTS rappels_inscription (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eleve_id INTEGER NOT NULL,
  groupe_id INTEGER NOT NULL,
  date_envoi TEXT NOT NULL,
  envoye_par INTEGER NOT NULL,
  FOREIGN KEY(eleve_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(groupe_id) REFERENCES groupes_exclusivite(id) ON DELETE CASCADE,
  FOREIGN KEY(envoye_par) REFERENCES users(id) ON DELETE CASCADE
);
""")

# ----------------------------
# Liaison groupes / classes
# ----------------------------
c.execute("""
CREATE TABLE IF NOT EXISTS groupe_classes (
  groupe_id INTEGER NOT NULL,
  classe_id INTEGER NOT NULL,
  PRIMARY KEY (groupe_id, classe_id),
  FOREIGN KEY(groupe_id) REFERENCES groupes_exclusivite(id) ON DELETE CASCADE,
  FOREIGN KEY(classe_id) REFERENCES classes(id) ON DELETE CASCADE
);
""")

# ----------------------------
# Index
# ----------------------------
indexes = [
  "CREATE INDEX IF NOT EXISTS idx_activites_groupe ON activites(groupe_id);",
  "CREATE INDEX IF NOT EXISTS idx_invitation_token ON invitation_tokens(token);",
  "CREATE INDEX IF NOT EXISTS idx_invitation_email ON invitation_tokens(email);",
  "CREATE INDEX IF NOT EXISTS idx_invitation_expires ON invitation_tokens(expires_at);",
  "CREATE INDEX IF NOT EXISTS idx_invitation_used ON invitation_tokens(used);",
  "CREATE INDEX IF NOT EXISTS idx_rappels_eleve_groupe ON rappels_inscription(eleve_id, groupe_id);",
  "CREATE INDEX IF NOT EXISTS idx_rappels_date ON rappels_inscription(date_envoi);",
  "CREATE INDEX IF NOT EXISTS idx_seances_activite ON seances(activite_id);",
  "CREATE INDEX IF NOT EXISTS idx_seances_date ON seances(date_heure);",
  "CREATE INDEX IF NOT EXISTS idx_presences_seance ON presences(seance_id);",
  "CREATE INDEX IF NOT EXISTS idx_presences_eleve ON presences(eleve_id);",
  "CREATE INDEX IF NOT EXISTS idx_activite_classes_activite ON activite_classes(activite_id);",
  "CREATE INDEX IF NOT EXISTS idx_activite_classes_classe ON activite_classes(classe_id);"
]

for idx in indexes:
  c.execute(idx)
conn.commit()
conn.close()
print(f"Base SQLite '{db_file}' créée avec tout le schéma.")