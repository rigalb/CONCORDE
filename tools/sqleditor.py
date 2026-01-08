#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
SQLite Database Editor

Ce module fournit une interface graphique pour éditer des bases de données SQLite
avec une visualisation colorée des clés primaires et étrangères.
"""

import sqlite3
from tkinter import (
  Tk, Button, Label, Entry, Text, Toplevel, 
  Scrollbar, Canvas, Frame, END, messagebox, filedialog
)
from tkinter.ttk import Combobox
from typing import Optional, List, Tuple, Any, Dict


class CellColoredTable(Frame):
  """
  Widget personnalisé de table avec coloration cellule par cellule.
  
  Ce widget utilise un Canvas pour dessiner une table avec un contrôle total
  sur la couleur de chaque cellule individuellement.
  
  Attributes:
    canvas (Canvas): Canvas principal pour le rendu de la table
    vsb (Scrollbar): Scrollbar vertical
    hsb (Scrollbar): Scrollbar horizontal
    data (List[Tuple]): Données des lignes de la table
    columns (List[str]): Noms des colonnes
    cell_colors (Dict[Tuple[int, str], str]): Couleurs par cellule (ligne, colonne) -> couleur
    cell_width (int): Largeur d'une cellule en pixels
    cell_height (int): Hauteur d'une cellule en pixels
    header_height (int): Hauteur de l'en-tête en pixels
  """
  
  def __init__(self, parent: Frame, **kwargs) -> None:
    """
    Initialise le widget de table colorée.
    
    Args:
      parent: Widget parent Tkinter
      **kwargs: Arguments supplémentaires pour Frame
    """
    Frame.__init__(self, parent, **kwargs)
    
    # Scrollbars
    self.vsb = Scrollbar(self, orient="vertical")
    self.hsb = Scrollbar(self, orient="horizontal")
    
    # Canvas pour dessiner les cellules
    self.canvas = Canvas(
      self, 
      yscrollcommand=self.vsb.set,
      xscrollcommand=self.hsb.set,
      bg='white',
      highlightthickness=0
    )
    
    self.vsb.config(command=self.canvas.yview)
    self.hsb.config(command=self.canvas.xview)
    
    # Layout
    self.canvas.grid(row=0, column=0, sticky='nsew')
    self.vsb.grid(row=0, column=1, sticky='ns')
    self.hsb.grid(row=1, column=0, sticky='ew')
    
    self.grid_rowconfigure(0, weight=1)
    self.grid_columnconfigure(0, weight=1)
    
    # Données
    self.data: List[Tuple] = []
    self.columns: List[str] = []
    self.cell_colors: Dict[Tuple[int, str], str] = {}
    
    # Dimensions
    self.cell_width = 150
    self.cell_height = 25
    self.header_height = 30
    
    # Callback pour la sélection
    self.on_row_select_callback: Optional[callable] = None
    self.selected_row: Optional[int] = None
    
    # Bindings
    self.canvas.bind('<Button-1>', self._on_click)
    self.canvas.bind('<Configure>', self._on_resize)
  
  def set_data(
    self, 
    columns: List[str], 
    rows: List[Tuple], 
    cell_colors: Optional[Dict[Tuple[int, str], str]] = None
  ) -> None:
    """
    Configure les données de la table et les couleurs des cellules.
    
    Args:
      columns: Liste des noms de colonnes
      rows: Liste des tuples de données (une par ligne)
      cell_colors: Dictionnaire optionnel {(row_idx, col_name): color_hex}
    """
    self.columns = columns
    self.data = rows
    self.cell_colors = cell_colors or {}
    self.selected_row = None
    self.draw_table()
  
  def draw_table(self) -> None:
    """Dessine la table complète avec en-têtes et cellules."""
    self.canvas.delete('all')
    
    if not self.columns or not self.data:
      return
    
    # Dessiner l'en-tête
    for j, col in enumerate(self.columns):
      x = j * self.cell_width
      y = 0
      
      # Fond de l'en-tête
      self.canvas.create_rectangle(
        x, y, x + self.cell_width, y + self.header_height,
        fill='#4a90e2', outline='#2c5aa0', width=1,
        tags='header'
      )
      
      # Texte de l'en-tête
      self.canvas.create_text(
        x + self.cell_width/2, y + self.header_height/2,
        text=str(col), fill='white', 
        font=('Arial', 10, 'bold'),
        tags='header'
      )
    
    # Dessiner les cellules de données
    for i, row in enumerate(self.data):
      for j, col in enumerate(self.columns):
        x = j * self.cell_width
        y = self.header_height + i * self.cell_height
        
        # Déterminer la couleur de base
        color = self.cell_colors.get((i, col), '#ffffff')
        
        # Si la ligne est sélectionnée, modifier légèrement la couleur
        if i == self.selected_row:
          color = self._darken_color(color)
        
        # Fond de la cellule
        self.canvas.create_rectangle(
          x, y, x + self.cell_width, y + self.cell_height,
          fill=color, outline='#cccccc', width=1,
          tags=('cell', f'cell_{i}_{j}', f'row_{i}')
        )
        
        # Texte de la cellule
        value = row[j] if j < len(row) else ''
        self.canvas.create_text(
          x + 5, y + self.cell_height/2,
          text=str(value), anchor='w', 
          font=('Arial', 9),
          tags=('text', f'text_{i}_{j}', f'row_{i}')
        )
    
    # Mettre à jour la zone de scroll
    total_width = len(self.columns) * self.cell_width
    total_height = self.header_height + len(self.data) * self.cell_height
    self.canvas.config(scrollregion=(0, 0, total_width, total_height))
  
  def _darken_color(self, hex_color: str, factor: float = 0.9) -> str:
    """
    Assombrit une couleur hexadécimale.
    
    Args:
      hex_color: Couleur au format hexadécimal (#RRGGBB)
      factor: Facteur d'assombrissement (0.0 à 1.0)
        
    Returns:
      Couleur assombrie au format hexadécimal
    """
    hex_color = hex_color.lstrip('#')
    r, g, b = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
    r, g, b = int(r * factor), int(g * factor), int(b * factor)
    return f'#{r:02x}{g:02x}{b:02x}'
  
  def _on_click(self, event) -> None:
    """
    Gestionnaire de clic sur la table.
    
    Args:
      event: Événement Tkinter de clic
    """
    x = self.canvas.canvasx(event.x)
    y = self.canvas.canvasy(event.y)
    
    if y < self.header_height:
      return  # Clic sur l'en-tête
    
    col_idx = int(x // self.cell_width)
    row_idx = int((y - self.header_height) // self.cell_height)
    
    if 0 <= row_idx < len(self.data) and 0 <= col_idx < len(self.columns):
      self.selected_row = row_idx
      self.draw_table()
      
      if self.on_row_select_callback:
        self.on_row_select_callback(row_idx, self.data[row_idx])
  
  def _on_resize(self, event) -> None:
    """
    Gestionnaire de redimensionnement.
    
    Args:
      event: Événement Tkinter de redimensionnement
    """
    pass
  
  def get_selected_row(self) -> Optional[Tuple[int, Tuple]]:
    """
    Récupère la ligne sélectionnée.
    
    Returns:
      Tuple (index, données) ou None si aucune sélection
    """
    if self.selected_row is not None:
      return (self.selected_row, self.data[self.selected_row])
    return None
  
  def refresh(self) -> None:
    """Rafraîchit l'affichage de la table."""
    self.draw_table()


class SQLiteEditor:
  """
  Éditeur graphique de bases de données SQLite avec visualisation colorée.
  
  Permet d'ouvrir, visualiser et éditer des bases SQLite avec une coloration
  automatique des clés primaires (bleu) et étrangères (vert).
  
  Attributes:
    root (Tk): Fenêtre principale Tkinter
    conn (Optional[sqlite3.Connection]): Connexion à la base de données
    cursor (Optional[sqlite3.Cursor]): Curseur pour les requêtes
    current_table (Optional[str]): Nom de la table actuellement affichée
  """
  
  def __init__(self, root: Tk) -> None:
    """
    Initialise l'éditeur SQLite.
    
    Args:
      root: Fenêtre principale Tkinter
    """
    self.root = root
    self.root.title("SQLite DB Editor - Coloration Cellulaire")
    self.root.geometry("1200x700")
    
    self.conn: Optional[sqlite3.Connection] = None
    self.cursor: Optional[sqlite3.Cursor] = None
    self.current_table: Optional[str] = None
    
    self._build_ui()
  
  def _build_ui(self) -> None:
    """Construit l'interface utilisateur."""
    # Frame du haut pour les contrôles
    top_frame = Frame(self.root, bg='#f0f0f0', height=60)
    top_frame.grid(row=0, column=0, columnspan=5, sticky='ew', padx=5, pady=5)
    top_frame.grid_propagate(False)
    
    # Bouton ouvrir DB
    self.open_btn = Button(
      top_frame, text="Ouvrir DB", 
      command=self.open_db,
      bg='#4a90e2', fg='white', font=('Arial', 10)
    )
    self.open_btn.pack(side='left', padx=5, pady=10)
    
    # Label et combobox pour sélection table
    Label(
      top_frame, text="Table:", 
      bg='#f0f0f0', font=('Arial', 10)
    ).pack(side='left', padx=5)
    
    self.table_combo = Combobox(top_frame, state="readonly", width=30)
    self.table_combo.pack(side='left', padx=5)
    self.table_combo.bind("<<ComboboxSelected>>", self.load_table)
    
    # Légende
    legend_frame = Frame(top_frame, bg='#f0f0f0')
    legend_frame.pack(side='right', padx=20)
    
    self._create_legend_item(legend_frame, "PK", '#d0e7ff')
    self._create_legend_item(legend_frame, "FK", '#d0ffd6')
    self._create_legend_item(legend_frame, "Normal", '#ffffff')
    
    # Table colorée personnalisée
    self.table = CellColoredTable(self.root)
    self.table.grid(row=1, column=0, columnspan=5, sticky='nsew', padx=5, pady=5)
    self.table.on_row_select_callback = self._on_row_selected
    
    # Boutons d'action
    button_frame = Frame(self.root, bg='#f0f0f0')
    button_frame.grid(row=2, column=0, columnspan=5, sticky='ew', padx=5, pady=5)
    
    self.add_btn = Button(
      button_frame, text="Ajouter", 
      command=self.add_row,
      bg='#28a745', fg='white', font=('Arial', 10)
    )
    self.add_btn.pack(side='left', padx=5)
    
    self.edit_btn = Button(
      button_frame, text="Éditer", 
      command=self.edit_row,
      bg='#ffc107', fg='black', font=('Arial', 10)
    )
    self.edit_btn.pack(side='left', padx=5)
    
    self.delete_btn = Button(
      button_frame, text="Supprimer", 
      command=self.delete_row,
      bg='#dc3545', fg='white', font=('Arial', 10)
    )
    self.delete_btn.pack(side='left', padx=5)
    
    # Zone de logs
    Label(self.root, text="Logs:", font=('Arial', 9, 'bold')).grid(
      row=3, column=0, sticky='w', padx=5
    )
    
    self.log_box = Text(self.root, height=6, width=80, font=('Courier', 9))
    self.log_box.grid(row=4, column=0, columnspan=5, sticky='ew', padx=5, pady=5)
    
    log_scroll = Scrollbar(self.root, orient='vertical', command=self.log_box.yview)
    log_scroll.grid(row=4, column=5, sticky='ns')
    self.log_box.config(yscrollcommand=log_scroll.set)
    
    # Configuration de l'expansion
    self.root.grid_rowconfigure(1, weight=1)
    self.root.grid_columnconfigure(0, weight=1)
  
  def _create_legend_item(self, parent: Frame, label: str, color: str) -> None:
    """
    Crée un élément de légende coloré.
    
    Args:
      parent: Widget parent
      label: Texte de la légende
      color: Couleur hexadécimale
    """
    frame = Frame(parent, bg='#f0f0f0')
    frame.pack(side='left', padx=5)
    
    canvas = Canvas(
      frame, width=20, height=20, bg=color, 
      highlightthickness=1, highlightbackground='#888'
    )
    canvas.pack(side='left', padx=2)
    
    Label(
      frame, text=label, 
      bg='#f0f0f0', font=('Arial', 9)
    ).pack(side='left')
  
  def _on_row_selected(self, row_idx: int, row_data: Tuple) -> None:
    """
    Callback appelé lors de la sélection d'une ligne.
    
    Args:
      row_idx: Index de la ligne sélectionnée
      row_data: Données de la ligne
    """
    self.log(f"Ligne {row_idx} sélectionnée: {row_data}")
  
  def log(self, message: str) -> None:
    """
    Ajoute un message dans la zone de logs avec horodatage.
    
    Args:
      message: Message à logger
    """
    from datetime import datetime
    timestamp = datetime.now().strftime("%H:%M:%S")
    self.log_box.insert(END, f"[{timestamp}] {message}\n")
    self.log_box.see(END)
  
  def open_db(self) -> None:
    """Ouvre une base de données SQLite via un dialogue de fichier."""
    db_path = filedialog.askopenfilename(
      title="Choisir un fichier DB", 
      filetypes=[("SQLite DB", "*.db"), ("Tous les fichiers", "*.*")]
    )
    if not db_path:
      return
    
    try:
      # Fermer la connexion précédente si elle existe
      if self.conn:
        self.conn.close()
      
      self.conn = sqlite3.connect(db_path)
      self.cursor = self.conn.cursor()
      self.log(f"[OK] Base ouverte: {db_path}")
      
      # Charger les tables
      self.cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
      )
      tables = [row[0] for row in self.cursor.fetchall()]
      self.table_combo['values'] = tables
      self.log(f"[OK] Tables trouvées: {', '.join(tables)}")
      
      if tables:
        self.table_combo.current(0)
        self.load_table()
    except Exception as e:
      self.log(f"[KO] Erreur ouverture DB: {e}")
      messagebox.showerror("Erreur", str(e))
  
  def load_table(self, event: Optional[object] = None) -> None:
    """
    Charge la table sélectionnée avec coloration cellulaire.
    
    Applique les couleurs suivantes:
    - Bleu clair (#d0e7ff) pour les clés primaires
    - Vert clair (#d0ffd6) pour les clés étrangères  
    - Blanc (#ffffff) pour les colonnes normales
    
    Args:
      event: Événement optionnel de sélection (combobox)
    """
    if not self.cursor:
      return
    
    self.current_table = self.table_combo.get()
    if not self.current_table:
      return
    
    try:
      # Récupération des informations de colonnes
      self.cursor.execute(f"PRAGMA table_info({self.current_table})")
      columns_info = self.cursor.fetchall()
      columns = [col[1] for col in columns_info]
      pk_columns = {col[1] for col in columns_info if col[5]}  # col[5] = pk
      
      # Récupération des clés étrangères
      self.cursor.execute(f"PRAGMA foreign_key_list({self.current_table})")
      fk_info = self.cursor.fetchall()
      fk_columns = {col[3] for col in fk_info}  # col[3] = from
      
      # Récupération des données
      self.cursor.execute(f"SELECT * FROM {self.current_table}")
      rows = self.cursor.fetchall()
      
      # Construction du dictionnaire de couleurs par cellule
      cell_colors: Dict[Tuple[int, str], str] = {}
      for i in range(len(rows)):
        for col in columns:
          if col in pk_columns:
            color = '#d0e7ff'  # Bleu clair pour PK
          elif col in fk_columns:
            color = '#d0ffd6'  # Vert clair pour FK
          else:
            color = '#ffffff'  # Blanc pour colonnes normales
          cell_colors[(i, col)] = color
      
      # Affichage dans la table
      self.table.set_data(columns, rows, cell_colors)
      self.log(f"[OK] {len(rows)} lignes chargées de '{self.current_table}'")
      
      # Mise à jour du titre
      self.root.title(
        f"SQLite DB Editor - {self.current_table} ({len(rows)} lignes)"
      )
        
    except Exception as e:
      self.log(f"[KO] Erreur chargement table: {e}")
      messagebox.showerror("Erreur", str(e))
  
  def add_row(self) -> None:
    """Ouvre un dialogue pour ajouter une nouvelle ligne."""
    if not self.current_table or not self.cursor:
      self.log("[WARN] Aucune table sélectionnée")
      return
    self._edit_popup([], is_new=True)
  
  def edit_row(self) -> None:
    """Ouvre un dialogue pour éditer la ligne sélectionnée."""
    if not self.current_table or not self.cursor:
      self.log("[WARN] Aucune table sélectionnée")
      return
    
    selected = self.table.get_selected_row()
    if not selected:
      self.log("[WARN] Aucune ligne sélectionnée pour édition")
      messagebox.showwarning("Attention", "Veuillez sélectionner une ligne")
      return
    
    row_idx, values = selected
    self._edit_popup(values, is_new=False)
  
  def delete_row(self) -> None:
      """Supprime la ligne sélectionnée après confirmation."""
      if not self.current_table or not self.cursor:
          self.log("[WARN] Aucune table sélectionnée")
          return
      
      selected = self.table.get_selected_row()
      if not selected:
          self.log("[WARN] Aucune ligne sélectionnée pour suppression")
          messagebox.showwarning("Attention", "Veuillez sélectionner une ligne")
          return
      
      confirm = messagebox.askyesno(
          "Confirmer", 
          "Voulez-vous vraiment supprimer cette ligne ?"
      )
      if not confirm:
          return
      
      try:
          # Récupération des informations de clé primaire
          self.cursor.execute(f"PRAGMA table_info({self.current_table})")
          columns_info = self.cursor.fetchall()
          columns = [col[1] for col in columns_info]
          pk_columns = [col[1] for col in columns_info if col[5]]
          
          if not pk_columns:
              self.log("[KO] Impossible de supprimer: aucune clé primaire")
              messagebox.showerror(
                  "Erreur", 
                  "Cette table n'a pas de clé primaire définie"
              )
              return
          
          # Construction de la clause WHERE
          row_idx, row_values = selected
          where_clause = " AND ".join(f"{pk} = ?" for pk in pk_columns)
          pk_values = [row_values[columns.index(pk)] for pk in pk_columns]
          
          # Suppression
          self.cursor.execute(
              f"DELETE FROM {self.current_table} WHERE {where_clause}", 
              pk_values
          )
          self.conn.commit()
          
          # Rechargement de la table
          self.load_table()
          self.log(f"[OK] Ligne supprimée avec succès")
          
      except Exception as e:
          self.log(f"[KO] Erreur suppression: {e}")
          messagebox.showerror("Erreur", str(e))
  
  def _edit_popup(self, values: List[Any], is_new: bool) -> None:
    """
    Affiche un dialogue pour ajouter ou éditer une ligne.
    
    Args:
      values: Valeurs actuelles (vide si nouvelle ligne)
      is_new: True pour ajout, False pour édition
    """
    popup = Toplevel(self.root)
    popup.title("Ajouter une ligne" if is_new else "Éditer la ligne")
    popup.geometry("400x500")
    
    # Récupération des colonnes
    self.cursor.execute(f"PRAGMA table_info({self.current_table})")
    columns_info = self.cursor.fetchall()
    columns = [col[1] for col in columns_info]
    
    # Création des champs
    entries: List[Entry] = []
    for idx, col in enumerate(columns):
      Label(
        popup, text=f"{col}:", 
        font=('Arial', 10)
      ).grid(row=idx, column=0, padx=10, pady=5, sticky='e')
      
      entry = Entry(popup, width=30, font=('Arial', 10))
      entry.grid(row=idx, column=1, padx=10, pady=5, sticky='w')
      
      if not is_new and values and idx < len(values):
        entry.insert(0, str(values[idx]))
      
      entries.append(entry)
    
    def save_action() -> None:
      """Sauvegarde les modifications ou l'ajout."""
      new_values = [e.get() for e in entries]
      
      try:
        if is_new:
          # INSERT
          placeholders = ", ".join("?" for _ in columns)
          self.cursor.execute(
            f"INSERT INTO {self.current_table} "
            f"({','.join(columns)}) VALUES ({placeholders})", 
            new_values
          )
          self.conn.commit()
          self.log(f"[OK] Nouvelle ligne ajoutée dans '{self.current_table}'")
        else:
          # UPDATE
          pk_columns = [col[1] for col in columns_info if col[5]]
          if not pk_columns:
            raise ValueError("Aucune clé primaire pour l'UPDATE")
          
          where_clause = " AND ".join(f"{pk} = ?" for pk in pk_columns)
          pk_values = [values[columns.index(pk)] for pk in pk_columns]
          set_clause = ", ".join(f"{col} = ?" for col in columns)
          
          self.cursor.execute(
            f"UPDATE {self.current_table} SET {set_clause} "
            f"WHERE {where_clause}", 
            new_values + pk_values
          )
          self.conn.commit()
          self.log(f"[OK] Ligne modifiée dans '{self.current_table}'")
      
        # Rechargement et fermeture
        self.load_table()
        popup.destroy()
          
      except Exception as e:
        self.log(f"[KO] Erreur sauvegarde: {e}")
        messagebox.showerror("Erreur", str(e))
    
    # Boutons
    btn_frame = Frame(popup)
    btn_frame.grid(row=len(columns), column=0, columnspan=2, pady=20)
    
    Button(
      btn_frame, text="Enregistrer", 
      command=save_action,
      bg='#28a745', fg='white', 
      font=('Arial', 10), width=12
    ).pack(side='left', padx=5)
    
    Button(
      btn_frame, text="Annuler",
      command=popup.destroy,
      bg='#6c757d', fg='white', 
      font=('Arial', 10), width=12
    ).pack(side='left', padx=5)


if __name__ == "__main__":
  root = Tk()
  app = SQLiteEditor(root)
  root.mainloop()