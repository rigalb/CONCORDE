#!/usr/bin/python3
# -*- coding: utf-8 -*-

import sqlite3
import argparse
import sys

def read_db(db_file):
  conn = sqlite3.connect(db_file)
  c = conn.cursor()

  # Lister les tables
  c.execute("SELECT name FROM sqlite_master WHERE type='table';")
  tables = [row[0] for row in c.fetchall()]
  print(f"Tables dans la base {db_file}: {tables}\n")

  # Afficher le contenu de chaque table
  for table in tables:
    print(f"--- Contenu de la table {table} ---")
    try:
      c.execute(f"SELECT * FROM {table}")
      rows = c.fetchall()
      cols = [desc[0] for desc in c.description]
      print("Colonnes:", cols)
      for row in rows:
        print(row)
    except sqlite3.OperationalError as e:
      print("Erreur:", e)
    print()
  
  conn.close()

def main():
  parser = argparse.ArgumentParser(description="Outil de lecture SQLite simple")
  
  parser.add_argument("-r", "--read", metavar="DB_FILE", help="Lire et afficher le contenu d'une base SQLite (.db)")

  args = parser.parse_args()

  if args.read:
    read_db(args.read)
  else:
    parser.print_help()

if __name__ == "__main__":
  main()