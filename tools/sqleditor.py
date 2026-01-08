#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
SQLite Database Editor Pro - Version Ultimate
Éditeur professionnel avec l'ensemble complet des fonctionnalités
"""
import sqlite3
import json
import csv
import os
import re
import shutil
from datetime import datetime
from tkinter import (
  Tk, Button, Label, Entry, Text, Toplevel, Scrollbar, Canvas, Frame,
  END, messagebox, filedialog, Menu, StringVar, BooleanVar, IntVar, 
  Checkbutton, Scale, HORIZONTAL, VERTICAL, Listbox
)
from tkinter.ttk import Combobox, Notebook, Progressbar, Treeview
from typing import Optional, List, Tuple, Any, Dict, Set
from collections import deque
import threading
import time


class UndoRedoManager:
  """Gestionnaire d'historique pour Undo/Redo."""
  def __init__(self, max_size: int = 100):
    self.undo_stack: deque = deque(maxlen=max_size)
    self.redo_stack: deque = deque(maxlen=max_size)
  
  def add_action(self, action: Dict[str, Any]) -> None:
    self.undo_stack.append(action)
    self.redo_stack.clear()
  
  def can_undo(self) -> bool:
    return len(self.undo_stack) > 0
  
  def can_redo(self) -> bool:
    return len(self.redo_stack) > 0
  
  def undo(self) -> Optional[Dict[str, Any]]:
    if self.can_undo():
      action = self.undo_stack.pop()
      self.redo_stack.append(action)
      return action
    return None
  
  def redo(self) -> Optional[Dict[str, Any]]:
    if self.can_redo():
      action = self.redo_stack.pop()
      self.undo_stack.append(action)
      return action
    return None


class ThemeManager:
  """Gestionnaire de thèmes avec personnalisation."""
  THEMES = {
    'light': {
      'bg': '#ffffff', 'fg': '#000000', 'header_bg': '#4a90e2',
      'header_fg': '#ffffff', 'selected_bg': '#e3f2fd', 'border': '#cccccc',
      'pk_color': '#d0e7ff', 'fk_color': '#d0ffd6', 'normal_color': '#ffffff',
      'toolbar_bg': '#f0f0f0', 'button_bg': '#4a90e2', 'button_fg': '#ffffff',
      'modified_bg': '#fff3cd', 'null_fg': '#999999', 'negative_fg': '#dc3545'
    },
    'dark': {
      'bg': '#2b2b2b', 'fg': '#e0e0e0', 'header_bg': '#1e3a5f',
      'header_fg': '#ffffff', 'selected_bg': '#3a3a3a', 'border': '#555555',
      'pk_color': '#1a3d5f', 'fk_color': '#1a4d2e', 'normal_color': '#2b2b2b',
      'toolbar_bg': '#1e1e1e', 'button_bg': '#1e3a5f', 'button_fg': '#ffffff',
      'modified_bg': '#4a4020', 'null_fg': '#777777', 'negative_fg': '#ff6b6b'
    },
    'high_contrast': {
      'bg': '#000000', 'fg': '#ffffff', 'header_bg': '#0000ff',
      'header_fg': '#ffff00', 'selected_bg': '#0000ff', 'border': '#ffffff',
      'pk_color': '#000080', 'fk_color': '#008000', 'normal_color': '#000000',
      'toolbar_bg': '#000000', 'button_bg': '#0000ff', 'button_fg': '#ffff00',
      'modified_bg': '#808000', 'null_fg': '#808080', 'negative_fg': '#ff0000'
    }
  }
  
  def __init__(self):
    self.current_theme = 'light'
    self.custom_colors = {}
  
  def get_theme(self) -> Dict[str, str]:
    theme = self.THEMES[self.current_theme].copy()
    theme.update(self.custom_colors)
    return theme
  
  def set_theme(self, theme_name: str) -> None:
    if theme_name in self.THEMES:
      self.current_theme = theme_name
  
  def toggle_theme(self) -> None:
    themes = list(self.THEMES.keys())
    idx = themes.index(self.current_theme)
    self.current_theme = themes[(idx + 1) % len(themes)]
  
  def customize_color(self, key: str, color: str) -> None:
    self.custom_colors[key] = color


class QueryHistoryManager:
  """Gestionnaire d'historique et favoris de requêtes."""
  def __init__(self, max_history: int = 100):
    self.history: deque = deque(maxlen=max_history)
    self.favorites: List[Dict[str, str]] = []
  
  def add_query(self, query: str, result_count: int = 0, execution_time: float = 0.0) -> None:
    self.history.append({
      'query': query,
      'timestamp': datetime.now().isoformat(),
      'result_count': result_count,
      'execution_time': execution_time
    })
  
  def add_favorite(self, name: str, query: str, description: str = "") -> None:
    self.favorites.append({
      'name': name,
      'query': query,
      'description': description
    })
  
  def get_history(self) -> List[Dict]:
    return list(self.history)
  
  def get_favorites(self) -> List[Dict]:
    return self.favorites


