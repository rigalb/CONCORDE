#!/usr/bin/python3
# -*- coding: utf-8 -*-

from flask import Flask, jsonify, request
import sqlite3
import os

app_test = Flask(__name__)

# Chemin vers la base SQLite dans le même dossier que ce script
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
db_file = os.path.join(BASE_DIR, "team_2.db")

def get_conn():
  return sqlite3.connect(db_file)

# -----------------------------
# ROUTES POUR TOUTES LES TABLES
# -----------------------------

@app_test.route("/")
def home():
  return "Serveur Flask en route. Accède à /users, /classes, /activites, etc."

@app_test.route("/users")
def get_users():
  conn = get_conn()
  c = conn.cursor()
  c.execute("SELECT id, username, role, nom, prenom, email, classe_id FROM users")
  users = [dict(zip([col[0] for col in c.description], row)) for row in c.fetchall()]
  conn.close()
  return jsonify(users)

@app_test.route("/classes")
def get_classes():
  conn = get_conn()
  c = conn.cursor()
  c.execute("SELECT id, nom FROM classes")
  classes = [dict(zip([col[0] for col in c.description], row)) for row in c.fetchall()]
  conn.close()
  return jsonify(classes)

@app_test.route("/professeurs")
def get_professeurs():
  conn = get_conn()
  c = conn.cursor()
  c.execute("SELECT id, matiere FROM professeurs")
  profs = [dict(zip([col[0] for col in c.description], row)) for row in c.fetchall()]
  conn.close()
  return jsonify(profs)

@app_test.route("/activites")
def get_activites():
  conn = get_conn()
  c = conn.cursor()
  c.execute("""
    SELECT id, titre, description, prof_id, salle, separable, effectif_max, 
          date_ouverture_inscriptions, date_fermeture_inscriptions 
    FROM activites
  """)
  acts = [dict(zip([col[0] for col in c.description], row)) for row in c.fetchall()]
  conn.close()
  return jsonify(acts)

@app_test.route("/activite_classes")
def get_activite_classes():
  conn = get_conn()
  c = conn.cursor()
  c.execute("SELECT activite_id, classe_id FROM activite_classes")
  data = [dict(zip([col[0] for col in c.description], row)) for row in c.fetchall()]
  conn.close()
  return jsonify(data)

@app_test.route("/seances")
def get_seances():
  conn = get_conn()
  c = conn.cursor()
  c.execute("SELECT id, activite_id, date_heure FROM seances")
  data = [dict(zip([col[0] for col in c.description], row)) for row in c.fetchall()]
  conn.close()
  return jsonify(data)

@app_test.route("/inscriptions")
def get_inscriptions():
  conn = get_conn()
  c = conn.cursor()
  c.execute("SELECT id, eleve_id, activite_id, date_inscription FROM inscriptions")
  data = [dict(zip([col[0] for col in c.description], row)) for row in c.fetchall()]
  conn.close()
  return jsonify(data)

@app_test.route("/presences")
def get_presences():
  conn = get_conn()
  c = conn.cursor()
  c.execute("SELECT id, seance_id, eleve_id, present, commentaire FROM presences")
  data = [dict(zip([col[0] for col in c.description], row)) for row in c.fetchall()]
  conn.close()
  return jsonify(data)

# -----------------------------
# LANCEMENT
# -----------------------------
if __name__ == "__main__":
  app_test.run(debug=True)
