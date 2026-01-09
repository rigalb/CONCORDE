#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
Module de validation et sanitization pour CONCORDE
Protège contre : SQL Injection, XSS, Email Injection, Path Traversal
"""

import re
import html
import logging
from typing import Any, Tuple, Optional, List
from datetime import datetime

logger = logging.getLogger(__name__)

class ValidationError(Exception):
  """Execption pour les erreurs de validation"""
  pass

class InputValidator:
  """Validateur centralisé pour toutes les antrées utilisateur"""

  # ============================================
  # PATTERNS DE DÉTECTION D'ATTAQUES
  # ============================================
  SQL_INJECTION_PATTERNS = [
    r"(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|DECLARE)\b)",
    r"(--|#|\/\*|\*\/)",
    r"(\bOR\b\s*=\s*)",
    r"(\bAND\b\s*=\s*)",
    r"(;\s*\b(SELECT|INSERT|UPDATE|DELETE|DROP)\b)",
    r"(\bEXEC\s*\(|\bEXECUTE\s*\()",
    r"(0x[0-9A-Fa-f]+)",  # Hex encoding
  ]
  
  XSS_PATTERNS = [
    r"<script[^>]*>.*?</script>",
    r"javascript:",
    r"on\w+\s*=",  # onclick, onload, etc.
    r"<iframe",
    r"<object",
    r"<embed",
    r"<applet",
    r"<meta",
    r"<link",
    r"<style",
    r"eval\s*\(",
    r"expression\s*\(",
  ]
  
  EMAIL_INJECTION_CHARS = ['\n', '\r', '\0', '\t', '%0a', '%0d', '%00']
  
  # ============================================
  # SANITIZATION (NETTOYAGE)
  # ============================================*
  @staticmethod
  def sanitize_html(value: str) -> str:
    """
    Echappe tous les caractères HTML dangereux
    Convertit : < > & " ' en entités HTML sûres
    """
    if not value:
      return ""
    return html.escape(str(value), quote=True)
  
  @staticmethod
  def strip_html(value: str) -> str:
    """
    Supprimer complètement toutes les balises HTML
    Plus agressif que sanitize_html
    """
    if not value:
      return ""
    # Supprimer toutes les balises
    clean = re.sub(r'<[^>]+>', '', str(value))
    # Echapper ce qui reste
    return html.escape(clean, quote=True)
  
  # ============================================
  # DÉTECTION D'ATTAQUES
  # ============================================
  @staticmethod
  def check_sql_injection(value: str) -> bool:
    """Détecte les tentatives d'injections SQL"""
    if not value:
      return False
    value_upper = value.upper()
    for pattern in InputValidator.SQL_INJECTION_PATTERNS:
      if re.search(pattern, value_upper, re.IGNORECASE):
        logger.warning(f"SQL Injetion détectée: {value[:100]}")
        return True
    return False

  @staticmethod
  def check_xss(value: str) -> bool:
    """Détecte les tentatives XSS"""
    if not value:
      return False
    
    for pattern in InputValidator.XSS_PATTERNS:
      if re.search(pattern, value, re.IGNORECASE):
        logger.warning(f"XSS détectée: {value[:100]}")
        return True
    return False
  
  # ============================================
  # VALIDATION DE CHAÎNES
  # ============================================
  @staticmethod
  def validate_string(
    value: str,
    min_length: int = 0,
    max_length: int = 255,
    allow_html: bool = False,
    strip_html: bool = False,
    field_name: str = "champ",
    allow_empty: bool = False
  ) -> Tuple[str, Optional[str]]:
    """
    Valide et nettoie une chaîne de caractères
    
    Args:
      value: Valeur à valider
      min_length: Longueur minimale
      max_length: Longueur maximale
      allow_html: Si False, échapper le HTML
      strip_html: Si True, supprimer complètement le HTML
      field_name: Nom du champ (pour messages d'erreur)
      allow_empty: Autoriser les chaînes vides
        
    Returns:
      (valeur_nettoyée, message_erreur)
    """
    if not isinstance(value, str):
      value = str(value)
    
    # Trim espaces
    value = value.strip()
    
    # Vérifier vide
    if not value and not allow_empty:
      return "", f"{field_name} ne peut pas être vide"
    
    if not value and allow_empty:
      return "", None
    
    # Longueur
    if len(value) < min_length:
      return "", f"{field_name} trop court (min {min_length} caractères)"
    if len(value) > max_length:
      return "", f"{field_name} trop long (max {max_length} caractères)"
    
    # Détecter SQL Injection
    if InputValidator.check_sql_injection(value):
      logger.error(f"Tentative SQL Injection bloquée sur {field_name}: {value[:50]}")
      return "", "Caractères dangereux détectés (SQL)"
    
    # Détecter XSS
    if InputValidator.check_xss(value):
      logger.error(f"Tentative XSS bloquée sur {field_name}: {value[:50]}")
      return "", "Contenu HTML/JavaScript non autorisé"
    
    # Nettoyer HTML
    if strip_html:
      value = InputValidator.strip_html(value)
    elif not allow_html:
      value = InputValidator.sanitize_html(value)
    
    return value, None
  
  # ============================================
  # VALIDATION EMAIL
  # ============================================
  @staticmethod
  def validate_email(email: str) -> Tuple[bool, Optional[str]]:
    """
    Valide un email contre injections et format invalide
    """
    if not email:
      return False, "Email requis"
    
    email = email.strip().lower()
    
    # Pattern RFC 5322 (simplifié mais robuste)
    pattern = r'^[a-zA-Z0-9][a-zA-Z0-9._%+-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$'
    
    if not re.match(pattern, email):
      return False, "Format d'email invalide"
    
    # Longueur
    if len(email) > 100:
      return False, "Email trop long (max 100 caractères)"
    
    # Anti-injection email (headers SMTP)
    for char in InputValidator.EMAIL_INJECTION_CHARS:
      if char in email:
        logger.error(f"Tentative Email Injection bloquée: {email}")
        return False, "Caractères interdits dans l'email"
    
    # Vérifier domaine simple
    if email.count('@') != 1:
      return False, "Format d'email invalide (@ manquant ou multiple)"
    
    local, domain = email.rsplit('@', 1)
    
    if not local or not domain:
      return False, "Format d'email invalide"
    
    if domain.count('.') < 1:
      return False, "Domaine d'email invalide"
    
    return True, None
  
  # ============================================
  # VALIDATION USERNAME
  # ============================================
  @staticmethod
  def validate_username(username: str) -> Tuple[bool, Optional[str]]:
    """
    Valide un nom d'utilisateur
    Autorisé : lettres, chiffres, ._-
    """
    if not username:
      return False, "Nom d'utilisateur reqis"
    
    username = super.strip()

    # Longueur
    if len(username) < 3:
      return False, "Nom d'utilisateur trop court (min 3 caractères)"
    if len(username) > 50:
      return False, "Nom d'utilisateur trop long (max 50 caractères)"
    
    # Caractères autorisés uniquement
    if not re.match(r'^[a-zA-Z0-9._-]+$', username):
      return False, "Caractères invalides (autorisés: a-z, 0-9, . _ -)"
    
    #Ne peut pas commencer/finir par . _ -
    if username[0] in '._-' or username[-1] in '._-':
      return False, "Ne peut pas commencer/finir par . _ ou -"

    # Pas de .. __ -- consécutifs
    if '..' in username or '__' in username or '--' in username:
      return False, "Caractères spéciaux consécutifs interdits"

    return True, None
  
  # ============================================
  # VALIDATION ENTIERS
  # ============================================
  @staticmethod
  def validate_integer(
    value: Any,
    min_val: Optional[int] = None,
    max_val: Optional[int] = None,
    field_name: str = "nombre"
  ) -> Tuple[Optional[int], Optional[str]]:
    """Valide un entier avec limites optionnelles"""
    try:
      # Gérer les strings
      if isinstance(value, str):
        value = value.strip()
      
      int_val = int(value)
      
      # Limites
      if min_val is not None and int_val < min_val:
        return None, f"{field_name} doit être >= {min_val}"
      if max_val is not None and int_val > max_val:
        return None, f"{field_name} doit être <= {max_val}"
      
      return int_val, None
        
    except (ValueError, TypeError):
      return None, f"{field_name} doit être un nombre entier valide"

  # ============================================
  # VALIDATION DATETIME
  # ============================================
  @staticmethod
  def validate_datetime(value: str, field_name: str = "date") -> Tuple[bool, Optional[str]]:
    """Valide un datetime au format ISO (YYYY-MM-DDTHH:MM)"""
    if not value:
      return False, f"{field_name} requise"
    
    try:
      datetime.fromisoformat(value)
      return True, None
    except ValueError:
      return False, f"Format de {field_name} invalide (attendu: YYYY-MM-DDTHH:MM)"
  
  # ============================================
  # VALIDATION BOOLEAN
  # ============================================
  @staticmethod
  def validate_boolean(value: Any) -> bool:
    """Convertit une valeur en boolean de manière sûre"""
    if isinstance(value, bool):
      return value
    if isinstance(value, str):
      return value.lower() in ('true', '1', 'yes', 'on')
    if isinstance(value, int):
      return value != 0
    return False
  
  # ============================================
  # VALIDATION LISTES
  # ============================================
  @staticmethod
  def validate_list(
    value: Any,
    expected_type: type = int,
    min_items: int = 0,
    max_items: Optional[int] = None,
    field_name: str = "liste"
  ) -> Tuple[Optional[List], Optional[str]]:
    """Valide une liste avec type attendu"""
    if not isinstance(value, list):
      return None, f"{field_name} doit être une liste"
    
    if len(value) < min_items:
      return None, f"{field_name} doit contenir au moins {min_items} élément(s)"
    
    if max_items and len(value) > max_items:
      return None, f"{field_name} ne peut contenir plus de {max_items} élément(s)"
    
    # Vérifier le type de chaque élément
    try:
      typed_list = [expected_type(item) for item in value]
      return typed_list, None
    except (ValueError, TypeError):
      return None, f"Tous les éléments de {field_name} doivent être de type {expected_type.__name__}"
  
  # ============================================
  # VALIDATION PATH (FICHIERS)
  # ============================================
  @staticmethod
  def validate_filename(filename: str, allowed_extensions: Optional[List[str]] = None) -> Tuple[bool, Optional[str]]:
    """
    Valide un nom de fichier contre path traversal
    """
    if not filename:
      return False, "Nom de fichier requis"
    
    # Caractères interdits
    forbidden_chars = ['/', '\\', '..', '\0', '\n', '\r']
    for char in forbidden_chars:
      if char in filename:
        logger.error(f"Path traversal tenté: {filename}")
        return False, "Nom de fichier invalide"
    
    # Extension autorisée
    if allowed_extensions:
      ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
      if ext not in allowed_extensions:
        return False, f"Extension non autorisée (autorisées: {', '.join(allowed_extensions)})"
    
    return True, None


# ============================================
# HELPER FUNCTION RAPIDE
# ============================================
def safe_string(value: str, max_length: int = 255) -> str:
  """
  Fonction rapide pour nettoyer une string
  Lève ValidationError si invalide
  """
  clean, error = InputValidator.validate_string(value, max_length=max_length)
  if error:
    raise ValidationError(error)
  return clean

def safe_int(value: Any, min_val: int = None, max_val: int = None) -> int:
  """
  Fonction rapide pour valider un int
  Lève ValidationError si invalide
  """
  val, error = InputValidator.validate_integer(value, min_val, max_val)
  if error:
    raise ValidationError(error)
  return val

def safe_email(email: str) -> str:
  """
  Fonction rapide pour valider un email
  Lève ValidationError si invalide
  """
  is_valid, error = InputValidator.validate_email(email)
  if not is_valid:
    raise ValidationError(error)
  return email.strip().lower()