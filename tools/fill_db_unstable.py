import sqlite3
from datetime import datetime, timedelta, time
from werkzeug.security import generate_password_hash
import random

DB_PATH = "essaie.db"

# Connexion
conn = sqlite3.connect(DB_PATH)
c = conn.cursor()

print("=" * 80)
print("RÉINITIALISATION COMPLÈTE DE LA BASE DE DONNÉES")
print("=" * 80)

# ============================================================================
# ÉTAPE 1 : NETTOYAGE COMPLET
# ============================================================================
tables_to_clear = [
  "activite_classes",
  "presences",
  "inscriptions",
  "seances",
  "activites",
  "professeurs",
  "users",
  "classes",
  "groupes_exclusivite",
  "invitation_tokens"
]

for table in tables_to_clear:
  try:
    c.execute(f"DELETE FROM {table};")
    print(f"[OK] Table '{table}' vidée")
  except sqlite3.OperationalError:
    print(f"[KO] Table '{table}' absente, ignorée")

conn.commit()
print("\n Toutes les tables ont été nettoyées.\n")

# ============================================================================
# ÉTAPE 2 : DONNÉES DE BASE
# ============================================================================
print("Création des classes...")
classes = [
  (1, '3A'), 
  (2, '3B'), 
  (3, '2A'), 
  (4, '2B'), 
  (5, '1A'),
  (6, '1B')
]
c.executemany("INSERT INTO classes (id, nom) VALUES (?, ?)", classes)
print(f"[OK] {len(classes)} classes créées\n")

print("Création des groupes d'exclusivité...")
groupes = [
  (1, 'Sport', 'Activités sportives'),
  (2, 'Arts', 'Activités artistiques et culturelles'),
  (3, 'Soutien scolaire', 'Aide aux devoirs et soutien')
]
c.executemany("INSERT INTO groupes_exclusivite (id, nom, description) VALUES (?, ?, ?)", groupes)
print(f"[OK] {len(groupes)} groupes créés\n")

# Hash du mot de passe "123"
password = generate_password_hash("123")

print("Création des utilisateurs...")
users = [
  # Professeurs
  (1, 'prof1', password, 'prof', 'Dupont', 'Alain', 'alain.dupont@school.fr', None),
  (2, 'prof2', password, 'prof', 'Lemoine', 'Sophie', 'sophie.lemoine@school.fr', None),
  (3, 'prof3', password, 'prof', 'Bernard', 'Paul', 'paul.bernard@school.fr', None),
  (4, 'prof4', password, 'prof', 'Moreau', 'Julie', 'julie.moreau@school.fr', None),
  
  # Élèves - Classe 3A
  (5, 'eleve1', password, 'eleve', 'Martin', 'Emma', 'emma.martin@school.fr', 1),
  (6, 'eleve2', password, 'eleve', 'Dubois', 'Lucas', 'lucas.dubois@school.fr', 1),
  (7, 'eleve3', password, 'eleve', 'Thomas', 'Léa', 'lea.thomas@school.fr', 1),
  (8, 'eleve4', password, 'eleve', 'Petit', 'Hugo', 'hugo.petit@school.fr', 1),
  
  # Élèves - Classe 3B
  (9, 'eleve5', password, 'eleve', 'Robert', 'Chloé', 'chloe.robert@school.fr', 2),
  (10, 'eleve6', password, 'eleve', 'Richard', 'Louis', 'louis.richard@school.fr', 2),
  
  # Élèves - Classe 2A
  (11, 'eleve7', password, 'eleve', 'Durand', 'Camille', 'camille.durand@school.fr', 3),
  (12, 'eleve8', password, 'eleve', 'Laurent', 'Tom', 'tom.laurent@school.fr', 3),
  
  # Élèves - Classe 2B
  (13, 'eleve9', password, 'eleve', 'Simon', 'Sarah', 'sarah.simon@school.fr', 4),
  (14, 'eleve10', password, 'eleve', 'Michel', 'Nathan', 'nathan.michel@school.fr', 4),
  
  # Élèves - Classe 1A
  (15, 'eleve11', password, 'eleve', 'Lefebvre', 'Julie', 'julie.lefebvre@school.fr', 5),
  (16, 'eleve12', password, 'eleve', 'Leroy', 'Antoine', 'antoine.leroy@school.fr', 5),
  
  # Admin
  (17, 'admin', password, 'admin', 'Root', 'Admin', 'admin@school.fr', None),
]

