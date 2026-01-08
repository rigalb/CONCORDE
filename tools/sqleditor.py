#!/usr/bin/python3
# -*- coding: utf-8 -*-

import sqlite3
from tkinter import Tk, Button, Label, Entry, Text, Toplevel, Scrollbar, END, messagebox
from tkinter import filedialog
from tkinter.ttk import Combobox, Treeview, Style
from typing import Optional, List, Tuple, Any

class SQLiteEditor:
  def __init__(self, root: Tk):
    self.root = root
    self.root.title("SQLite DB Editor")
    self.root.geometry("980x512")  # largeur x hauteur en pixels
    #self.root.attributes("-topmost", True)
    self.conn: Optional[sqlite3.Connection] = None
    self.cursor: Optional[sqlite3.Cursor] = None
    self.current_table: Optional[str] = None

    # Widgets
    self.open_btn = Button(root, text="Ouvrir DB", command=self.open_db)
    self.open_btn.grid(row=0, column=0, padx=5, pady=5)

    self.table_combo = Combobox(root, state="readonly")
    self.table_combo.grid(row=0, column=1, padx=5, pady=5)
    self.table_combo.bind("<<ComboboxSelected>>", self.load_table)

    self.tree = Treeview(root, show="headings")
    self.tree.grid(row=1, column=0, columnspan=4, sticky="nsew")
    self.tree_scroll = Scrollbar(root, orient="vertical", command=self.tree.yview)
    self.tree_scroll.grid(row=1, column=4, sticky="ns")
    self.tree.configure(yscrollcommand=self.tree_scroll.set)

    # Buttons
    self.add_btn = Button(root, text="Ajouter", command=self.add_row)
    self.add_btn.grid(row=2, column=0, padx=5, pady=5)
    self.edit_btn = Button(root, text="Editer", command=self.edit_row)
    self.edit_btn.grid(row=2, column=1, padx=5, pady=5)
    self.delete_btn = Button(root, text="Supprimer", command=self.delete_row)
    self.delete_btn.grid(row=2, column=2, padx=5, pady=5)

    # Zone de logs
    self.log_box = Text(root, height=6, width=80)
    self.log_box.grid(row=3, column=0, columnspan=5, padx=5, pady=5)

    # Grille expansion
    root.grid_rowconfigure(1, weight=1)
    root.grid_columnconfigure(3, weight=1)

  def log(self, message: str) -> None:
    """Ajoute un message dans la zone de logs"""
    self.log_box.insert(END, message + "\n")
    self.log_box.see(END)
  
  def open_db(self) -> None:
    """Ouvre une base SQLie et charge les tables"""
    db_path = filedialog.askopenfilename(title="Choisir un fichier DB", filetypes=[("SQLite DB", "*.db")])
    if not db_path:
      return
    try:
      self.conn = sqlite3.connect(db_path)
      self.cursor = self.conn.cursor()
      self.log(f"Base ouverte : {db_path}")
      # Charger les tables
      self.cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
      tables = [row[0] for row in self.cursor.fetchall()]
      self.table_combo['values'] = tables
      self.log(f"Table trouvées : {tables}")
      if tables:
        self.table_combo.current(0)
        self.load_table()
    except Exception as e:
      self.log(f"Erreur ouverture DB : {e}")
      messagebox.showerror("Erreur", str(e))


  def load_table(self, event: Optional[object] = None) -> None:
    """
    Charge la table sélectionnée dans le Treeview et applique une couleur
    par cellule :
      - Bleu clair pour les clés primaires
      - Vert clair pour les clés étrangères
      - Blanc pour les autres colonnes

    Args:
      event: Optionnel, événement Tkinter déclencheur (ex: sélection combobox)
    """
    if not self.cursor:
      return

    self.current_table = self.table_combo.get()
    if not self.current_table:
      return

    # --- Récupération des colonnes et des informations PK/FK ---
    try:
      # Colonnes + PK
      self.cursor.execute(f"PRAGMA table_info({self.current_table})")
      columns_info = self.cursor.fetchall()
      columns = [col[1] for col in columns_info]
      pk_columns = [col[1] for col in columns_info if col[5]]  # col[5] = pk

      # Clés étrangères
      self.cursor.execute(f"PRAGMA foreign_key_list({self.current_table})")
      fk_info = self.cursor.fetchall()
      fk_columns = [col[3] for col in fk_info]  # col[3] = from
    except Exception as e:
      self.log(f"Erreur récupération info table : {e}")
      return

    # --- Configuration du Treeview ---
    self.tree.delete(*self.tree.get_children())
    self.tree["columns"] = columns
    for col in columns:
      self.tree.heading(col, text=col)
      self.tree.column(col, width=120)

    # --- Récupération des lignes ---
    try:
      self.cursor.execute(f"SELECT * FROM {self.current_table}")
      rows = self.cursor.fetchall()
      for row in rows:
        # On insère la ligne et on applique un tag "row" pour manipulations futures
        item_id = self.tree.insert("", END, values=row)
        
        # Coloration cellule par cellule via tags
        for idx, col in enumerate(columns):
          if col in pk_columns:
            self.tree.set(item_id, col, row[idx])
            self.tree.tag_configure(f"pk_{col}", background="#d0e7ff")
            self.tree.item(item_id, tags=(f"pk_{col}",))
          elif col in fk_columns:
            self.tree.set(item_id, col, row[idx])
            self.tree.tag_configure(f"fk_{col}", background="#d0ffd6")
            self.tree.item(item_id, tags=(f"fk_{col}",))
          else:
            self.tree.set(item_id, col, row[idx])
            self.tree.tag_configure(f"normal_{col}", background="white")
            self.tree.item(item_id, tags=(f"normal_{col}",))
      self.log(f"{len(rows)} lignes chargées de {self.current_table}")
    except Exception as e:
      self.log(f"Erreur récupération lignes : {e}")

  def load_table_old(self, event=None) -> None:
    """Charge la table sélectionnée dans le Treeview"""
    if not self.cursor:
      return
    self.current_table = self.table_combo.get()
    if not self.current_table:
      return

    # Récupération colonnes et type PK/FK
    try:
      self.cursor.execute(f"PRAGMA table_info({self.current_table})")
      columns_info = self.cursor.fetchall()
      columns = [col[1] for col in columns_info]
      pk_columns = [col[1] for col in columns_info if col[5]]  # col[5] = pk
      self.cursor.execute(f"PRAGMA foreign_key_list({self.current_table})")
      fk_info = self.cursor.fetchall()
      fk_columns = [col[3] for col in fk_info]  # col[3] = from
    except Exception as e:
      self.log(f"Erreur récupération info table : {e}")
      return

    # Configurer colonnes Treeview
    self.tree.delete(*self.tree.get_children())
    self.tree["columns"] = columns
    for col in columns:
      self.tree.heading(col, text=col)
      self.tree.column(col, width=120)

    # Récupérer les lignes
    try:
      self.cursor.execute(f"SELECT * FROM {self.current_table}")
      rows = self.cursor.fetchall()
      for row in rows:
        self.tree.insert("", END, values=row)
      self.log(f"{len(rows)} lignes chargées de {self.current_table}")
    except Exception as e:
      self.log(f"Erreur récupération lignes : {e}")

    # Colorer PK / FK
    for item in self.tree.get_children():
      values = self.tree.item(item)["values"]
      tags = []
      for idx, col in enumerate(columns):
        if col in pk_columns:
          tags.append("pk")
        elif col in fk_columns:
          tags.append("fk")
        else:
          tags.append("normal")
      self.tree.item(item, tags=tags)

    self.tree.tag_configure("pk", background="#d0e7ff")
    self.tree.tag_configure("fk", background="#d0ffd6")
    self.tree.tag_configure("normal", background="white")

  def add_row(self) -> None:
    """Ajoute une ligne via pop-up"""
    if not self.current_table or not self.cursor:
      return
    self.edit_popup([], is_new=True)

  def edit_row(self) -> None:
    """Editer une ligne sélectionnée"""
    if not self.current_table or not self.cursor:
      return
    selected = self.tree.selection()
    if not selected:
      self.log("Aucune ligne sélectionné pour éditer")
      return
    values = self.tree.item(selected[0])["values"]
    self.edit_popup(values, is_new=False, tree_item=selected[0])

  def delete_row(self) -> None:
    """Supprimer une ligne sélectionnée"""
    if not self.current_table or not self.cursor:
      return
    selected = self.tree.selection()
    if not selected:
      self.log("Aucune ligne sélectionnée pour supprimer")
      return
    confirm = messagebox.askyesno("Confirmer", "Voulez-vous vraiment supprimer cette ligne ?")
    if not confirm:
      return

    # Suppression basée sur la clé primaire
    try:
      self.cursor.execute(f"PRAGMA table_info({self.current_table})")
      columns_info = self.cursor.fetchall()
      pk_columns = [col[1] for col in columns_info if col[5]]
      if not pk_columns:
        self.log("Impossible de supprimer : aucune clé primaire détectée")
        return
      row_values = self.tree.item(selected[0])["values"]
      where_clause = " AND ".join(f"{pk} = ?" for pk in pk_columns)
      pk_values = [row_values[columns_info.index(col)][1] if False else row_values[columns_info.index(col)] for col in pk_columns]
      pk_values = [row_values[columns_info.index(col)] for col in pk_columns]
      self.cursor.execute(f"DELETE FROM {self.current_table} WHERE {where_clause}", pk_values)
      self.conn.commit()
      self.tree.delete(selected[0])
      self.log("Ligne supprimée avec succès")
    except Exception as e:
      self.log(f"Erreur suppression : {e}")

  def edit_popup(self, values: List[Any], is_new: bool, tree_item=None) -> None:
    """Pop-up pour éditer ou ajouter une ligne"""
    popup = Toplevel(self.root)
    popup.title("Ajouter" if is_new else "Editer")
    entries = []
    self.cursor.execute(f"PRAGMA table_info({self.current_table})")
    columns_info = self.cursor.fetchall()
    columns = [col[1] for col in columns_info]
    for idx, col in enumerate(columns):
      Label(popup, text=col).grid(row=idx, column=0, padx=5, pady=5)
      entry = Entry(popup)
      entry.grid(row=idx, column=1, padx=5, pady=5)
      if not is_new and values:
          entry.insert(0, values[idx])
      entries.append(entry)

    def save_action() -> None:
      new_values = [e.get() for e in entries]
      try:
        if is_new:
          placeholders = ", ".join("?" for _ in columns)
          self.cursor.execute(f"INSERT INTO {self.current_table} ({','.join(columns)}) VALUES ({placeholders})", new_values)
          self.conn.commit()
          self.load_table()
          self.log("Nouvelle ligne ajoutée")
        else:
          pk_columns = [col[1] for col in columns_info if col[5]]
          where_clause = " AND ".join(f"{pk} = ?" for pk in pk_columns)
          pk_values = [values[columns.index(pk)] for pk in pk_columns]
          set_clause = ", ".join(f"{col} = ?" for col in columns)
          self.cursor.execute(f"UPDATE {self.current_table} SET {set_clause} WHERE {where_clause}", new_values + pk_values)
          self.conn.commit()
          self.load_table()
          self.log("Ligne modifiée")
        popup.destroy()
      except Exception as e:
        self.log(f"Erreur sauvegarde : {e}")

    Button(popup, text="Save", command=save_action).grid(row=len(columns), column=0, columnspan=2, pady=10)


if __name__ == "__main__":
  root = Tk()
  app = SQLiteEditor(root)
  root.mainloop()