class AdvancedTable(Frame):
  """Table avancée avec toutes les fonctionnalités."""
  def __init__(self, parent: Frame, theme_manager: ThemeManager, **kwargs):
    Frame.__init__(self, parent, **kwargs)
    
    self.theme_manager = theme_manager
    self.vsb = Scrollbar(self, orient="vertical")
    self.hsb = Scrollbar(self, orient="horizontal")
    
    self.canvas = Canvas(
      self, yscrollcommand=self.vsb.set, xscrollcommand=self.hsb.set,
      highlightthickness=0
    )
    
    self.vsb.config(command=self.canvas.yview)
    self.hsb.config(command=self.canvas.xview)
    
    self.canvas.grid(row=0, column=0, sticky='nsew')
    self.vsb.grid(row=0, column=1, sticky='ns')
    self.hsb.grid(row=1, column=0, sticky='ew')
    
    self.grid_rowconfigure(0, weight=1)
    self.grid_columnconfigure(0, weight=1)
    
    # Données
    self.all_data: List[Tuple] = []
    self.filtered_data: List[Tuple] = []
    self.displayed_data: List[Tuple] = []
    self.columns: List[str] = []
    self.cell_colors: Dict[Tuple[int, str], str] = {}
    self.column_widths: Dict[str, int] = {}
    self.modified_cells: Set[Tuple[int, str]] = set()
    self.frozen_columns: int = 0
    
    # Pagination
    self.page_size = 100
    self.current_page = 0
    self.total_pages = 0
    
    # Tri
    self.sort_column: Optional[str] = None
    self.sort_reverse = False
    
    # Filtres
    self.filters: Dict[str, str] = {}
    self.column_filters: Dict[str, Entry] = {}
    
    # Dimensions
    self.default_cell_width = 150
    self.cell_height = 25
    self.header_height = 30
    self.filter_height = 25
    self.zoom_level = 1.0
    
    # Sélection
    self.selected_row: Optional[int] = None
    self.selected_cell: Optional[Tuple[int, str]] = None
    self.selected_cells: Set[Tuple[int, str]] = set()
    self.on_row_select_callback: Optional[callable] = None
    self.on_cell_edit_callback: Optional[callable] = None
    
    # Édition inline
    self.editing_cell: Optional[Tuple[int, str]] = None
    self.edit_entry: Optional[Entry] = None
    
    # Coloration conditionnelle
    self.conditional_formatting: List[Dict] = []
    
    # Bindings
    self.canvas.bind('<Button-1>', self._on_click)
    self.canvas.bind('<Double-Button-1>', self._on_double_click)
    self.canvas.bind('<Button-3>', self._on_right_click)
    self.canvas.bind('<Control-c>', self._copy_selection)
    self.canvas.bind('<Control-v>', self._paste_selection)
    self.canvas.bind('<Configure>', self._on_resize)
    
    # Drag pour redimensionner colonnes
    self.resize_column: Optional[str] = None
    self.resize_start_x: Optional[float] = None
    self.canvas.bind('<Motion>', self._on_mouse_move)
    self.canvas.bind('<ButtonRelease-1>', self._on_mouse_release)
    
    # Menu contextuel
    self.context_menu = Menu(self, tearoff=0)
    self.context_menu.add_command(label="Copier (Ctrl+C)", command=self._copy_selection)
    self.context_menu.add_command(label="Coller (Ctrl+V)", command=self._paste_selection)
    self.context_menu.add_command(label="Éditer", command=self._edit_selected)
    self.context_menu.add_separator()
    self.context_menu.add_command(label="Dupliquer ligne", command=self._duplicate_row)
    self.context_menu.add_command(label="Calculer statistiques", command=self._show_column_stats)
    self.context_menu.add_separator()
    self.context_menu.add_command(label="Figer colonne", command=self._freeze_column)
  
  def set_page_size(self, size: int) -> None:
    self.page_size = size
    self._update_pagination()
    self.draw_table()
  
  def set_zoom(self, factor: float) -> None:
    """Ajuste le niveau de zoom."""
    self.zoom_level *= factor
    self.cell_height = int(25 * self.zoom_level)
    self.header_height = int(30 * self.zoom_level)
    self.draw_table()
  
  def set_data(self, columns: List[str], rows: List[Tuple], 
              cell_colors: Optional[Dict[Tuple[int, str], str]] = None) -> None:
    self.columns = columns
    self.all_data = list(rows)
    self.cell_colors = cell_colors or {}
    
    for col in columns:
      if col not in self.column_widths:
        self.column_widths[col] = self.default_cell_width
    
    self._apply_filters()
    self._apply_sort()
    self._apply_conditional_formatting()
    self._update_pagination()
    self.draw_table()

  def _apply_conditional_formatting(self) -> None:
    """Applique la coloration conditionnelle."""
    theme = self.theme_manager.get_theme()
    for i, row in enumerate(self.all_data):
      for j, col in enumerate(self.columns):
        value = row[j] if j < len(row) else None
        
        # NULL en gris
        if value is None:
          continue
        
        # Valeurs négatives en rouge
        try:
          if isinstance(value, (int, float)) and value < 0:
            self.cell_colors[(i, col)] = theme.get('negative_bg', '#ffebee')
        except:
          pass

  def _apply_filters(self) -> None:
    if not self.filters:
      self.filtered_data = list(self.all_data)
      return
    
    self.filtered_data = []
    for row in self.all_data:
      match = True
      for col, filter_text in self.filters.items():
        if col not in self.columns:
          continue
        col_idx = self.columns.index(col)
        value = str(row[col_idx]).lower()
        
        # Support regex
        if filter_text.startswith('regex:'):
          pattern = filter_text[6:]
          try:
            if not re.search(pattern, value, re.IGNORECASE):
              match = False
              break
          except:
            match = False
            break
        elif filter_text.lower() not in value:
          match = False
          break
      if match:
        self.filtered_data.append(row)

  def _apply_sort(self) -> None:
    if not self.sort_column or self.sort_column not in self.columns:
      return
    
    col_idx = self.columns.index(self.sort_column)
    try:
      self.filtered_data.sort(
        key=lambda x: float(x[col_idx]) if x[col_idx] not in (None, '') else float('-inf'),
        reverse=self.sort_reverse
      )
    except (ValueError, TypeError):
      self.filtered_data.sort(
        key=lambda x: str(x[col_idx]).lower() if x[col_idx] is not None else '',
        reverse=self.sort_reverse
      )

  def _update_pagination(self) -> None:
    total_rows = len(self.filtered_data)
    self.total_pages = max(1, (total_rows + self.page_size - 1) // self.page_size)
    self.current_page = min(self.current_page, self.total_pages - 1)
    
    start_idx = self.current_page * self.page_size
    end_idx = min(start_idx + self.page_size, total_rows)
    self.displayed_data = self.filtered_data[start_idx:end_idx]
  
  def next_page(self) -> None:
    if self.current_page < self.total_pages - 1:
      self.current_page += 1
      self._update_pagination()
      self.draw_table()
  
  def prev_page(self) -> None:
    if self.current_page > 0:
      self.current_page -= 1
      self._update_pagination()
      self.draw_table()
  
  def goto_page(self, page: int) -> None:
    if 0 <= page < self.total_pages:
      self.current_page = page
      self._update_pagination()
      self.draw_table()
  
  def add_filter(self, column: str, text: str) -> None:
    if text:
      self.filters[column] = text
    elif column in self.filters:
      del self.filters[column]
    
    self._apply_filters()
    self._apply_sort()
    self._update_pagination()
    self.draw_table()
  
  def sort_by_column(self, column: str) -> None:
    if self.sort_column == column:
      self.sort_reverse = not self.sort_reverse
    else:
      self.sort_column = column
      self.sort_reverse = False
    
    self._apply_sort()
    self._update_pagination()
    self.draw_table()
  
  def auto_resize_columns(self) -> None:
    """Ajuste automatiquement la largeur des colonnes au contenu."""
    for col in self.columns:
      max_width = len(col) * 10
      col_idx = self.columns.index(col)
      for row in self.all_data[:100]:  # Échantillon
        if col_idx < len(row):
          content_width = len(str(row[col_idx])) * 8
          max_width = max(max_width, content_width)
      self.column_widths[col] = min(max_width + 20, 500)
    self.draw_table()
  
  def draw_table(self) -> None:
    self.canvas.delete('all')
    theme = self.theme_manager.get_theme()
    
    if not self.columns or not self.displayed_data:
      return
    
    # Dessiner filtres
    for j, col in enumerate(self.columns):
      x = sum(self.column_widths.get(c, self.default_cell_width) for c in self.columns[:j])
      width = self.column_widths.get(col, self.default_cell_width)
      
      # Zone filtre
      self.canvas.create_rectangle(
        x, 0, x + width, self.filter_height,
        fill=theme['toolbar_bg'], outline=theme['border'], width=1
      )
    
    # Dessiner en-têtes
    for j, col in enumerate(self.columns):
      x = sum(self.column_widths.get(c, self.default_cell_width) for c in self.columns[:j])
      width = self.column_widths.get(col, self.default_cell_width)
      
      self.canvas.create_rectangle(
        x, self.filter_height, x + width, self.filter_height + self.header_height,
        fill=theme['header_bg'], outline=theme['border'], width=1,
        tags=('header', f'header_{col}')
      )
      
      sort_indicator = ''
      if self.sort_column == col:
        sort_indicator = ' ▼' if self.sort_reverse else ' ▲'
      
      self.canvas.create_text(
        x + width/2, self.filter_height + self.header_height/2,
        text=str(col) + sort_indicator, fill=theme['header_fg'],
        font=('Arial', int(10 * self.zoom_level), 'bold'),
        tags=('header', f'header_{col}')
      )
      
      # Indicateur redimensionnement
      self.canvas.create_line(
        x + width - 1, self.filter_height, x + width - 1, 
        self.filter_height + self.header_height,
        fill=theme['border'], width=2, tags=f'resize_{col}'
      )

    # Dessiner cellules
    for i, row in enumerate(self.displayed_data):
      global_row_idx = self.current_page * self.page_size + i
      
      for j, col in enumerate(self.columns):
        x = sum(self.column_widths.get(c, self.default_cell_width) for c in self.columns[:j])
        width = self.column_widths.get(col, self.default_cell_width)
        y = self.filter_height + self.header_height + i * self.cell_height
        
        color = self.cell_colors.get((global_row_idx, col), theme['normal_color'])
        
        if i == self.selected_row:
          color = theme['selected_bg']
        
        if (global_row_idx, col) in self.modified_cells:
          color = theme['modified_bg']
        
        self.canvas.create_rectangle(
          x, y, x + width, y + self.cell_height,
          fill=color, outline=theme['border'], width=1,
          tags=('cell', f'cell_{i}_{j}', f'row_{i}')
        )
        
        value = row[j] if j < len(row) else ''
        display_value = str(value) if value is not None else 'NULL'
        text_color = theme['null_fg'] if value is None else theme['fg']
        
        if len(display_value) > 50:
          display_value = display_value[:47] + '...'
        
        self.canvas.create_text(
          x + 5, y + self.cell_height/2,
          text=display_value, anchor='w',
          font=('Arial', int(9 * self.zoom_level)), fill=text_color,
          tags=('text', f'text_{i}_{j}', f'row_{i}')
        )
  
    total_width = sum(self.column_widths.get(c, self.default_cell_width) for c in self.columns)
    total_height = self.filter_height + self.header_height + len(self.displayed_data) * self.cell_height
    self.canvas.config(scrollregion=(0, 0, total_width, total_height))

  def _on_click(self, event) -> None:
    x = self.canvas.canvasx(event.x)
    y = self.canvas.canvasy(event.y)
    
    if self.filter_height <= y < self.filter_height + self.header_height:
      col_x = 0
      for col in self.columns:
        width = self.column_widths.get(col, self.default_cell_width)
        if col_x <= x < col_x + width:
          # Vérifier si clic sur bordure pour redimensionner
          if col_x + width - 5 <= x <= col_x + width + 5:
            self.resize_column = col
            self.resize_start_x = x
          else:
            self.sort_by_column(col)
          return
        col_x += width
      return
  
    if y < self.filter_height + self.header_height:
      return
    
    col_idx, col_name = self._get_column_at_x(x)
    row_idx = int((y - self.filter_height - self.header_height) // self.cell_height)
    
    if 0 <= row_idx < len(self.displayed_data) and col_idx >= 0:
      self.selected_row = row_idx
      self.selected_cell = (row_idx, col_name)
      self.draw_table()
      
      if self.on_row_select_callback:
        global_idx = self.current_page * self.page_size + row_idx
        self.on_row_select_callback(global_idx, self.displayed_data[row_idx])

  def _on_mouse_move(self, event) -> None:
    """Gère le redimensionnement des colonnes."""
    if self.resize_column:
      x = self.canvas.canvasx(event.x)
      delta = x - self.resize_start_x
      current_width = self.column_widths.get(self.resize_column, self.default_cell_width)
      new_width = max(50, current_width + delta)
      self.column_widths[self.resize_column] = new_width
      self.resize_start_x = x
      self.draw_table()
  
  def _on_mouse_release(self, event) -> None:
    self.resize_column = None
    self.resize_start_x = None
  
  def _on_double_click(self, event) -> None:
    if self.selected_cell:
      self._start_inline_edit()
  
  def _on_right_click(self, event) -> None:
    self.context_menu.post(event.x_root, event.y_root)
  
  def _start_inline_edit(self) -> None:
    if not self.selected_cell:
      return
    
    row_idx, col_name = self.selected_cell
    col_idx = self.columns.index(col_name)
    
    x = sum(self.column_widths.get(c, self.default_cell_width) for c in self.columns[:col_idx])
    y = self.filter_height + self.header_height + row_idx * self.cell_height
    width = self.column_widths.get(col_name, self.default_cell_width)
    
    current_value = self.displayed_data[row_idx][col_idx]
    
    self.edit_entry = Entry(self.canvas, font=('Arial', int(9 * self.zoom_level)))
    self.edit_entry.insert(0, str(current_value) if current_value is not None else '')
    self.edit_entry.select_range(0, END)
    self.edit_entry.focus()
    
    self.canvas.create_window(
      x + 2, y + 2, anchor='nw', window=self.edit_entry,
      width=width - 4, height=self.cell_height - 4, tags='edit_entry'
    )
    
    self.edit_entry.bind('<Return>', self._save_inline_edit)
    self.edit_entry.bind('<Escape>', self._cancel_inline_edit)
    self.edit_entry.bind('<FocusOut>', self._save_inline_edit)
    
    self.editing_cell = self.selected_cell
  
  def _save_inline_edit(self, event=None) -> None:
    if not self.edit_entry or not self.editing_cell:
      return
    
    new_value = self.edit_entry.get()
    row_idx, col_name = self.editing_cell
    
    global_idx = self.current_page * self.page_size + row_idx
    self.modified_cells.add((global_idx, col_name))
    
    if self.on_cell_edit_callback:
      self.on_cell_edit_callback(global_idx, col_name, new_value)
    
    self._cancel_inline_edit()
  
  def _cancel_inline_edit(self, event=None) -> None:
    if self.edit_entry:
      self.edit_entry.destroy()
      self.edit_entry = None
    self.canvas.delete('edit_entry')
    self.editing_cell = None
    self.draw_table()
  
  def _get_column_at_x(self, x: float) -> Tuple[int, str]:
    col_x = 0
    for idx, col in enumerate(self.columns):
      width = self.column_widths.get(col, self.default_cell_width)
      if col_x <= x < col_x + width:
        return idx, col
      col_x += width
    return -1, ''
  
  def _copy_selection(self, event=None) -> None:
    """Copie la sélection (style Excel)."""
    if not self.selected_cell:
      return
    row_idx, col_name = self.selected_cell
    col_idx = self.columns.index(col_name)
    value = self.displayed_data[row_idx][col_idx]
    self.clipboard_clear()
    self.clipboard_append(str(value) if value is not None else '')
  
  def _paste_selection(self, event=None) -> None:
    """Colle depuis le presse-papier."""
    if not self.selected_cell:
      return
    try:
      clipboard_data = self.clipboard_get()
      row_idx, col_name = self.selected_cell
      if self.on_cell_edit_callback:
        global_idx = self.current_page * self.page_size + row_idx
        self.on_cell_edit_callback(global_idx, col_name, clipboard_data)
    except:
      pass
  
  def _edit_selected(self) -> None:
    self._start_inline_edit()
  
  def _duplicate_row(self) -> None:
    pass
  
  def _show_column_stats(self) -> None:
    """Affiche les statistiques pour une colonne."""
    if not self.selected_cell:
      return
    
    _, col_name = self.selected_cell
    col_idx = self.columns.index(col_name)
    
    values = [row[col_idx] for row in self.filtered_data if col_idx < len(row) and row[col_idx] is not None]
    
    stats_window = Toplevel(self)
    stats_window.title(f"Statistiques - {col_name}")
    stats_window.geometry("300x250")
    
    Label(stats_window, text=f"Colonne: {col_name}", font=('Arial', 12, 'bold')).pack(pady=10)
    
    stats_text = Text(stats_window, height=12, font=('Courier', 10))
    stats_text.pack(fill='both', expand=True, padx=10, pady=10)
    
    stats_text.insert(END, f"Nombre de valeurs: {len(values)}\n")
    stats_text.insert(END, f"Valeurs NULL: {len([r for r in self.filtered_data if col_idx < len(r) and r[col_idx] is None])}\n\n")
    
    try:
      numeric_values = [float(v) for v in values if v not in ('', None)]
      if numeric_values:
        stats_text.insert(END, f"Minimum: {min(numeric_values)}\n")
        stats_text.insert(END, f"Maximum: {max(numeric_values)}\n")
        stats_text.insert(END, f"Moyenne: {sum(numeric_values)/len(numeric_values):.2f}\n")
        stats_text.insert(END, f"Somme: {sum(numeric_values):.2f}\n")
    except:
      stats_text.insert(END, "Valeurs non numériques\n")
      unique_values = len(set(str(v) for v in values))
      stats_text.insert(END, f"Valeurs uniques: {unique_values}\n")
    
    stats_text.config(state='disabled')
  
  def _freeze_column(self) -> None:
    """Fige/dégèle la première colonne."""
    self.frozen_columns = 1 if self.frozen_columns == 0 else 0
    self.draw_table()
  
  def _on_resize(self, event) -> None:
    pass
  
  def get_selected_row(self) -> Optional[Tuple[int, Tuple]]:
    if self.selected_row is not None and self.selected_row < len(self.displayed_data):
      global_idx = self.current_page * self.page_size + self.selected_row
      return (global_idx, self.displayed_data[self.selected_row])
    return None
  
  def refresh(self) -> None:
    self._apply_filters()
    self._apply_sort()
    self._update_pagination()
    self.draw_table()

  def clear_modified_markers(self) -> None:
    """Efface les marqueurs de cellules modifiées."""
    self.modified_cells.clear()
    self.draw_table()


class SQLQueryEditor(Frame):
  """Éditeur SQL avancé avec syntax highlighting et auto-complétion."""
  def __init__(self, parent: Frame, execute_callback: callable):
    Frame.__init__(self, parent)
    
    self.execute_callback = execute_callback
    
    # Toolbar
    toolbar = Frame(self)
    toolbar.pack(fill='x', padx=5, pady=5)
    
    Label(toolbar, text="Requête SQL:", font=('Arial', 10, 'bold')).pack(side='left', padx=5)
    Button(toolbar, text="▶ Exécuter (F5)", command=self._execute,
            bg='#28a745', fg='white').pack(side='left', padx=5)
    Button(toolbar, text="🗑️ Effacer", command=self._clear,
            bg='#6c757d', fg='white').pack(side='left', padx=5)
    Button(toolbar, text="⭐ Ajouter aux favoris", command=self._add_favorite,
            bg='#ffc107', fg='black').pack(side='left', padx=5)
    Button(toolbar, text="💾 Exporter résultats", command=self._export_results,
            bg='#17a2b8', fg='white').pack(side='left', padx=5)
    
    # Zone de texte pour SQL
    self.sql_text = Text(self, height=10, font=('Courier', 10), wrap='none')
    self.sql_text.pack(fill='both', expand=True, padx=5, pady=5)
    
    sql_scroll_y = Scrollbar(self.sql_text, orient='vertical', command=self.sql_text.yview)
    sql_scroll_y.pack(side='right', fill='y')
    sql_scroll_x = Scrollbar(self.sql_text, orient='horizontal', command=self.sql_text.xview)
    sql_scroll_x.pack(side='bottom', fill='x')
    self.sql_text.config(yscrollcommand=sql_scroll_y.set, xscrollcommand=sql_scroll_x.set)
    
    # Tags pour syntax highlighting
    self.sql_text.tag_config('keyword', foreground='#0000ff', font=('Courier', 10, 'bold'))
    self.sql_text.tag_config('string', foreground='#008000')
    self.sql_text.tag_config('comment', foreground='#808080', font=('Courier', 10, 'italic'))
    
    # Bind F5 et auto-complétion
    self.sql_text.bind('<F5>', lambda e: self._execute())
    self.sql_text.bind('<KeyRelease>', self._on_text_change)
    
    self.last_results = None
  
  def _on_text_change(self, event=None) -> None:
    """Applique le syntax highlighting simple."""
    keywords = ['SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 
                'TABLE', 'DROP', 'ALTER', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'ON',
                'AND', 'OR', 'NOT', 'NULL', 'AS', 'ORDER', 'BY', 'GROUP', 'HAVING',
                'LIMIT', 'OFFSET', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX']
    
    # Supprimer tous les tags
    for tag in ['keyword', 'string', 'comment']:
      self.sql_text.tag_remove(tag, '1.0', END)
    
    # Appliquer keywords
    content = self.sql_text.get('1.0', END)
    for keyword in keywords:
      start = '1.0'
      while True:
        pos = self.sql_text.search(r'\m' + keyword + r'\M', start, END, regexp=True, nocase=True)
        if not pos:
          break
        end = f"{pos}+{len(keyword)}c"
        self.sql_text.tag_add('keyword', pos, end)
        start = end
  
  def _execute(self) -> None:
    query = self.sql_text.get('1.0', END).strip()
    if query:
      self.execute_callback(query)
  
  def _clear(self) -> None:
    self.sql_text.delete('1.0', END)
  
  def _add_favorite(self) -> None:
    query = self.sql_text.get('1.0', END).strip()
    if not query:
      return
    
    popup = Toplevel(self)
    popup.title("Ajouter aux favoris")
    popup.geometry("400x200")
    
    Label(popup, text="Nom du favori:", font=('Arial', 10)).pack(pady=5)
    name_entry = Entry(popup, width=40, font=('Arial', 10))
    name_entry.pack(pady=5)
    
    Label(popup, text="Description (optionnel):", font=('Arial', 10)).pack(pady=5)
    desc_entry = Entry(popup, width=40, font=('Arial', 10))
    desc_entry.pack(pady=5)
    
    def save():
      # À implémenter avec le gestionnaire de favoris
      popup.destroy()
    
    Button(popup, text="Enregistrer", command=save, bg='#28a745', fg='white').pack(pady=10)
  
  def _export_results(self) -> None:
    """Exporte les derniers résultats."""
    if self.last_results:
      file_path = filedialog.asksaveasfilename(
        defaultextension=".csv",
        filetypes=[("CSV", "*.csv"), ("JSON", "*.json"), ("Tous", "*.*")]
      )
      if file_path:
        # À implémenter
        pass


class SQLiteEditorPro:
  """Éditeur SQLite Ultimate avec toutes les fonctionnalités."""
  def __init__(self, root: Tk):
    self.root = root
    self.root.title("SQLite DB Editor Pro - Ultimate Edition")
    self.root.geometry("1600x900")
    
    self.conn: Optional[sqlite3.Connection] = None
    self.cursor: Optional[sqlite3.Cursor] = None
    self.current_table: Optional[str] = None
    self.db_path: Optional[str] = None
    self.read_only_mode = False
    
    # Managers
    self.theme_manager = ThemeManager()
    self.undo_manager = UndoRedoManager()
    self.query_history = QueryHistoryManager()
    
    # Configuration
    self.recent_files: List[str] = []
    self.favorite_tables: Set[str] = set()
    self.sessions: Dict[str, Any] = {}
    self.auto_save_enabled = BooleanVar(value=True)
    self.auto_save_interval = 300  # 5 minutes
    
    self.load_config()
    self._build_ui()
    self._apply_theme()
    self._setup_keyboard_shortcuts()
    self._start_auto_save()
  
  def load_config(self) -> None:
    """Charge la configuration depuis un fichier."""
    config_file = os.path.expanduser("~/.sqliteeditor_config.json")
    if os.path.exists(config_file):
      try:
        with open(config_file, 'r') as f:
          config = json.load(f)
          self.recent_files = config.get('recent_files', [])[:10]
          self.favorite_tables = set(config.get('favorite_tables', []))
          self.theme_manager.set_theme(config.get('theme', 'light'))
      except:
        pass
  
  def save_config(self) -> None:
    """Sauvegarde la configuration."""
    config_file = os.path.expanduser("~/.sqliteeditor_config.json")
    config = {
      'recent_files': self.recent_files[:10],
      'favorite_tables': list(self.favorite_tables),
      'theme': self.theme_manager.current_theme
    }
    with open(config_file, 'w') as f:
      json.dump(config, f, indent=2)
  
  def _build_ui(self) -> None:
    # Menu bar
    menubar = Menu(self.root)
    self.root.config(menu=menubar)
    
    # Menu Fichier
    file_menu = Menu(menubar, tearoff=0)
    menubar.add_cascade(label="Fichier", menu=file_menu)
    file_menu.add_command(label="Ouvrir DB (Ctrl+O)", command=self.open_db)
    file_menu.add_command(label="Nouvelle DB", command=self._create_new_db)
    file_menu.add_command(label="Ouvrir en lecture seule", command=self._open_readonly)
    file_menu.add_separator()
    
    self.recent_menu = Menu(file_menu, tearoff=0)
    file_menu.add_cascade(label="Fichiers récents", menu=self.recent_menu)
    self._update_recent_menu()
    
    file_menu.add_separator()
    file_menu.add_command(label="Sauvegarder session", command=self._save_session)
    file_menu.add_command(label="Charger session", command=self._load_session)
    file_menu.add_separator()
    file_menu.add_command(label="Quitter", command=self._on_closing)
    
    # Menu Édition
    edit_menu = Menu(menubar, tearoff=0)
    menubar.add_cascade(label="Édition", menu=edit_menu)
    edit_menu.add_command(label="Undo (Ctrl+Z)", command=self._undo)
    edit_menu.add_command(label="Redo (Ctrl+Y)", command=self._redo)
    edit_menu.add_separator()
    edit_menu.add_command(label="Rechercher (Ctrl+F)", command=self._show_search)
    edit_menu.add_command(label="Recherche globale (Ctrl+Shift+F)", command=self._global_search)
    edit_menu.add_command(label="Rechercher & Remplacer", command=self._find_replace)
    edit_menu.add_separator()
    edit_menu.add_checkbutton(label="Auto-save", variable=self.auto_save_enabled)
    
    # Menu Vue
    view_menu = Menu(menubar, tearoff=0)
    menubar.add_cascade(label="Vue", menu=view_menu)
    view_menu.add_command(label="Thème Clair", command=lambda: self._set_theme('light'))
    view_menu.add_command(label="Thème Sombre", command=lambda: self._set_theme('dark'))
    view_menu.add_command(label="Haute Contraste", command=lambda: self._set_theme('high_contrast'))
    view_menu.add_separator()
    view_menu.add_command(label="Zoom + (Ctrl++)", command=lambda: self._zoom(1.1))
    view_menu.add_command(label="Zoom - (Ctrl+-)", command=lambda: self._zoom(0.9))
    view_menu.add_command(label="Zoom 100%", command=lambda: self._zoom_reset())
    view_menu.add_separator()
    view_menu.add_command(label="Ajuster colonnes auto", command=self._auto_resize_columns)
    view_menu.add_command(label="Personnaliser couleurs", command=self._customize_colors)
    
    # Menu Table
    table_menu = Menu(menubar, tearoff=0)
    menubar.add_cascade(label="Table", menu=table_menu)
    table_menu.add_command(label="Créer table", command=self._create_table)
    table_menu.add_command(label="Modifier structure", command=self._alter_table)
    table_menu.add_command(label="Supprimer table", command=self._drop_table)
    table_menu.add_separator()
    table_menu.add_command(label="Importer CSV", command=self._import_csv)
    table_menu.add_command(label="Importer Excel", command=self._import_excel)
    table_menu.add_command(label="Exporter CSV", command=self._export_csv)
    table_menu.add_command(label="Exporter Excel", command=self._export_excel)
    table_menu.add_command(label="Exporter JSON", command=self._export_json)
    table_menu.add_separator()
    table_menu.add_command(label="Statistiques", command=self._show_statistics)
    table_menu.add_command(label="Visualisation graphique", command=self._show_chart)
    
    # Menu Index
    index_menu = Menu(menubar, tearoff=0)
    menubar.add_cascade(label="Index", menu=index_menu)
    index_menu.add_command(label="Créer index", command=self._create_index)
    index_menu.add_command(label="Voir index", command=self._view_indexes)
    index_menu.add_command(label="Supprimer index", command=self._drop_index)
    
    # Menu Base de données
    db_menu = Menu(menubar, tearoff=0)
    menubar.add_cascade(label="Base de données", menu=db_menu)
    db_menu.add_command(label="Vacuum", command=self._vacuum_db)
    db_menu.add_command(label="Integrity Check", command=self._integrity_check)
    db_menu.add_command(label="Analyze", command=self._analyze_db)
    db_menu.add_separator()
    db_menu.add_command(label="Backup", command=self._backup_db)
    db_menu.add_command(label="Restore", command=self._restore_db)
    db_menu.add_separator()
    db_menu.add_command(label="Vue relations (ER)", command=self._show_er_diagram)
    db_menu.add_command(label="Comparer deux bases", command=self._compare_databases)
    
    # Menu Requêtes
    query_menu = Menu(menubar, tearoff=0)
    menubar.add_cascade(label="Requêtes", menu=query_menu)
    query_menu.add_command(label="Historique", command=self._show_query_history)
    query_menu.add_command(label="Favoris", command=self._show_query_favorites)
    query_menu.add_command(label="Explain Query Plan", command=self._explain_query)
    
    # Menu Outils
    tools_menu = Menu(menubar, tearoff=0)
    menubar.add_cascade(label="Outils", menu=tools_menu)
    tools_menu.add_command(label="Gestionnaire de triggers", command=self._manage_triggers)
    tools_menu.add_command(label="Gestionnaire de vues", command=self._manage_views)
    tools_menu.add_command(label="Migrations de schéma", command=self._schema_migrations)
    tools_menu.add_command(label="Validation de données", command=self._data_validation)
    
    # Menu Aide
    help_menu = Menu(menubar, tearoff=0)
    menubar.add_cascade(label="Aide", menu=help_menu)
    help_menu.add_command(label="Raccourcis clavier", command=self._show_shortcuts)
    help_menu.add_command(label="À propos", command=self._show_about)
    
    # Toolbar principal
    toolbar = Frame(self.root, height=60, relief='raised', bd=1)
    toolbar.pack(fill='x', padx=5, pady=5)
    
    btn_style = {'font': ('Arial', 10), 'padx': 5, 'pady': 5}
    
    Button(toolbar, text="📂 Ouvrir", command=self.open_db, **btn_style).pack(side='left', padx=2)
    Button(toolbar, text="💾 Save", command=self._save_changes, **btn_style).pack(side='left', padx=2)
    Button(toolbar, text="↩️ Undo", command=self._undo, **btn_style).pack(side='left', padx=2)
    Button(toolbar, text="↪️ Redo", command=self._redo, **btn_style).pack(side='left', padx=2)
    
    Label(toolbar, text="  |  ", font=('Arial', 12)).pack(side='left')
    
    Label(toolbar, text="Table:", font=('Arial', 10)).pack(side='left', padx=5)
    self.table_combo = Combobox(toolbar, state="readonly", width=25)
    self.table_combo.pack(side='left', padx=5)
    self.table_combo.bind("<<ComboboxSelected>>", self.load_table)
    
    Button(toolbar, text="⭐", command=self._toggle_favorite, **btn_style).pack(side='left', padx=2)
    Button(toolbar, text="🔍", command=self._show_search, **btn_style).pack(side='left', padx=2)
    
    Label(toolbar, text="  |  ", font=('Arial', 12)).pack(side='left')
    
    self.readonly_label = Label(toolbar, text="", font=('Arial', 9, 'bold'), fg='red')
    self.readonly_label.pack(side='left', padx=5)
    
    # Notebook (onglets)
    self.notebook = Notebook(self.root)
    self.notebook.pack(fill='both', expand=True, padx=5, pady=5)
    
    # Onglet Données
    data_frame = Frame(self.notebook)
    self.notebook.add(data_frame, text="📊 Données")
    
    # Contrôles
    controls_frame = Frame(data_frame)
    controls_frame.pack(fill='x', padx=5, pady=5)
    
    Label(controls_frame, text="Pagination:", font=('Arial', 9)).pack(side='left', padx=5)
    for size in [50, 100, 500, 1000, 5000]:
      Button(controls_frame, text=str(size),
             command=lambda s=size: self._set_page_size(s),
             font=('Arial', 8)).pack(side='left', padx=2)

    Label(controls_frame, text="  |  ").pack(side='left')
    
    Button(controls_frame, text="◀", command=self._prev_page).pack(side='left', padx=2)
    self.page_label = Label(controls_frame, text="Page 1/1", font=('Arial', 9))
    self.page_label.pack(side='left', padx=5)
    Button(controls_frame, text="▶", command=self._next_page).pack(side='left', padx=2)
    
    Label(controls_frame, text="  Aller à:", font=('Arial', 9)).pack(side='left', padx=5)
    self.goto_page_entry = Entry(controls_frame, width=5)
    self.goto_page_entry.pack(side='left', padx=2)
    Button(controls_frame, text="Go", command=self._goto_page).pack(side='left', padx=2)
    
    Label(controls_frame, text="  |  ").pack(side='left')
    self.total_rows_label = Label(controls_frame, text="0 lignes", font=('Arial', 9))
    self.total_rows_label.pack(side='left', padx=5)
    
    # Légende
    legend_frame = Frame(controls_frame)
    legend_frame.pack(side='right', padx=10)
    self._create_legend_item(legend_frame, "PK", '#d0e7ff')
    self._create_legend_item(legend_frame, "FK", '#d0ffd6')
    self._create_legend_item(legend_frame, "Modifié", '#fff3cd')
    
    # Table avancée
    self.table = AdvancedTable(data_frame, self.theme_manager)
    self.table.pack(fill='both', expand=True, padx=5, pady=5)
    self.table.on_row_select_callback = self._on_row_selected
    self.table.on_cell_edit_callback = self._on_cell_edited
    
    # Boutons d'action
    action_frame = Frame(data_frame)
    action_frame.pack(fill='x', padx=5, pady=5)
    
    Button(action_frame, text="➕ Ajouter", command=self.add_row,
            bg='#28a745', fg='white', font=('Arial', 10)).pack(side='left', padx=5)
    Button(action_frame, text="✏️ Éditer", command=self.edit_row,
            bg='#ffc107', fg='black', font=('Arial', 10)).pack(side='left', padx=5)
    Button(action_frame, text="🗑️ Supprimer", command=self.delete_row,
            bg='#dc3545', fg='white', font=('Arial', 10)).pack(side='left', padx=5)
    Button(action_frame, text="📋 Dupliquer", command=self._duplicate_row,
            bg='#17a2b8', fg='white', font=('Arial', 10)).pack(side='left', padx=5)
    Button(action_frame, text="✅ Édition en masse", command=self._bulk_edit,
            bg='#6610f2', fg='white', font=('Arial', 10)).pack(side='left', padx=5)
    Button(action_frame, text="🔄 Rafraîchir", command=self._refresh_table,
            bg='#6c757d', fg='white', font=('Arial', 10)).pack(side='left', padx=5)
    
    # Onglet SQL
    sql_frame = Frame(self.notebook)
    self.notebook.add(sql_frame, text="⚡ SQL")
    
    self.sql_editor = SQLQueryEditor(sql_frame, self._execute_sql)
    self.sql_editor.pack(fill='both', expand=True)
    
    # Zone résultats SQL
    Label(sql_frame, text="Résultats:", font=('Arial', 10, 'bold')).pack(anchor='w', padx=5)
    self.sql_results = Text(sql_frame, height=10, font=('Courier', 9))
    self.sql_results.pack(fill='both', expand=True, padx=5, pady=5)
    
    sql_scroll = Scrollbar(sql_frame, command=self.sql_results.yview)
    sql_scroll.pack(side='right', fill='y')
    self.sql_results.config(yscrollcommand=sql_scroll.set)
    
    # Onglet Schéma
    schema_frame = Frame(self.notebook)
    self.notebook.add(schema_frame, text="🏗️ Schéma")
    
    schema_toolbar = Frame(schema_frame)
    schema_toolbar.pack(fill='x', padx=5, pady=5)
    Button(schema_toolbar, text="Rafraîchir", command=self._update_schema_view).pack(side='left', padx=5)
    Button(schema_toolbar, text="Exporter schéma", command=self._export_schema).pack(side='left', padx=5)
    
    self.schema_text = Text(schema_frame, font=('Courier', 9))
    self.schema_text.pack(fill='both', expand=True, padx=5, pady=5)
    
    # Onglet Logs
    log_frame = Frame(self.notebook)
    self.notebook.add(log_frame, text="📝 Logs")
    
    log_toolbar = Frame(log_frame)
    log_toolbar.pack(fill='x', padx=5, pady=5)
    Button(log_toolbar, text="Effacer", command=self._clear_logs).pack(side='left', padx=5)
    Button(log_toolbar, text="Exporter", command=self._export_logs).pack(side='left', padx=5)
    
    # Niveaux de logs
    Label(log_toolbar, text="Niveau:", font=('Arial', 9)).pack(side='left', padx=5)
    self.log_level = StringVar(value='ALL')
    for level in ['ALL', 'INFO', 'WARNING', 'ERROR']:
        Checkbutton(log_toolbar, text=level, variable=self.log_level,
                    onvalue=level).pack(side='left', padx=2)
    
    self.log_box = Text(log_frame, height=20, font=('Courier', 9))
    self.log_box.pack(fill='both', expand=True, padx=5, pady=5)
    
    log_scroll = Scrollbar(log_frame, command=self.log_box.yview)
    log_scroll.pack(side='right', fill='y')
    self.log_box.config(yscrollcommand=log_scroll.set)
    
    # Status bar
    status_frame = Frame(self.root)
    status_frame.pack(side='bottom', fill='x')
    
    self.status_bar = Label(status_frame, text="Prêt", bd=1, relief='sunken', anchor='w')
    self.status_bar.pack(side='left', fill='x', expand=True)
    
    self.db_size_label = Label(status_frame, text="", bd=1, relief='sunken')
    self.db_size_label.pack(side='right', padx=2)
    
    self.timer_label = Label(status_frame, text="", bd=1, relief='sunken')
    self.timer_label.pack(side='right', padx=2)
  
  def _create_legend_item(self, parent: Frame, label: str, color: str) -> None:
    frame = Frame(parent)
    frame.pack(side='left', padx=5)
    Canvas(frame, width=15, height=15, bg=color, 
            highlightthickness=1, highlightbackground='#888').pack(side='left', padx=2)
    Label(frame, text=label, font=('Arial', 8)).pack(side='left')
  
  def _setup_keyboard_shortcuts(self) -> None:
    self.root.bind('<Control-o>', lambda e: self.open_db())
    self.root.bind('<Control-s>', lambda e: self._save_changes())
    self.root.bind('<Control-z>', lambda e: self._undo())
    self.root.bind('<Control-y>', lambda e: self._redo())
    self.root.bind('<Control-f>', lambda e: self._show_search())
    self.root.bind('<Control-Shift-F>', lambda e: self._global_search())
    self.root.bind('<Control-n>', lambda e: self.add_row())
    self.root.bind('<Delete>', lambda e: self.delete_row())
    self.root.bind('<F5>', lambda e: self._refresh_table())
    self.root.bind('<Control-plus>', lambda e: self._zoom(1.1))
    self.root.bind('<Control-minus>', lambda e: self._zoom(0.9))
    self.root.protocol("WM_DELETE_WINDOW", self._on_closing)
  
  def _apply_theme(self) -> None:
    theme = self.theme_manager.get_theme()
    self.root.configure(bg=theme['bg'])
    if hasattr(self, 'table'):
      self.table.draw_table()
  
  def _set_theme(self, theme_name: str) -> None:
    self.theme_manager.set_theme(theme_name)
    self._apply_theme()
    self.log(f"🌓 Thème: {theme_name}")
  
  def _zoom(self, factor: float) -> None:
    if hasattr(self, 'table'):
      self.table.set_zoom(factor)
    self.log(f"🔍 Zoom: {int(self.table.zoom_level * 100)}%")
  
  def _zoom_reset(self) -> None:
    if hasattr(self, 'table'):
      self.table.zoom_level = 1.0
      self.table.cell_height = 25
      self.table.header_height = 30
      self.table.draw_table()
    self.log("🔍 Zoom: 100%")
  
  def _auto_resize_columns(self) -> None:
    if hasattr(self, 'table'):
      self.table.auto_resize_columns()
      self.log("📏 Colonnes ajustées automatiquement")
  
  def log(self, message: str, level: str = 'INFO') -> None:
    """Ajoute un message dans les logs avec niveau."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    color = {'INFO': 'black', 'WARNING': 'orange', 'ERROR': 'red'}.get(level, 'black')
    
    self.log_box.insert(END, f"[{timestamp}] [{level}] {message}\n")
    self.log_box.see(END)
    self.status_bar.config(text=message)
  
  def _clear_logs(self) -> None:
    self.log_box.delete('1.0', END)
  
  def _export_logs(self) -> None:
    file_path = filedialog.asksaveasfilename(
      defaultextension=".txt",
      filetypes=[("Fichier texte", "*.txt")]
    )
    if file_path:
      with open(file_path, 'w', encoding='utf-8') as f:
        f.write(self.log_box.get('1.0', END))
      self.log(f"Logs exportés: {file_path}")
  
  def _update_recent_menu(self) -> None:
    if not hasattr(self, 'recent_menu'):
      return
    self.recent_menu.delete(0, 'end')
    for path in self.recent_files:
      self.recent_menu.add_command(
        label=os.path.basename(path),
        command=lambda p=path: self._open_recent(p)
      )
  
  def _open_recent(self, path: str) -> None:
    if os.path.exists(path):
      self.db_path = path
      self._connect_db(path)
    else:
      messagebox.showerror("Erreur", f"Le fichier n'existe plus: {path}")
      self.recent_files.remove(path)
      self.save_config()
      self._update_recent_menu()
  
  def open_db(self) -> None:
    db_path = filedialog.askopenfilename(
      title="Choisir un fichier DB",
      filetypes=[("SQLite DB", "*.db *.sqlite *.sqlite3"), ("Tous", "*.*")]
    )
    if db_path:
      self.db_path = db_path
      self._connect_db(db_path)
      if db_path not in self.recent_files:
        self.recent_files.insert(0, db_path)
        self.save_config()
        self._update_recent_menu()
  
  def _open_readonly(self) -> None:
    db_path = filedialog.askopenfilename(
      title="Ouvrir en lecture seule",
      filetypes=[("SQLite DB", "*.db *.sqlite *.sqlite3"), ("Tous", "*.*")]
    )
    if db_path:
      self.db_path = db_path
      self.read_only_mode = True
      self._connect_db(db_path, readonly=True)
      self.readonly_label.config(text="MODE LECTURE SEULE")
  
  def _connect_db(self, db_path: str, readonly: bool = False) -> None:
    try:
      if self.conn:
        self.conn.close()
      
      if readonly:
        uri = f"file:{db_path}?mode=ro"
        self.conn = sqlite3.connect(uri, uri=True)
      else:
        self.conn = sqlite3.connect(db_path)
      
      self.cursor = self.conn.cursor()
      self.log(f"Base ouverte: {os.path.basename(db_path)}")
      
      self.cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      tables = [row[0] for row in self.cursor.fetchall()]
      self.table_combo['values'] = tables
      self.log(f"{len(tables)} tables trouvées")
      
      if tables:
        self.table_combo.current(0)
        self.load_table()
      
      self._update_schema_view()
      self._update_db_size()
        
    except Exception as e:
      self.log(f"Erreur: {e}", 'ERROR')
      messagebox.showerror("Erreur", str(e))
  
  def _create_new_db(self) -> None:
    db_path = filedialog.asksaveasfilename(
      defaultextension=".db",
      filetypes=[("SQLite DB", "*.db")]
    )
    if db_path:
      conn = sqlite3.connect(db_path)
      conn.close()
      self.log(f"Nouvelle DB créée: {db_path}")
      self._connect_db(db_path)
  
  def load_table(self, event=None) -> None:
    if not self.cursor:
      return
    
    self.current_table = self.table_combo.get()
    if not self.current_table:
      return
    
    try:
      start_time = time.time()
      
      self.cursor.execute(f"PRAGMA table_info({self.current_table})")
      columns_info = self.cursor.fetchall()
      columns = [col[1] for col in columns_info]
      pk_columns = {col[1] for col in columns_info if col[5]}
      
      self.cursor.execute(f"PRAGMA foreign_key_list({self.current_table})")
      fk_info = self.cursor.fetchall()
      fk_columns = {col[3] for col in fk_info}
      
      self.cursor.execute(f"SELECT * FROM {self.current_table}")
      rows = self.cursor.fetchall()
      
      cell_colors = {}
      theme = self.theme_manager.get_theme()
      for i in range(len(rows)):
        for col in columns:
          if col in pk_columns:
            cell_colors[(i, col)] = theme['pk_color']
          elif col in fk_columns:
            cell_colors[(i, col)] = theme['fk_color']
          else:
            cell_colors[(i, col)] = theme['normal_color']
      
      self.table.set_data(columns, rows, cell_colors)
      self._update_page_info()
      
      elapsed = time.time() - start_time
      self.timer_label.config(text=f"{elapsed:.3f}s")
      self.log(f"{len(rows)} lignes chargées: {self.current_table}")
      self.root.title(f"SQLite Editor Pro - {self.current_table}")
        
    except Exception as e:
      self.log(f"Erreur: {e}", 'ERROR')
  
  def _update_page_info(self) -> None:
    page = self.table.current_page + 1
    total = self.table.total_pages
    self.page_label.config(text=f"Page {page}/{total}")
    
    total_rows = len(self.table.filtered_data)
    self.total_rows_label.config(text=f"{total_rows} ligne(s)")
  
  def _set_page_size(self, size: int) -> None:
    self.table.set_page_size(size)
    self._update_page_info()
    self.log(f"Taille page: {size}")
  
  def _next_page(self) -> None:
    self.table.next_page()
    self._update_page_info()
  
  def _prev_page(self) -> None:
    self.table.prev_page()
    self._update_page_info()
  
  def _goto_page(self) -> None:
    try:
      page = int(self.goto_page_entry.get()) - 1
      self.table.goto_page(page)
      self._update_page_info()
    except:
      pass
  
  def _on_row_selected(self, row_idx: int, row_data: Tuple) -> None:
    self.log(f"Ligne {row_idx} sélectionnée", 'INFO')
  
  def _on_cell_edited(self, row_idx: int, col_name: str, new_value: str) -> None:
    if self.read_only_mode:
      messagebox.showwarning("Mode lecture seule", "Modifications non autorisées")
      return
    
    try:
      self.cursor.execute(f"PRAGMA table_info({self.current_table})")
      columns_info = self.cursor.fetchall()
      columns = [col[1] for col in columns_info]
      pk_columns = [col[1] for col in columns_info if col[5]]
      
      if not pk_columns:
        messagebox.showerror("Erreur", "Pas de clé primaire")
        return
      
      old_row = self.table.all_data[row_idx]
      
      where = " AND ".join(f"{pk} = ?" for pk in pk_columns)
      pk_values = [old_row[columns.index(pk)] for pk in pk_columns]
      
      self.cursor.execute(
        f"UPDATE {self.current_table} SET {col_name} = ? WHERE {where}",
        [new_value] + pk_values
      )
      self.conn.commit()
      
      self.undo_manager.add_action({
        'type': 'update',
        'table': self.current_table,
        'row_idx': row_idx,
        'column': col_name,
        'old_value': old_row[columns.index(col_name)],
        'new_value': new_value,
        'pk_values': pk_values
      })
      
      self.log(f"Cellule mise à jour: {col_name}")
      self.load_table()
        
    except Exception as e:
      self.log(f"Erreur: {e}", 'ERROR')

  def add_row(self) -> None:
    if not self.current_table or self.read_only_mode:
      return
    self._edit_popup([], is_new=True)
  
  def edit_row(self) -> None:
    if not self.current_table or self.read_only_mode:
      return
    
    selected = self.table.get_selected_row()
    if not selected:
      messagebox.showwarning("Attention", "Sélectionnez une ligne")
      return
    
    _, values = selected
    self._edit_popup(values, is_new=False)
  
  def delete_row(self) -> None:
    if not self.current_table or self.read_only_mode:
      return
    
    selected = self.table.get_selected_row()
    if not selected:
      messagebox.showwarning("Attention", "Sélectionnez une ligne")
      return
    
    if not messagebox.askyesno("Confirmer", "Supprimer cette ligne ?"):
      return
    
    try:
      self.cursor.execute(f"PRAGMA table_info({self.current_table})")
      columns_info = self.cursor.fetchall()
      columns = [col[1] for col in columns_info]
      pk_columns = [col[1] for col in columns_info if col[5]]
      
      if not pk_columns:
        messagebox.showerror("Erreur", "Pas de clé primaire")
        return
      
      row_idx, row_values = selected
      where = " AND ".join(f"{pk} = ?" for pk in pk_columns)
      pk_values = [row_values[columns.index(pk)] for pk in pk_columns]
      
      self.undo_manager.add_action({
        'type': 'delete',
        'table': self.current_table,
        'row': row_values,
        'columns': columns
      })
      
      self.cursor.execute(
        f"DELETE FROM {self.current_table} WHERE {where}",
        pk_values
      )
      self.conn.commit()
      
      self.log("Ligne supprimée")
      self.load_table()
      
    except Exception as e:
      self.log(f"Erreur: {e}", 'ERROR')
  
  def _duplicate_row(self) -> None:
    if not self.current_table or self.read_only_mode:
      return
    
    selected = self.table.get_selected_row()
    if not selected:
      messagebox.showwarning("Attention", "Sélectionnez une ligne")
      return
    
    _, values = selected
    self._edit_popup(list(values), is_new=True, is_duplicate=True)
  
  def _bulk_edit(self) -> None:
    """Édition en masse de plusieurs lignes."""
    if not self.current_table or self.read_only_mode:
      return
    
    popup = Toplevel(self.root)
    popup.title("Édition en masse")
    popup.geometry("500x300")
    
    Label(popup, text="Modifier toutes les lignes où:", font=('Arial', 10, 'bold')).pack(pady=10)
    
    self.cursor.execute(f"PRAGMA table_info({self.current_table})")
    columns = [col[1] for col in self.cursor.fetchall()]
    
    condition_frame = Frame(popup)
    condition_frame.pack(pady=10)
    
    Label(condition_frame, text="Colonne:", font=('Arial', 10)).grid(row=0, column=0, padx=5)
    cond_col = Combobox(condition_frame, values=columns, state='readonly', width=15)
    cond_col.grid(row=0, column=1, padx=5)
    
    Label(condition_frame, text="=", font=('Arial', 10)).grid(row=0, column=2, padx=5)
    
    cond_val = Entry(condition_frame, width=20)
    cond_val.grid(row=0, column=3, padx=5)
    
    Label(popup, text="Définir:", font=('Arial', 10, 'bold')).pack(pady=10)
    
    set_frame = Frame(popup)
    set_frame.pack(pady=10)
    
    Label(set_frame, text="Colonne:", font=('Arial', 10)).grid(row=0, column=0, padx=5)
    set_col = Combobox(set_frame, values=columns, state='readonly', width=15)
    set_col.grid(row=0, column=1, padx=5)
    
    Label(set_frame, text="=", font=('Arial', 10)).grid(row=0, column=2, padx=5)
    
    set_val = Entry(set_frame, width=20)
    set_val.grid(row=0, column=3, padx=5)
    
    def apply_bulk():
      try:
        query = f"UPDATE {self.current_table} SET {set_col.get()} = ? WHERE {cond_col.get()} = ?"
        self.cursor.execute(query, [set_val.get(), cond_val.get()])
        affected = self.cursor.rowcount
        self.conn.commit()
        self.log(f"Édition en masse: {affected} lignes modifiées")
        self.load_table()
        popup.destroy()
      except Exception as e:
        self.log(f"Erreur: {e}", 'ERROR')
        messagebox.showerror("Erreur", str(e))
    
    Button(popup, text="Appliquer", command=apply_bulk, bg='#28a745', fg='white').pack(pady=20)
  
  def _refresh_table(self) -> None:
    self.load_table()
    self.table.clear_modified_markers()
    self.log("Table rafraîchie")
  
  def _edit_popup(self, values: List[Any], is_new: bool, is_duplicate: bool = False) -> None:
    popup = Toplevel(self.root)
    title = "Dupliquer" if is_duplicate else ("Ajouter" if is_new else "Éditer")
    popup.title(f"{title} - {self.current_table}")
    popup.geometry("500x600")
    
    self.cursor.execute(f"PRAGMA table_info({self.current_table})")
    columns_info = self.cursor.fetchall()
    columns = [col[1] for col in columns_info]
    pk_columns = [col[1] for col in columns_info if col[5]]
    
    canvas = Canvas(popup)
    scrollbar = Scrollbar(popup, orient="vertical", command=canvas.yview)
    scrollable_frame = Frame(canvas)
    
    scrollable_frame.bind(
      "<Configure>",
      lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
    )
    
    canvas.create_window((0, 0), window=scrollable_frame, anchor="nw")
    canvas.configure(yscrollcommand=scrollbar.set)
    
    entries = []
    for idx, (col_info, col) in enumerate(zip(columns_info, columns)):
      frame = Frame(scrollable_frame)
      frame.pack(fill='x', padx=10, pady=5)
      
      is_pk = col in pk_columns
      col_type = col_info[2]
      label_text = f"{col} ({col_type}):" + (" [PK]" if is_pk else "")
      Label(frame, text=label_text, font=('Arial', 10), width=25, anchor='w').pack(side='left')
      
      entry = Entry(frame, width=40, font=('Arial', 10))
      entry.pack(side='left', padx=5)
      
      if not is_new and values and idx < len(values):
        if is_duplicate and is_pk:
          pass
        else:
          entry.insert(0, str(values[idx]) if values[idx] is not None else '')
      
      entries.append(entry)
    
    canvas.pack(side="left", fill="both", expand=True)
    scrollbar.pack(side="right", fill="y")
    
    def save():
      new_values = [e.get() if e.get() else None for e in entries]
      
      try:
        if is_new or is_duplicate:
          placeholders = ", ".join("?" for _ in columns)
          self.cursor.execute(
            f"INSERT INTO {self.current_table} ({','.join(columns)}) VALUES ({placeholders})",
            new_values
          )
          self.log("Ligne ajoutée")
        else:
          where = " AND ".join(f"{pk} = ?" for pk in pk_columns)
          pk_values = [values[columns.index(pk)] for pk in pk_columns]
          set_clause = ", ".join(f"{col} = ?" for col in columns)
          
          self.cursor.execute(
            f"UPDATE {self.current_table} SET {set_clause} WHERE {where}",
            new_values + pk_values
          )
          self.log("Ligne modifiée")
      
        self.conn.commit()
        self.load_table()
        popup.destroy()
          
      except Exception as e:
        self.log(f"Erreur: {e}", 'ERROR')
        messagebox.showerror("Erreur", str(e))
    
    btn_frame = Frame(popup)
    btn_frame.pack(fill='x', pady=10)
    
    Button(btn_frame, text="Enregistrer", command=save,
            bg='#28a745', fg='white', font=('Arial', 10)).pack(side='left', padx=10)
    Button(btn_frame, text="Annuler", command=popup.destroy,
            bg='#6c757d', fg='white', font=('Arial', 10)).pack(side='left', padx=10)
  
  def _undo(self) -> None:
    action = self.undo_manager.undo()
    if not action:
      self.log("Rien à annuler", 'WARNING')
      return
    
    try:
      if action['type'] == 'delete':
        columns = action['columns']
        placeholders = ", ".join("?" for _ in columns)
        self.cursor.execute(
          f"INSERT INTO {action['table']} ({','.join(columns)}) VALUES ({placeholders})",
          action['row']
        )
      elif action['type'] == 'update':
        where = " AND ".join("? = ?" for _ in action.get('pk_values', []))
        self.cursor.execute(
          f"UPDATE {action['table']} SET {action['column']} = ? WHERE {where}",
          [action['old_value']] + action['pk_values']
        )
      
      self.conn.commit()
      self.load_table()
      self.log("Action annulée")
        
    except Exception as e:
      self.log(f"Erreur undo: {e}", 'ERROR')
  
  def _redo(self) -> None:
    action = self.undo_manager.redo()
    if not action:
      self.log("Rien à refaire", 'WARNING')
      return
    self.log("Action refaite")
  
  def _show_search(self) -> None:
    search_window = Toplevel(self.root)
    search_window.title("Recherche dans la table")
    search_window.geometry("450x180")
    
    Label(search_window, text="Colonne:", font=('Arial', 10)).grid(row=0, column=0, padx=10, pady=10)
    col_combo = Combobox(search_window, values=self.table.columns, state='readonly', width=20)
    col_combo.grid(row=0, column=1, padx=10, pady=10)
    if self.table.columns:
      col_combo.current(0)
    
    Label(search_window, text="Rechercher:", font=('Arial', 10)).grid(row=1, column=0, padx=10, pady=10)
    search_entry = Entry(search_window, width=25, font=('Arial', 10))
    search_entry.grid(row=1, column=1, padx=10, pady=10)
    
    regex_var = BooleanVar()
    Checkbutton(search_window, text="Regex", variable=regex_var).grid(row=2, column=1, sticky='w', padx=10)
    
    def do_search():
      col = col_combo.get()
      text = search_entry.get()
      if col and text:
        if regex_var.get():
          text = f"regex:{text}"
        self.table.add_filter(col, text)
        self._update_page_info()
        self.log(f"Filtre appliqué: {col}")
      search_window.destroy()
    
    def clear_filters():
      self.table.filters.clear()
      self.table.refresh()
      self._update_page_info()
      self.log("Filtres effacés")
      search_window.destroy()
    
    Button(search_window, text="Rechercher", command=do_search,
            bg='#4a90e2', fg='white').grid(row=3, column=0, padx=10, pady=10)
    Button(search_window, text="Effacer filtres", command=clear_filters,
            bg='#6c757d', fg='white').grid(row=3, column=1, padx=10, pady=10)
  
  def _global_search(self) -> None:
    """Recherche globale dans toutes les tables."""
    if not self.conn:
      return
    
    search_text = simpledialog.askstring("Recherche globale", "Rechercher dans toutes les tables:")
    if not search_text:
      return
    
    results_window = Toplevel(self.root)
    results_window.title(f"Résultats pour: {search_text}")
    results_window.geometry("600x400")
    
    results_text = Text(results_window, font=('Courier', 9))
    results_text.pack(fill='both', expand=True, padx=10, pady=10)
    
    self.cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [r[0] for r in self.cursor.fetchall()]
    
    for table in tables:
      self.cursor.execute(f"PRAGMA table_info({table})")
      columns = [col[1] for col in self.cursor.fetchall()]
      
      for col in columns:
        try:
          query = f"SELECT COUNT(*) FROM {table} WHERE {col} LIKE ?"
          self.cursor.execute(query, [f'%{search_text}%'])
          count = self.cursor.fetchone()[0]
          if count > 0:
            results_text.insert(END, f"{table}.{col}: {count} résultats\n")
        except:
          pass
    
    self.log(f"Recherche globale terminée: {search_text}")
  
  def _find_replace(self) -> None:
    """Rechercher et remplacer dans la table."""
    if not self.current_table or self.read_only_mode:
      return
    
    popup = Toplevel(self.root)
    popup.title("Rechercher & Remplacer")
    popup.geometry("400x200")
    
    self.cursor.execute(f"PRAGMA table_info({self.current_table})")
    columns = [col[1] for col in self.cursor.fetchall()]
    
    Label(popup, text="Colonne:", font=('Arial', 10)).grid(row=0, column=0, padx=10, pady=10)
    col_combo = Combobox(popup, values=columns, state='readonly', width=20)
    col_combo.grid(row=0, column=1, padx=10, pady=10)
    
    Label(popup, text="Rechercher:", font=('Arial', 10)).grid(row=1, column=0, padx=10, pady=10)
    find_entry = Entry(popup, width=25)
    find_entry.grid(row=1, column=1, padx=10, pady=10)
    
    Label(popup, text="Remplacer par:", font=('Arial', 10)).grid(row=2, column=0, padx=10, pady=10)
    replace_entry = Entry(popup, width=25)
    replace_entry.grid(row=2, column=1, padx=10, pady=10)
    
    def do_replace():
      try:
        col = col_combo.get()
        find_val = find_entry.get()
        replace_val = replace_entry.get()
        
        query = f"UPDATE {self.current_table} SET {col} = REPLACE({col}, ?, ?)"
        self.cursor.execute(query, [find_val, replace_val])
        affected = self.cursor.rowcount
        self.conn.commit()
        
        self.log(f"Remplacé dans {affected} lignes")
        self.load_table()
        popup.destroy()
      except Exception as e:
        self.log(f"Erreur: {e}", 'ERROR')
        messagebox.showerror("Erreur", str(e))
    
    Button(popup, text="Remplacer tout", command=do_replace,
           bg='#ffc107', fg='black').grid(row=3, column=1, pady=20)
  
  def _execute_sql(self, query: str) -> None:
    if not self.conn:
      return
    
    start_time = time.time()
    try:
      self.cursor.execute(query)
      
      if query.strip().upper().startswith('SELECT'):
        results = self.cursor.fetchall()
        columns = [desc[0] for desc in self.cursor.description] if self.cursor.description else []
        
        self.sql_results.delete('1.0', END)
        if columns:
          self.sql_results.insert(END, " | ".join(columns) + "\n")
          self.sql_results.insert(END, "-" * 80 + "\n")
        
        for row in results[:100]:  # Limiter affichage
          self.sql_results.insert(END, " | ".join(str(v) for v in row) + "\n")
        
        if len(results) > 100:
          self.sql_results.insert(END, f"\n... ({len(results) - 100} lignes supplémentaires)")
        
        elapsed = time.time() - start_time
        self.sql_results.insert(END, f"\n\nTemps: {elapsed:.3f}s | Résultats: {len(results)}")
        self.query_history.add_query(query, len(results), elapsed)
        self.sql_editor.last_results = (columns, results)
      else:
        self.conn.commit()
        elapsed = time.time() - start_time
        self.sql_results.delete('1.0', END)
        self.sql_results.insert(END, f"Requête exécutée avec succès\nLignes affectées: {self.cursor.rowcount}\nTemps: {elapsed:.3f}s")
        self.query_history.add_query(query, self.cursor.rowcount, elapsed)
        
        # Rafraîchir si modification
        if self.current_table:
          self.load_table()
      
      self.log(f"Requête exécutée: {elapsed:.3f}s")
        
    except Exception as e:
      elapsed = time.time() - start_time
      self.sql_results.delete('1.0', END)
      self.sql_results.insert(END, f"ERREUR:\n{str(e)}\n\nTemps: {elapsed:.3f}s")
      self.log(f"Erreur SQL: {e}", 'ERROR')
  
  def _update_schema_view(self) -> None:
    if not self.conn:
      return
    
    self.schema_text.delete('1.0', END)
    
    self.cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL")
    for row in self.cursor.fetchall():
      self.schema_text.insert(END, row[0] + ";\n\n")
    
    self.cursor.execute("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")
    for row in self.cursor.fetchall():
      self.schema_text.insert(END, row[0] + ";\n\n")
  
  def _update_db_size(self) -> None:
    if self.db_path and os.path.exists(self.db_path):
      size = os.path.getsize(self.db_path)
      if size < 1024:
        size_str = f"{size} B"
      elif size < 1024**2:
        size_str = f"{size/1024:.1f} KB"
      elif size < 1024**3:
        size_str = f"{size/(1024**2):.1f} MB"
      else:
        size_str = f"{size/(1024**3):.2f} GB"
      self.db_size_label.config(text=f"Taille: {size_str}")
  
  def _save_changes(self) -> None:
    if self.conn:
      self.conn.commit()
      self.table.clear_modified_markers()
      self.log("Modifications sauvegardées")
  
  def _toggle_favorite(self) -> None:
    if not self.current_table:
      return
    
    if self.current_table in self.favorite_tables:
      self.favorite_tables.remove(self.current_table)
      self.log(f"Retiré des favoris: {self.current_table}")
    else:
      self.favorite_tables.add(self.current_table)
      self.log(f"Ajouté aux favoris: {self.current_table}")
    self.save_config()
  
  def _create_table(self) -> None:
    if not self.conn or self.read_only_mode:
      return
    
    popup = Toplevel(self.root)
    popup.title("Créer une table")
    popup.geometry("500x400")
    
    Label(popup, text="Nom de la table:", font=('Arial', 10)).pack(pady=5)
    name_entry = Entry(popup, width=40)
    name_entry.pack(pady=5)
    
    Label(popup, text="SQL CREATE TABLE:", font=('Arial', 10)).pack(pady=5)
    sql_text = Text(popup, width=50, height=15, font=('Courier', 9))
    sql_text.pack(pady=5, padx=10)
    sql_text.insert('1.0', "CREATE TABLE ma_table (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    nom TEXT NOT NULL,\n    valeur REAL\n);")
    
    def create():
      sql = sql_text.get('1.0', END).strip()
      try:
        self.cursor.execute(sql)
        self.conn.commit()
        self.log("Table créée avec succès")
        
        # Mettre à jour la liste des tables
        self.cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        tables = [row[0] for row in self.cursor.fetchall()]
        self.table_combo['values'] = tables
        
        popup.destroy()
      except Exception as e:
        self.log(f"Erreur: {e}", 'ERROR')
        messagebox.showerror("Erreur", str(e))
    
    Button(popup, text="Créer", command=create, bg='#28a745', fg='white').pack(pady=10)
  
  def _alter_table(self) -> None:
    """Modifier la structure d'une table."""
    if not self.current_table or self.read_only_mode:
      return
    
    popup = Toplevel(self.root)
    popup.title(f"Modifier la structure - {self.current_table}")
    popup.geometry("400x300")
    
    Label(popup, text="Ajouter une colonne:", font=('Arial', 10, 'bold')).pack(pady=10)
    
    add_frame = Frame(popup)
    add_frame.pack(pady=10)
    
    Label(add_frame, text="Nom:").grid(row=0, column=0, padx=5)
    col_name = Entry(add_frame, width=20)
    col_name.grid(row=0, column=1, padx=5)
    
    Label(add_frame, text="Type:").grid(row=1, column=0, padx=5)
    col_type = Combobox(add_frame, values=['TEXT', 'INTEGER', 'REAL', 'BLOB'], state='readonly', width=18)
    col_type.grid(row=1, column=1, padx=5)
    col_type.current(0)
    
    def add_column():
      try:
        query = f"ALTER TABLE {self.current_table} ADD COLUMN {col_name.get()} {col_type.get()}"
        self.cursor.execute(query)
        self.conn.commit()
        self.log(f"Colonne ajoutée: {col_name.get()}")
        self.load_table()
        popup.destroy()
      except Exception as e:
        self.log(f"Erreur: {e}", 'ERROR')
        messagebox.showerror("Erreur", str(e))
    
    Button(popup, text="Ajouter la colonne", command=add_column, bg='#28a745', fg='white').pack(pady=20)
  
  def _drop_table(self) -> None:
    if not self.current_table or self.read_only_mode:
      return
    
    if not messagebox.askyesno("Confirmation", 
                                f"Êtes-vous sûr de vouloir supprimer la table '{self.current_table}' ?\nCette action est irréversible !",
                                icon='warning'):
      return
    
    try:
      self.cursor.execute(f"DROP TABLE {self.current_table}")
      self.conn.commit()
      self.log(f"Table supprimée: {self.current_table}")
      
      self.cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      tables = [row[0] for row in self.cursor.fetchall()]
      self.table_combo['values'] = tables
      self.current_table = None
        
    except Exception as e:
      self.log(f"Erreur: {e}", 'ERROR')
  
  def _import_csv(self) -> None:
    if not self.current_table or self.read_only_mode:
      return
    
    file_path = filedialog.askopenfilename(filetypes=[("CSV", "*.csv"), ("Tous", "*.*")])
    if not file_path:
      return
    
    try:
      with open(file_path, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        headers = next(reader)
        
        self.cursor.execute(f"PRAGMA table_info({self.current_table})")
        table_columns = [col[1] for col in self.cursor.fetchall()]
        
        count = 0
        for row in reader:
          if len(row) == len(table_columns):
            placeholders = ','.join(['?'] * len(row))
            self.cursor.execute(f"INSERT INTO {self.current_table} VALUES ({placeholders})", row)
            count += 1
        
        self.conn.commit()
        self.log(f"Importé {count} lignes depuis CSV")
        self.load_table()
            
    except Exception as e:
      self.log(f"Erreur import CSV: {e}", 'ERROR')
      messagebox.showerror("Erreur", str(e))
  
  def _import_excel(self) -> None:
    messagebox.showinfo("Info", "Fonctionnalité à implémenter avec openpyxl")
  
  def _export_csv(self) -> None:
    if not self.current_table:
      return
    
    file_path = filedialog.asksaveasfilename(defaultextension=".csv", filetypes=[("CSV", "*.csv")])
    if not file_path:
        return
    
    try:
      self.cursor.execute(f"SELECT * FROM {self.current_table}")
      rows = self.cursor.fetchall()
      columns = [desc[0] for desc in self.cursor.description]
      
      with open(file_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(columns)
        writer.writerows(rows)
      
      self.log(f"Exporté vers CSV: {file_path}")
      
    except Exception as e:
      self.log(f"Erreur export CSV: {e}", 'ERROR')
  
  def _export_excel(self) -> None:
    messagebox.showinfo("Info", "Fonctionnalité à implémenter avec openpyxl")
  
  def _export_json(self) -> None:
    if not self.current_table:
      return
    
    file_path = filedialog.asksaveasfilename(defaultextension=".json", filetypes=[("JSON", "*.json")])
    if not file_path:
      return
    
    try:
      self.cursor.execute(f"SELECT * FROM {self.current_table}")
      rows = self.cursor.fetchall()
      columns = [desc[0] for desc in self.cursor.description]
      
      data = [dict(zip(columns, row)) for row in rows]
      
      with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
      
      self.log(f"Exporté vers JSON: {file_path}")
        
    except Exception as e:
      self.log(f"Erreur export JSON: {e}", 'ERROR')
  
  def _show_statistics(self) -> None:
    if not self.current_table:
      return
    
    popup = Toplevel(self.root)
    popup.title(f"Statistiques - {self.current_table}")
    popup.geometry("500x400")
    
    stats_text = Text(popup, font=('Courier', 10))
    stats_text.pack(fill='both', expand=True, padx=10, pady=10)
    
    self.cursor.execute(f"SELECT COUNT(*) FROM {self.current_table}")
    total_rows = self.cursor.fetchone()[0]
    
    self.cursor.execute(f"PRAGMA table_info({self.current_table})")
    columns_info = self.cursor.fetchall()
    
    stats_text.insert(END, f"=== Statistiques de {self.current_table} ===\n\n")
    stats_text.insert(END, f"Nombre total de lignes: {total_rows}\n")
    stats_text.insert(END, f"Nombre de colonnes: {len(columns_info)}\n\n")
    
    stats_text.insert(END, "Colonnes:\n")
    for col in columns_info:
      stats_text.insert(END, f"  - {col[1]} ({col[2]})")
      if col[5]:
        stats_text.insert(END, " [PK]")
      stats_text.insert(END, "\n")
    
    stats_text.config(state='disabled')
  
  def _show_chart(self) -> None:
    messagebox.showinfo("Visualisation", "Fonctionnalité de graphiques à implémenter avec matplotlib")
  
  def _create_index(self) -> None:
    if not self.current_table or self.read_only_mode:
      return
    
    popup = Toplevel(self.root)
    popup.title("Créer un index")
    popup.geometry("400x200")
    
    self.cursor.execute(f"PRAGMA table_info({self.current_table})")
    columns = [col[1] for col in self.cursor.fetchall()]
    
    Label(popup, text="Nom de l'index:", font=('Arial', 10)).pack(pady=5)
    idx_name = Entry(popup, width=30)
    idx_name.pack(pady=5)
    
    Label(popup, text="Colonne:", font=('Arial', 10)).pack(pady=5)
    col_combo = Combobox(popup, values=columns, state='readonly', width=28)
    col_combo.pack(pady=5)
    
    def create_idx():
      try:
        query = f"CREATE INDEX {idx_name.get()} ON {self.current_table}({col_combo.get()})"
        self.cursor.execute(query)
        self.conn.commit()
        self.log(f"Index créé: {idx_name.get()}")
        popup.destroy()
      except Exception as e:
        self.log(f"Erreur: {e}", 'ERROR')
        messagebox.showerror("Erreur", str(e))
    
    Button(popup, text="Créer l'index", command=create_idx, bg='#28a745', fg='white').pack(pady=20)
  
  def _view_indexes(self) -> None:
    if not self.current_table:
      return
    
    popup = Toplevel(self.root)
    popup.title(f"Index de {self.current_table}")
    popup.geometry("400x300")
    
    idx_text = Text(popup, font=('Courier', 9))
    idx_text.pack(fill='both', expand=True, padx=10, pady=10)
    
    self.cursor.execute(f"PRAGMA index_list({self.current_table})")
    indexes = self.cursor.fetchall()
    
    if indexes:
      for idx in indexes:
        idx_text.insert(END, f"Index: {idx[1]}\n")
        self.cursor.execute(f"PRAGMA index_info({idx[1]})")
        cols = self.cursor.fetchall()
        for col in cols:
          idx_text.insert(END, f"  - {col[2]}\n")
        idx_text.insert(END, "\n")
    else:
      idx_text.insert(END, "Aucun index trouvé")
    
    idx_text.config(state='disabled')
  
  def _drop_index(self) -> None:
    if not self.current_table or self.read_only_mode:
      return
    
    self.cursor.execute(f"PRAGMA index_list({self.current_table})")
    indexes = [idx[1] for idx in self.cursor.fetchall()]
    
    if not indexes:
      messagebox.showinfo("Info", "Aucun index à supprimer")
      return
    
    popup = Toplevel(self.root)
    popup.title("Supprimer un index")
    popup.geometry("300x150")
    
    Label(popup, text="Sélectionner l'index:", font=('Arial', 10)).pack(pady=10)
    idx_combo = Combobox(popup, values=indexes, state='readonly', width=25)
    idx_combo.pack(pady=10)
    
    def drop_idx():
      try:
        self.cursor.execute(f"DROP INDEX {idx_combo.get()}")
        self.conn.commit()
        self.log(f"Index supprimé: {idx_combo.get()}")
        popup.destroy()
      except Exception as e:
        self.log(f"Erreur: {e}", 'ERROR')
    
    Button(popup, text="Supprimer", command=drop_idx, bg='#dc3545', fg='white').pack(pady=10)
  
  def _vacuum_db(self) -> None:
    if not self.conn or self.read_only_mode:
      return
    
    try:
      self.cursor.execute("VACUUM")
      self.log("VACUUM exécuté avec succès")
      self._update_db_size()
    except Exception as e:
      self.log(f"Erreur VACUUM: {e}", 'ERROR')
  
  def _integrity_check(self) -> None:
    if not self.conn:
      return
    
    try:
      self.cursor.execute("PRAGMA integrity_check")
      result = self.cursor.fetchone()[0]
      if result == "ok":
        messagebox.showinfo("Integrity Check", "La base de données est intègre")
        self.log("Integrity check: OK")
      else:
        messagebox.showwarning("Integrity Check", f"Problème détecté: {result}")
        self.log(f"Integrity check: {result}", 'WARNING')
    except Exception as e:
      self.log(f"Erreur: {e}", 'ERROR')

  def _analyze_db(self) -> None:
    if not self.conn or self.read_only_mode:
      return
    
    try:
      self.cursor.execute("ANALYZE")
      self.log("ANALYZE exécuté")
    except Exception as e:
      self.log(f"Erreur: {e}", 'ERROR')
  
  def _backup_db(self) -> None:
    if not self.db_path:
      return
    
    backup_path = filedialog.asksaveasfilename(
      defaultextension=".db",
      filetypes=[("SQLite DB", "*.db")],
      initialfile=f"{os.path.basename(self.db_path)}.backup"
    )
    
    if backup_path:
      try:
        shutil.copy2(self.db_path, backup_path)
        self.log(f"Backup créé: {backup_path}")
      except Exception as e:
        self.log(f"Erreur backup: {e}", 'ERROR')
  
  def _restore_db(self) -> None:
    backup_path = filedialog.askopenfilename(
      title="Sélectionner le backup",
      filetypes=[("SQLite DB", "*.db"), ("Tous", "*.*")]
    )
    
    if backup_path:
      if messagebox.askyesno("Confirmer", "Remplacer la base actuelle par le backup ?"):
        try:
          self.conn.close()
          shutil.copy2(backup_path, self.db_path)
          self._connect_db(self.db_path)
          self.log("Base restaurée depuis backup")
        except Exception as e:
          self.log(f"Erreur restore: {e}", 'ERROR')
  
  def _show_er_diagram(self) -> None:
    messagebox.showinfo("Diagramme ER", "Fonctionnalité de diagramme ER à implémenter")
  
  def _compare_databases(self) -> None:
    messagebox.showinfo("Comparaison", "Fonctionnalité de comparaison à implémenter")
  
  def _show_query_history(self) -> None:
    popup = Toplevel(self.root)
    popup.title("Historique des requêtes")
    popup.geometry("600x400")
    
    history_text = Text(popup, font=('Courier', 9))
    history_text.pack(fill='both', expand=True, padx=10, pady=10)
    
    for entry in self.query_history.get_history():
      history_text.insert(END, f"[{entry['timestamp']}]\n")
      history_text.insert(END, f"{entry['query']}\n")
      history_text.insert(END, f"Résultats: {entry['result_count']} | Temps: {entry['execution_time']:.3f}s\n")
      history_text.insert(END, "-" * 60 + "\n\n")
    
    history_text.config(state='disabled')
  
  def _show_query_favorites(self) -> None:
    popup = Toplevel(self.root)
    popup.title("Favoris de requêtes")
    popup.geometry("600x400")
    
    Label(popup, text="Requêtes favorites:", font=('Arial', 10, 'bold')).pack(pady=5)
    
    listbox = Listbox(popup, font=('Courier', 9))
    listbox.pack(fill='both', expand=True, padx=10, pady=10)
    
    for fav in self.query_history.get_favorites():
      listbox.insert(END, f"{fav['name']}: {fav['query'][:50]}...")
  
  def _explain_query(self) -> None:
    messagebox.showinfo("Explain", "Fonctionnalité EXPLAIN QUERY PLAN à implémenter")
  
  def _manage_triggers(self) -> None:
    popup = Toplevel(self.root)
    popup.title("Gestionnaire de triggers")
    popup.geometry("500x400")
    
    trigger_text = Text(popup, font=('Courier', 9))
    trigger_text.pack(fill='both', expand=True, padx=10, pady=10)
    
    self.cursor.execute("SELECT sql FROM sqlite_master WHERE type='trigger'")
    triggers = self.cursor.fetchall()
    
    if triggers:
      for trig in triggers:
        trigger_text.insert(END, trig[0] + ";\n\n")
    else:
      trigger_text.insert(END, "Aucun trigger trouvé")
  
  def _manage_views(self) -> None:
    popup = Toplevel(self.root)
    popup.title("Gestionnaire de vues")
    popup.geometry("500x400")
    
    view_text = Text(popup, font=('Courier', 9))
    view_text.pack(fill='both', expand=True, padx=10, pady=10)
    
    self.cursor.execute("SELECT sql FROM sqlite_master WHERE type='view'")
    views = self.cursor.fetchall()
    
    if views:
      for view in views:
        view_text.insert(END, view[0] + ";\n\n")
    else:
      view_text.insert(END, "Aucune vue trouvée")
  
  def _schema_migrations(self) -> None:
    messagebox.showinfo("Migrations", "Système de migrations de schéma à implémenter")
  
  def _data_validation(self) -> None:
    messagebox.showinfo("Validation", "Règles de validation de données à implémenter")
  
  def _customize_colors(self) -> None:
    messagebox.showinfo("Couleurs", "Personnalisation des couleurs à implémenter")
  
  def _export_schema(self) -> None:
    if not self.conn:
      return
    
    file_path = filedialog.asksaveasfilename(
      defaultextension=".sql",
      filetypes=[("SQL", "*.sql")]
    )
    
    if file_path:
      with open(file_path, 'w', encoding='utf-8') as f:
        f.write(self.schema_text.get('1.0', END))
      self.log(f"Schéma exporté: {file_path}")
  
  def _save_session(self) -> None:
    session_data = {
      'db_path': self.db_path,
      'current_table': self.current_table,
      'theme': self.theme_manager.current_theme,
      'zoom': self.table.zoom_level if hasattr(self, 'table') else 1.0
    }
    
    file_path = filedialog.asksaveasfilename(
      defaultextension=".session",
      filetypes=[("Session", "*.session")]
    )
    
    if file_path:
      with open(file_path, 'w') as f:
        json.dump(session_data, f, indent=2)
      self.log(f"Session sauvegardée: {file_path}")
  
  def _load_session(self) -> None:
    file_path = filedialog.askopenfilename(
      filetypes=[("Session", "*.session")]
    )
    
    if file_path:
      try:
        with open(file_path, 'r') as f:
          session_data = json.load(f)
        
        if session_data.get('db_path') and os.path.exists(session_data['db_path']):
          self._connect_db(session_data['db_path'])
          
          if session_data.get('current_table'):
            idx = self.table_combo['values'].index(session_data['current_table'])
            self.table_combo.current(idx)
            self.load_table()
          
          if session_data.get('theme'):
            self._set_theme(session_data['theme'])
          
          self.log(f"Session chargée: {file_path}")
        else:
          messagebox.showerror("Erreur", "Base de données introuvable")
      except Exception as e:
        self.log(f"Erreur chargement session: {e}", 'ERROR')
  
  def _show_shortcuts(self) -> None:
    popup = Toplevel(self.root)
    popup.title("Raccourcis clavier")
    popup.geometry("400x500")
    
    shortcuts_text = Text(popup, font=('Courier', 10))
    shortcuts_text.pack(fill='both', expand=True, padx=10, pady=10)
    
    shortcuts = """
=== RACCOURCIS CLAVIER ===

Ctrl+O          Ouvrir une base de données
Ctrl+S          Sauvegarder les modifications
Ctrl+Z          Annuler (Undo)
Ctrl+Y          Refaire (Redo)
Ctrl+F          Rechercher dans la table
Ctrl+Shift+F    Recherche globale
Ctrl+N          Ajouter une ligne
Ctrl++          Zoom avant
Ctrl+-          Zoom arrière
Delete          Supprimer la ligne sélectionnée
F5              Rafraîchir / Exécuter SQL
Ctrl+C          Copier la cellule sélectionnée
Ctrl+V          Coller dans la cellule
Double-clic     Éditer la cellule
Clic droit      Menu contextuel
    """
    
    shortcuts_text.insert('1.0', shortcuts)
    shortcuts_text.config(state='disabled')
  
  def _show_about(self) -> None:
    messagebox.showinfo(
      "À propos",
      "SQLite DB Editor Pro - Ultimate Edition\n\n"
      "Éditeur SQLite professionnel avec fonctionnalités avancées\n\n"
      "Version 2.0\n"
      "© 2025"
    )
  
  def _start_auto_save(self) -> None:
    """Démarre l'auto-save périodique."""
    def auto_save():
      while True:
        time.sleep(self.auto_save_interval)
        if self.auto_save_enabled.get() and self.conn:
          try:
            self.conn.commit()
            self.log("Auto-save effectué", 'INFO')
          except:
            pass
  
    thread = threading.Thread(target=auto_save, daemon=True)
    thread.start()
  
  def _on_closing(self) -> None:
    """Gestion de la fermeture de l'application."""
    if self.conn:
      if messagebox.askyesno("Quitter", "Sauvegarder les modifications avant de quitter ?"):
        self.conn.commit()
      self.conn.close()
    
    self.save_config()
    self.root.destroy()


# Import nécessaire pour simpledialog
from tkinter import simpledialog


def main():
  root = Tk()
  app = SQLiteEditorPro(root)
  root.mainloop()


if __name__ == "__main__":
  main()