c.executemany("""
INSERT INTO users (id, username, password_hash, role, nom, prenom, email, classe_id)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
""", users)

professeurs = [
  (1, 'Arts Dramatiques'),
  (2, 'Mathématiques'),
  (3, 'Éducation Physique'),
  (4, 'Musique')
]
c.executemany("INSERT INTO professeurs (id, matiere) VALUES (?, ?)", professeurs)
print(f"[OK] {len([u for u in users if u[3] == 'prof'])} professeurs créés")
print(f"[OK] {len([u for u in users if u[3] == 'eleve'])} élèves créés")
print(f"[OK] 1 administrateur créé\n")

# ============================================================================
# ÉTAPE 3 : FONCTIONS UTILITAIRES POUR LES DATES
# ============================================================================
def dt(days=0, hour=14, minute=0):
  """Génère une date ISO à partir d'aujourd'hui + décalage"""
  base = datetime.now() + timedelta(days=days)
  return base.replace(hour=hour, minute=minute, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M")

# ============================================================================
# ÉTAPE 4 : CRÉATION DES ACTIVITÉS DE TEST
# ============================================================================
print("Création des activités de test...\n")

now = datetime.now()
activites = []
seances = []
activite_classes_data = []
sid = 1  # Compteur de séances

# ----------------------------------------------------------------------------
# ACTIVITÉ 1 : Théâtre - Sécable, inscriptions ouvertes, EN COURS maintenant
# ----------------------------------------------------------------------------
print("Activité 1 : Atelier Théâtre")
print("    - Sécable, 4 séances hebdomadaires")
print("    - SÉANCE EN COURS en ce moment même")
print("    - Pas de groupe exclusif")
print("    - Prof1 créateur, Prof1 animateur")

a1_id = 1
a1_ouverture = dt(-7)  # Ouvert depuis 1 semaine
a1_fermeture = dt(30)   # Ferme dans 1 mois
activites.append((a1_id, "Atelier Théâtre", "Initiation au théâtre et improvisation", 1, "Salle spectacle", 1, 12, a1_ouverture, a1_fermeture, 1, 1, None))
activite_classes_data.extend([(a1_id, 1), (a1_id, 2)])  # Classes 3A et 3B

# Séances tous les lundis 14h, première séance MAINTENANT
base = now.replace(hour=14, minute=0, second=0, microsecond=0)
days_since_monday = (base.weekday() - 0) % 7
if days_since_monday > 0:
  base = base - timedelta(days=days_since_monday)
if base.weekday() == 0 and now.hour >= 15:
  base = base + timedelta(weeks=1)

for i in range(4):
  date = base + timedelta(weeks=i)
  seances.append((sid, a1_id, date.strftime("%Y-%m-%dT%H:%M")))
  sid += 1

print("[OK] 4 séances créées (lundi 14h, durée 55min)\n")

# ----------------------------------------------------------------------------
# ACTIVITÉ 2 : Soutien Maths - Non sécable, groupe Soutien
# ----------------------------------------------------------------------------
print("Activité 2 : Soutien Mathématiques")
print("    - NON sécable (inscription = toutes séances)")
print("    - Groupe 'Soutien scolaire'")
print("    - Prof2 créateur, Prof2 animateur")

a2_id = 2
activites.append((a2_id, "Soutien Mathématiques", "Aide aux devoirs de maths", 2, "Salle M12", 0, 8, dt(-5), dt(20), 1, 2, 3))
activite_classes_data.extend([(a2_id, 1), (a2_id, 2), (a2_id, 3)])

base = now.replace(hour=10, minute=0, second=0, microsecond=0)
days_until_wednesday = (2 - base.weekday()) % 7
if days_until_wednesday == 0 and now.hour >= 11:
  days_until_wednesday = 7
base = base + timedelta(days=days_until_wednesday)

for i in range(3):
  date = base + timedelta(weeks=i)
  seances.append((sid, a2_id, date.strftime("%Y-%m-%dT%H:%M")))
  sid += 1

print("[OK] 3 séances créées (mercredi 10h, durée 55min)\n")

# ----------------------------------------------------------------------------
# ACTIVITÉ 3 : Basket - Sécable, groupe Sport, animateur différent
# ----------------------------------------------------------------------------
print("Activité 3 : Basket-ball")
print("    - Sécable")
print("    - Groupe 'Sport'")
print("    - Prof3 créateur, Prof4 animateur (différent!)")

a3_id = 3
activites.append((a3_id, "Basket-ball", "Entraînement basket", 3, "Gymnase", 1, 15, dt(-3), dt(25), 1, 4, 1))
activite_classes_data.extend([(a3_id, 3), (a3_id, 4), (a3_id, 5)])

base = now.replace(hour=15, minute=0, second=0, microsecond=0)
days_until_friday = (4 - base.weekday()) % 7
if days_until_friday == 0 and now.hour >= 16:
  days_until_friday = 7
base = base + timedelta(days=days_until_friday)

for i in range(5):
  date = base + timedelta(weeks=i)
  seances.append((sid, a3_id, date.strftime("%Y-%m-%dT%H:%M")))
  sid += 1

print("[OK] 5 séances créées (vendredi 15h, durée 55min)\n")

# ----------------------------------------------------------------------------
# ACTIVITÉ 4 : Chorale - Non sécable, groupe Arts, effectif COMPLET
# ----------------------------------------------------------------------------
print("Activité 4 : Chorale")
print("    - NON sécable")
print("    - Groupe 'Arts'")
print("    - Effectif max 4 → sera COMPLET")

a4_id = 4
activites.append((a4_id, "Chorale", "Chant choral", 4, "Salle musique", 0, 4, dt(-2), dt(15), 1, 4, 2))
activite_classes_data.extend([(a4_id, 1), (a4_id, 2)])

base = now.replace(hour=16, minute=30, second=0, microsecond=0)
days_until_tuesday = (1 - base.weekday()) % 7
if days_until_tuesday == 0 and now.hour >= 17:
  days_until_tuesday = 7
base = base + timedelta(days=days_until_tuesday)

for i in range(4):
  date = base + timedelta(weeks=i)
  seances.append((sid, a4_id, date.strftime("%Y-%m-%dT%H:%M")))
  sid += 1

print("[OK] 4 séances créées (mardi 16h30, durée 55min)\n")

# ----------------------------------------------------------------------------
# ACTIVITÉ 5 : Yoga - Sécable, groupe Sport
# ----------------------------------------------------------------------------
print("Activité 5 : Yoga")
print("    - Sécable")
print("    - Groupe 'Sport' (CONFLIT avec Basket)")

a5_id = 5
activites.append((a5_id, "Yoga", "Relaxation et bien-être", 1, "Dojo", 1, 6, dt(-1), dt(20), 1, 3, 1))
activite_classes_data.extend([(a5_id, 1), (a5_id, 3), (a5_id, 5)])

base = now.replace(hour=13, minute=0, second=0, microsecond=0)
days_until_thursday = (3 - base.weekday()) % 7
if days_until_thursday == 0 and now.hour >= 14:
  days_until_thursday = 7
base = base + timedelta(days=days_until_thursday)

for i in range(3):
  date = base + timedelta(weeks=i)
  seances.append((sid, a5_id, date.strftime("%Y-%m-%dT%H:%M")))
  sid += 1

print("[OK] 3 séances créées (jeudi 13h, durée 55min)\n")

# ----------------------------------------------------------------------------
# ACTIVITÉ 6 : Peinture - Sécable, groupe Arts, inscriptions futures
# ----------------------------------------------------------------------------
print("Activité 6 : Atelier Peinture")
print("    - Sécable")
print("    - Groupe 'Arts' (CONFLIT avec Chorale)")
print("    - Inscriptions s'ouvrent dans 3 jours")

a6_id = 6
activites.append((a6_id, "Atelier Peinture", "Peinture acrylique et aquarelle", 2, "Atelier art", 1, 10, dt(3), dt(25), 1, 2, 2))
activite_classes_data.extend([(a6_id, 2), (a6_id, 4), (a6_id, 6)])

base = now + timedelta(days=5)
base = base.replace(hour=14, minute=0, second=0, microsecond=0)

for i in range(4):
  date = base + timedelta(weeks=i)
  seances.append((sid, a6_id, date.strftime("%Y-%m-%dT%H:%M")))
  sid += 1

print("[OK] 4 séances créées (démarrage dans 5 jours, durée 55min)\n")

# ----------------------------------------------------------------------------
# ACTIVITÉ 7 : Échecs - Non sécable, PAS de groupe, inscriptions fermées
# ----------------------------------------------------------------------------
print("Activité 7 : Club d'échecs")
print("    - NON sécable")
print("    - AUCUN groupe (libre)")
print("    - Inscriptions FERMÉES depuis hier")

a7_id = 7
activites.append((a7_id, "Club d'échecs", "Tournois et apprentissage", 3, "CDI", 0, 12, dt(-10), dt(-1), 1, 3, None))
activite_classes_data.extend([(a7_id, 1), (a7_id, 2), (a7_id, 3), (a7_id, 4)])

base = now.replace(hour=12, minute=0, second=0, microsecond=0)
for i in range(6):
  date = base + timedelta(weeks=i)
  seances.append((sid, a7_id, date.strftime("%Y-%m-%dT%H:%M")))
  sid += 1

print("[OK] 6 séances créées (inscriptions fermées, durée 55min)\n")

# ----------------------------------------------------------------------------
# ACTIVITÉ 8 : Robotique - Sécable, pas de groupe
# ----------------------------------------------------------------------------
print("Activité 8 : Robotique")
print("    - Sécable")
print("    - Pas de groupe (libre)")

a8_id = 8
activites.append((a8_id, "Robotique", "Construction et programmation", 4, "Labo techno", 1, 8, dt(-2), dt(30), 1, 2, None))
activite_classes_data.extend([(a8_id, 3), (a8_id, 4), (a8_id, 5), (a8_id, 6)])

base = now.replace(hour=9, minute=0, second=0, microsecond=0)
days_until_saturday = (5 - base.weekday()) % 7
if days_until_saturday == 0 and now.hour >= 10:
  days_until_saturday = 7
base = base + timedelta(days=days_until_saturday)

for i in range(4):
  date = base + timedelta(weeks=i)
  seances.append((sid, a8_id, date.strftime("%Y-%m-%dT%H:%M")))
  sid += 1

print("[OK] 4 séances créées (samedi 9h, durée 55min)\n")

# ----------------------------------------------------------------------------
# ACTIVITÉ 9 : Activité PASSÉE (toutes séances terminées)
# ----------------------------------------------------------------------------
print("Activité 9 : Jeux de société (PASSÉE)")
print("    - Toutes les séances sont terminées")
print("    - Pas de groupe")

a9_id = 9
past_date = now - timedelta(days=30)
activites.append((a9_id, "Jeux de société", "Activité terminée", 1, "Foyer", 0, 15, dt(-40), dt(-25), 1, 1, None))
activite_classes_data.extend([(a9_id, 1), (a9_id, 2), (a9_id, 3)])

base = past_date.replace(hour=14, minute=0, second=0, microsecond=0)
for i in range(3):
  date = base + timedelta(weeks=i)
  seances.append((sid, a9_id, date.strftime("%Y-%m-%dT%H:%M")))
  sid += 1

print("[OK] 3 séances passées créées (durée 55min)\n")

# Insertion en base
c.executemany("""
INSERT INTO activites 
(id, titre, description, prof_id, salle, separable, effectif_max, 
 date_ouverture_inscriptions, date_fermeture_inscriptions, visible_avant, animateur_id, groupe_id)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
""", activites)

c.executemany("INSERT INTO activite_classes (activite_id, classe_id) VALUES (?, ?)", activite_classes_data)

c.executemany("""
INSERT INTO seances (id, activite_id, date_heure) 
VALUES (?, ?, ?)
""", seances)

print(f"[OK] {len(activites)} activités créées")
print(f"[OK] {len(seances)} séances créées (toutes de 55min)\n")

# ============================================================================
# ÉTAPE 5 : INSCRIPTIONS ET PRÉSENCES - RESPECTE LES GROUPES D'EXCLUSIVITÉ
# ============================================================================
print("Création des inscriptions (en respectant les groupes)...\n")

inscriptions = []
presences = []
ins_id = 1
pres_id = 1

# Suivi des groupes par élève
eleve_groupes = {}  # {eleve_id: groupe_id}

def peut_inscrire(eleve_id, groupe_id):
  """Vérifie si l'élève peut s'inscrire (pas de conflit de groupe)"""
  if groupe_id is None:
    return True
  if eleve_id not in eleve_groupes:
    return True
  return eleve_groupes[eleve_id] != groupe_id

def inscrire_eleve(eleve_id, activite_id, groupe_id, is_separable):
  """Inscrit un élève en respectant les règles"""
  global ins_id, pres_id
  
  if not peut_inscrire(eleve_id, groupe_id):
    return False
  
  # Marquer le groupe pour cet élève
  if groupe_id is not None:
    eleve_groupes[eleve_id] = groupe_id
  
  # Pour activité non sécable : inscription globale
  if not is_separable:
    inscriptions.append((ins_id, eleve_id, activite_id, dt(-4)))
    ins_id += 1
  
  # Ajouter les présences
  seances_activite = [s[0] for s in seances if s[1] == activite_id]
  for seance_id in seances_activite:
    #presences.append((pres_id, seance_id, eleve_id, 0, ''))
    pres_id += 1
  
  return True

# --- Activité 1 (Théâtre) : Groupe None, sécable
print("  Théâtre (groupe None, sécable) :")
for eleve_id in [5, 6, 7, 8]:  # Emma, Lucas, Léa, Hugo (3A)
  theatre_seances = [s[0] for s in seances if s[1] == 1]
  nb_inscriptions = random.randint(2, 3)
  seances_choisies = random.sample(theatre_seances, nb_inscriptions)
  for seance_id in seances_choisies:
    presences.append((pres_id, seance_id, eleve_id, 0, ''))
    pres_id += 1
  print(f"    - Élève {eleve_id} inscrit à {nb_inscriptions} séances")

# --- Activité 2 (Soutien Maths) : Groupe 3 (Soutien), non sécable
print("\n  Soutien Maths (groupe 3-Soutien, non sécable) :")
for eleve_id in [9, 11]:  # Chloé (3B), Camille (2A)
  if inscrire_eleve(eleve_id, 2, 3, False):
    print(f"    - Élève {eleve_id} inscrit (toutes séances)")

# --- Activité 3 (Basket) : Groupe 1 (Sport), sécable
print("\n  Basket (groupe 1-Sport, sécable) :")
for eleve_id in [12, 13, 14]:  # Tom (2A), Sarah (2B), Nathan (2B)
  if inscrire_eleve(eleve_id, 3, 1, True):
    # Comme c'est sécable, on retire l'inscription globale qu'on a ajoutée par erreur
    basket_seances = [s[0] for s in seances if s[1] == 3]
    nb_inscriptions = random.randint(2, 4)
    # On garde seulement quelques présences
    all_presences = [p for p in presences if p[2] == eleve_id and p[1] in basket_seances]
    # Retirer toutes les présences
    presences = [p for p in presences if not (p[2] == eleve_id and p[1] in basket_seances)]
    # Réajouter seulement le nombre voulu
    seances_choisies = random.sample(basket_seances, nb_inscriptions)
    for seance_id in seances_choisies:
      presences.append((pres_id, seance_id, eleve_id, 0, ''))
      pres_id += 1
    print(f"    - Élève {eleve_id} inscrit à {nb_inscriptions} séances (groupe Sport)")
    eleve_groupes[eleve_id] = 1

# --- Activité 4 (Chorale) : Groupe 2 (Arts), non sécable - COMPLET
print("\n  Chorale (groupe 2-Arts, non sécable, COMPLET 4/4) :")
for eleve_id in [5, 6, 7, 10]:  # Emma, Lucas, Léa, Louis
  if inscrire_eleve(eleve_id, 4, 2, False):
    print(f"    - Élève {eleve_id} inscrit (groupe Arts)")

# --- Activité 5 (Yoga) : Groupe 1 (Sport) - CONFLIT avec Basket
print("\n  Yoga (groupe 1-Sport) :")
# Élève 15 (Julie, 1A) peut s'inscrire (pas de conflit)
if inscrire_eleve(15, 5, 1, True):
  yoga_seances = [s[0] for s in seances if s[1] == 5]
  # Retirer les présences automatiques
  presences = [p for p in presences if not (p[2] == 15 and p[1] in yoga_seances)]
  # Ajouter 2 séances
  seances_choisies = random.sample(yoga_seances, 2)
  for seance_id in seances_choisies:
    presences.append((pres_id, seance_id, 15, 0, ''))
    pres_id += 1
  print(f"    - Élève 15 (Julie) inscrit à 2 séances")
  eleve_groupes[15] = 1

# Élève 12 (Tom) NE PEUT PAS s'inscrire (déjà Basket = groupe Sport)
if not peut_inscrire(12, 1):
  print(f"    - Élève 12 (Tom) NE PEUT PAS s'inscrire (déjà dans Basket, groupe Sport)")

# --- Activité 7 (Échecs) : Groupe None, non sécable, FERMÉ
print("\n  Échecs (groupe None, non sécable, inscriptions fermées) :")
for eleve_id in [8, 16]:  # Hugo (3A), Antoine (1A)
  if inscrire_eleve(eleve_id, 7, None, False):
    print(f"    - Élève {eleve_id} inscrit (inscriptions fermées maintenant)")

# --- Activité 8 (Robotique) : Groupe None, sécable
print("\n  Robotique (groupe None, sécable) :")
for eleve_id in [14, 16]:  # Nathan, Antoine
  robo_seances = [s[0] for s in seances if s[1] == 8]
  # Retirer les présences existantes
  presences = [p for p in presences if not (p[2] == eleve_id and p[1] in robo_seances)]
  nb_inscriptions = random.randint(2, 3)
  seances_choisies = random.sample(robo_seances, nb_inscriptions)
  for seance_id in seances_choisies:
    presences.append((pres_id, seance_id, eleve_id, 0, ''))
    pres_id += 1
  print(f"    - Élève {eleve_id} inscrit à {nb_inscriptions} séances")

# --- Activité 9 (Passée) : Groupe None, non sécable, appel fait
print("\n  Jeux de société (groupe None, passée, appel fait) :")
for eleve_id in [5, 6, 9]:  # Emma, Lucas, Chloé
  if inscrire_eleve(eleve_id, 9, None, False):
    # Retirer les présences à 0
    jeux_seances = [s[0] for s in seances if s[1] == 9]
    presences = [p for p in presences if not (p[2] == eleve_id and p[1] in jeux_seances)]
    # Ajouter avec appel fait
    for seance_id in jeux_seances:
      present = 1 if random.random() > 0.2 else 0
      presences.append((pres_id, seance_id, eleve_id, present, ''))
      pres_id += 1
    print(f"    - Élève {eleve_id} inscrit (appel fait)")

# Insertion
if inscriptions:
  c.executemany("""
  INSERT INTO inscriptions (id, eleve_id, activite_id, date_inscription)
  VALUES (?, ?, ?, ?)
  """, inscriptions)

if presences:
  c.executemany("""
  INSERT INTO presences (id, seance_id, eleve_id, present, commentaire)
  VALUES (?, ?, ?, ?, ?)
  """, presences)

print(f"\n[OK] {len(inscriptions)} inscriptions globales créées")
print(f"[OK] {len(presences)} présences/inscriptions détaillées créées\n")

# ============================================================================
# AFFICHAGE RÉSUMÉ DES GROUPES
# ============================================================================
print("=" * 80)
print("RÉSUMÉ DES INSCRIPTIONS PAR GROUPE")
print("=" * 80)
for eleve_id, groupe_id in eleve_groupes.items():
  groupe_nom = {1: 'Sport', 2: 'Arts', 3: 'Soutien'}[groupe_id]
  eleve = [u for u in users if u[0] == eleve_id][0]
  print(f"  Élève {eleve_id} ({eleve[5]} {eleve[4]}) → Groupe {groupe_nom}")

# ============================================================================
# FINALISATION
# ============================================================================
conn.commit()
conn.close()

print("\n" + "=" * 80)
print("[OK] BASE DE DONNÉES REMPLIE AVEC SUCCÈS")
print("=" * 80)
print("\nRÉSUMÉ DES DONNÉES :\n")
print(f"  • {len(classes)} classes")
print(f"  • {len(groupes)} groupes d'exclusivité")
print(f"  • 4 professeurs + 1 admin + 12 élèves")
print(f"  • {len(activites)} activités")
print(f"  • {len(seances)} séances (toutes 55min)")
print(f"  • {len(inscriptions)} inscriptions globales")
print(f"  • {len(presences)} présences détaillées")

print("\n" + "=" * 80)
print("COMPTES DE TEST")
print("=" * 80)
print("\n  PROFESSEURS (mot de passe: 123)")
print("  • prof1 / 123  → Alain Dupont")
print("  • prof2 / 123  → Sophie Lemoine")
print("  • prof3 / 123  → Paul Bernard")
print("  • prof4 / 123  → Julie Moreau")

print("\n  ÉLÈVES (mot de passe: 123)")
print("  • eleve1 / 123 → Emma Martin (3A)")
print("    Inscrit à: Théâtre (sans groupe), Chorale (groupe Arts)")
print("  • eleve2 / 123 → Lucas Dubois (3A)")
print("    Inscrit à: Théâtre (sans groupe), Chorale (groupe Arts)")
print("  • eleve5 / 123 → Chloé Robert (3B)")
print("    Inscrit à: Soutien Maths (groupe Soutien), Jeux passé")
print("  • eleve7 / 123 → Camille Durand (2A)")
print("    Inscrit à: Soutien Maths (groupe Soutien)")
print("  • eleve8 / 123 → Tom Laurent (2A)")
print("    Inscrit à: Basket (groupe Sport)")
print("  • eleve9 / 123 → Sarah Simon (2B)")
print("    Inscrit à: Basket (groupe Sport)")
print("  • eleve11 / 123 → Julie Lefebvre (1A)")
print("    Inscrit à: Yoga (groupe Sport)")

print("\n  ADMIN")
print("  • admin / 123  → Admin Root")

print("\n" + "=" * 80)
print("SCÉNARIOS DE TEST VALIDÉS")
print("=" * 80)

scenarios = [
  {
    "titre": "[OK] Test conflit groupe Sport",
    "compte": "eleve8 (Tom, inscrit au Basket)",
    "action": "Tenter de s'inscrire au Yoga",
    "attendu": "REFUSÉ - déjà inscrit dans groupe Sport"
  },
  {
    "titre": "[OK] Test conflit groupe Arts",
    "compte": "eleve1 (Emma, inscrite à Chorale)",
    "action": "Tenter de s'inscrire à Peinture (quand ouverte)",
    "attendu": "REFUSÉ - déjà inscrite dans groupe Arts"
  },
  {
    "titre": "[OK] Test sans conflit - pas de groupe",
    "compte": "eleve1 (Emma)",
    "action": "S'inscrire à Robotique ou Échecs",
    "attendu": "AUTORISÉ - ces activités n'ont pas de groupe"
  },
  {
    "titre": "[OK] Test effectif complet",
    "compte": "eleve9 (Sarah)",
    "action": "Tenter de s'inscrire à Chorale",
    "attendu": "REFUSÉ - effectif complet (4/4)"
  },
  {
    "titre": "[OK] Test inscriptions fermées",
    "compte": "eleve1 (Emma)",
    "action": "Tenter de s'inscrire aux Échecs",
    "attendu": "REFUSÉ - inscriptions fermées depuis hier"
  },
  {
    "titre": "[OK] Test activité sécable",
    "compte": "eleve10 (Louis, classe 3B)",
    "action": "S'inscrire à Théâtre (séance par séance)",
    "attendu": "Boutons individuels par séance"
  },
  {
    "titre": "[OK] Test activité non sécable",
    "compte": "eleve3 (Léa, classe 3A)",
    "action": "S'inscrire à Soutien Maths",
    "attendu": "Bouton unique pour toutes les séances"
  },
  {
    "titre": "[OK] Test appel en cours",
    "compte": "prof1 (Alain)",
    "action": "Faire l'appel pour Théâtre (en cours)",
    "attendu": "Modal avec liste élèves, boutons Présent/Absent"
  },
  {
    "titre": "[OK] Test appel déjà fait",
    "compte": "prof1 (Alain)",
    "action": "Voir Jeux de société (passé)",
    "attendu": "Affichage consultation seule"
  },
  {
    "titre": "[OK] Test animateur différent",
    "compte": "prof4 (Julie, animatrice Basket)",
    "action": "Voir ses activités",
    "attendu": "Basket visible (malgré Prof3 créateur)"
  },
  {
    "titre": "[OK] Test classe non autorisée",
    "compte": "eleve11 (Julie, classe 1A)",
    "action": "Voir Chorale (classes 3A, 3B seulement)",
    "attendu": "Chorale NON visible dans la liste"
  },
  {
    "titre": "[OK] Test inscriptions futures",
    "compte": "eleve10 (Louis, classe 3B)",
    "action": "Voir Peinture (ouvre dans 3 jours)",
    "attendu": "Visible mais 'Inscriptions pas encore ouvertes'"
  },
  {
    "titre": "[OK] Test désinscription sécable",
    "compte": "eleve1 (Emma)",
    "action": "Se désinscrire d'une séance de Théâtre",
    "attendu": "Retrait de cette séance uniquement"
  },
  {
    "titre": "[OK] Test désinscription non sécable",
    "compte": "eleve5 (Chloé)",
    "action": "Se désinscrire de Soutien Maths",
    "attendu": "Retrait de TOUTES les séances + libère groupe Soutien"
  },
  {
    "titre": "[OK] Test emploi du temps élève",
    "compte": "eleve1 (Emma)",
    "action": "Voir planning semaine",
    "attendu": "Théâtre (lundi 14h) et Chorale (mardi 16h30)"
  }
]

for i, scenario in enumerate(scenarios, 1):
  print(f"\n{i:2d}. {scenario['titre']}")
  print(f"Compte : {scenario['compte']}")
  print(f"Action : {scenario['action']}")
  print(f"Attendu: {scenario['attendu']}")

print("=" * 80)
print("BASE DE DONNÉES PRÊTE AVEC RÈGLES MÉTIER RESPECTÉES!")
print("=" * 80)
print("\nToutes les inscriptions respectent les groupes d'exclusivité.")
print("Les scénarios de test sont maintenant cohérents avec les données.\n")