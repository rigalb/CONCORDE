#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
validators.py — Validation et sanitisation des entrées utilisateur
CONCORDE

Protège contre : injection SQL, XSS, injection email (headers SMTP),
                 path traversal, dépassement de longueur.

Architecture :
  - ValidatorConfig  : configuration injectable (patterns, limites)
  - InputValidator   : méthodes de classe stateless (pas d'état interne)
  - safe_string / safe_int / safe_email : helpers rapides pour app.py

Usage typique dans app.py :
    from validators import InputValidator, ValidationError, safe_string, safe_int

    titre = safe_string(data.get("titre"), max_length=100)
    effectif = safe_int(data.get("effectif_max"), min_val=1, max_val=500)
    ok, err = InputValidator.validate_email("user@example.com")
"""

import re
import html
import logging
from typing import Any, Tuple, Optional, List
from datetime import datetime

logger = logging.getLogger(__name__)


# ==============================================================================
# EXCEPTIONS
# ==============================================================================

class ValidationError(Exception):
    """
    Levée par les helpers safe_* quand une valeur est invalide.
    app.py la capture dans ses blocs except et retourne un 400.
    """
    pass


# ==============================================================================
# CONFIGURATION
# ==============================================================================

class ValidatorConfig:
    """
    Configuration centralisée du validateur.

    Permet d'ajuster les patterns et limites sans modifier InputValidator.
    Injectée via InputValidator.configure(custom_config).

    Exemple :
        cfg = ValidatorConfig(max_email_length=150)
        InputValidator.configure(cfg)
    """

    def __init__(
        self,
        sql_patterns:           Optional[List[str]] = None,
        xss_patterns:           Optional[List[str]] = None,
        email_injection_chars:  Optional[List[str]] = None,
        max_email_length:       int = 100,
        default_max_string_length: int = 255,
    ):
        # -- Patterns SQL Injection -----------------------------------------
        # Détection en MAJUSCULES (la comparaison se fait sur value.upper())
        self.SQL_INJECTION_PATTERNS: List[str] = sql_patterns or [
            r"(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|DECLARE)\b)",
            r"(--|#|\/\*|\*\/)",          # commentaires SQL
            r"(\bOR\b\s*=\s*)",           # OR = classique
            r"(\bAND\b\s*=\s*)",          # AND = classique
            r"(;\s*\b(SELECT|INSERT|UPDATE|DELETE|DROP)\b)",  # stacked queries
            r"(\bEXEC\s*\(|\bEXECUTE\s*\()",
            r"(0x[0-9A-Fa-f]+)",          # encodage hexadécimal
        ]

        # -- Patterns XSS --------------------------------------------------
        self.XSS_PATTERNS: List[str] = xss_patterns or [
            r"<script[^>]*>.*?</script>",
            r"javascript:",
            r"on\w+\s*=",   # onclick=, onload=, etc.
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

        # -- Caractères interdits dans les headers email (injection SMTP) --
        self.EMAIL_INJECTION_CHARS: List[str] = email_injection_chars or [
            '\n', '\r', '\0', '\t', '%0a', '%0d', '%00',
        ]

        self.MAX_EMAIL_LENGTH:            int = max_email_length
        self.DEFAULT_MAX_STRING_LENGTH:   int = default_max_string_length


# ==============================================================================
# VALIDATEUR PRINCIPAL
# ==============================================================================

class InputValidator:
    """
    Validateur centralisé pour toutes les entrées utilisateur de CONCORDE.

    Toutes les méthodes sont des @classmethod ou @staticmethod — pas d'état
    d'instance. La configuration globale est partagée via _config.

    Principe : toujours retourner (valeur_nettoyée, erreur_ou_None) ou
    (True/False, erreur_ou_None), jamais lever d'exception directement
    (sauf ValidationError pour les helpers rapides safe_*).
    """

    _config: ValidatorConfig = ValidatorConfig()

    @classmethod
    def configure(cls, config: ValidatorConfig) -> None:
        """
        Injecte une configuration personnalisée.
        Appelé une seule fois au démarrage de app.py.
        """
        cls._config = config
        logger.info("InputValidator : configuration mise à jour")


    # -- Sanitisation HTML -------------------------------------------------

    @staticmethod
    def sanitize_html(value: str) -> str:
        """
        Échappe les caractères HTML dangereux : < > & " '
        Utilisé quand on veut conserver le texte mais le rendre inoffensif.
        """
        if not value:
            return ""
        return html.escape(str(value), quote=True)

    @staticmethod
    def strip_html(value: str) -> str:
        """
        Supprime toutes les balises HTML puis échappe le reste.
        Plus agressif que sanitize_html — préférer pour les champs
        où aucun HTML n'est attendu (noms, titres…).
        """
        if not value:
            return ""
        clean = re.sub(r'<[^>]+>', '', str(value))
        return html.escape(clean, quote=True)


    # -- Détection d'attaques ----------------------------------------------

    @classmethod
    def check_sql_injection(cls, value: str) -> bool:
        """
        Retourne True si une tentative d'injection SQL est détectée.
        Note : SQLite utilise des requêtes paramétrées (?) partout dans
        app.py, donc cette vérification est une défense en profondeur,
        pas la seule protection.
        """
        if not value:
            return False
        upper = value.upper()
        for pattern in cls._config.SQL_INJECTION_PATTERNS:
            if re.search(pattern, upper, re.IGNORECASE):
                logger.warning("SQL Injection détectée : %.100s", value)
                return True
        return False

    @classmethod
    def check_xss(cls, value: str) -> bool:
        """Retourne True si une tentative XSS est détectée."""
        if not value:
            return False
        for pattern in cls._config.XSS_PATTERNS:
            if re.search(pattern, value, re.IGNORECASE):
                logger.warning("XSS détectée : %.100s", value)
                return True
        return False


    # -- Validation de chaînes ---------------------------------------------

    @classmethod
    def validate_string(
        cls,
        value:       str,
        min_length:  int  = 0,
        max_length:  int  = 255,
        allow_html:  bool = False,
        strip_html:  bool = False,
        field_name:  str  = "champ",
        allow_empty: bool = False,
    ) -> Tuple[str, Optional[str]]:
        """
        Valide et nettoie une chaîne de caractères.

        Étapes :
          1. Conversion en str si besoin
          2. Trim des espaces
          3. Vérification vide / longueur
          4. Détection SQL injection et XSS
          5. Sanitisation HTML

        Returns:
            (valeur_nettoyée, None)        si valide
            ("",              message_err) si invalide
        """
        if not isinstance(value, str):
            value = str(value)

        value      = value.strip()
        max_length = max_length or cls._config.DEFAULT_MAX_STRING_LENGTH

        if not value:
            if allow_empty:
                return "", None
            return "", f"{field_name} ne peut pas être vide"

        if len(value) < min_length:
            return "", f"{field_name} trop court (min {min_length} caractères)"
        if len(value) > max_length:
            return "", f"{field_name} trop long (max {max_length} caractères)"

        if cls.check_sql_injection(value):
            logger.error("SQL injection bloquée sur %s : %.50s", field_name, value)
            return "", "Caractères dangereux détectés"

        if cls.check_xss(value):
            logger.error("XSS bloquée sur %s : %.50s", field_name, value)
            return "", "Contenu HTML/JavaScript non autorisé"

        if strip_html:
            value = cls.strip_html(value)
        elif not allow_html:
            value = cls.sanitize_html(value)

        return value, None


    # -- Validation email --------------------------------------------------

    @classmethod
    def validate_email(cls, email: str) -> Tuple[bool, Optional[str]]:
        """
        Valide un email contre :
          - format invalide (regex RFC 5322 simplifié)
          - longueur excessive
          - injection de headers SMTP (newlines, null bytes…)
          - domaine sans point

        Returns:
            (True,  None)    si valide
            (False, message) si invalide
        """
        if not email:
            return False, "Email requis"

        email = email.strip().lower()

        pattern = r'^[a-zA-Z0-9][a-zA-Z0-9._%+-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$'
        if not re.match(pattern, email):
            return False, "Format d'email invalide"

        if len(email) > cls._config.MAX_EMAIL_LENGTH:
            return False, f"Email trop long (max {cls._config.MAX_EMAIL_LENGTH} caractères)"

        for char in cls._config.EMAIL_INJECTION_CHARS:
            if char in email:
                logger.error("Email injection bloquée : %.100s", email)
                return False, "Caractères interdits dans l'email"

        if email.count('@') != 1:
            return False, "Format d'email invalide"

        local, domain = email.rsplit('@', 1)
        if not local or not domain or '.' not in domain:
            return False, "Domaine d'email invalide"

        return True, None


    # -- Validation username -----------------------------------------------

    @staticmethod
    def validate_username(username: str) -> Tuple[bool, Optional[str]]:
        """
        Valide un nom d'utilisateur.
        Règles : 3–50 caractères, [a-zA-Z0-9._-], pas de caractères
        spéciaux en début/fin ni consécutifs.
        """
        if not username:
            return False, "Nom d'utilisateur requis"

        username = username.strip()

        if len(username) < 3:
            return False, "Nom d'utilisateur trop court (min 3 caractères)"
        if len(username) > 50:
            return False, "Nom d'utilisateur trop long (max 50 caractères)"
        if not re.match(r'^[a-zA-Z0-9._-]+$', username):
            return False, "Caractères invalides (autorisés : a-z, 0-9, . _ -)"
        if username[0] in '._-' or username[-1] in '._-':
            return False, "Ne peut pas commencer ou finir par . _ -"
        if '..' in username or '__' in username or '--' in username:
            return False, "Caractères spéciaux consécutifs interdits"

        return True, None


    # -- Validation entiers ------------------------------------------------

    @staticmethod
    def validate_integer(
        value:      Any,
        min_val:    Optional[int] = None,
        max_val:    Optional[int] = None,
        field_name: str = "nombre",
    ) -> Tuple[Optional[int], Optional[str]]:
        """
        Valide un entier avec bornes optionnelles.

        Returns:
            (entier, None)    si valide
            (None,  message) si invalide
        """
        try:
            if isinstance(value, str):
                value = value.strip()
            int_val = int(value)
            if min_val is not None and int_val < min_val:
                return None, f"{field_name} doit être ≥ {min_val}"
            if max_val is not None and int_val > max_val:
                return None, f"{field_name} doit être ≤ {max_val}"
            return int_val, None
        except (ValueError, TypeError):
            return None, f"{field_name} doit être un entier valide"


    # -- Validation datetime -----------------------------------------------

    @staticmethod
    def validate_datetime(value: str, field_name: str = "date") -> Tuple[bool, Optional[str]]:
        """
        Valide un datetime au format ISO 8601 (ex : 2025-09-01T08:00).
        Accepte aussi les formats partiels gérés par datetime.fromisoformat().
        """
        if not value:
            return False, f"{field_name} requise"
        try:
            datetime.fromisoformat(value)
            return True, None
        except ValueError:
            return False, f"Format de {field_name} invalide (attendu : AAAA-MM-JJTHH:MM)"


    # -- Validation booléens -----------------------------------------------

    @staticmethod
    def validate_boolean(value: Any) -> bool:
        """
        Convertit de manière sûre une valeur en bool.
        Gère les strings 'true'/'false', les entiers 0/1, etc.
        """
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.lower() in ('true', '1', 'yes', 'on')
        if isinstance(value, int):
            return value != 0
        return False


    # -- Validation listes -------------------------------------------------

    @staticmethod
    def validate_list(
        value:         Any,
        expected_type: type = int,
        min_items:     int  = 0,
        max_items:     Optional[int] = None,
        field_name:    str  = "liste",
    ) -> Tuple[Optional[List], Optional[str]]:
        """
        Valide une liste et caste chaque élément vers expected_type.

        Returns:
            ([items_castés], None)  si valide
            (None, message)         si invalide
        """
        if not isinstance(value, list):
            return None, f"{field_name} doit être une liste"
        if len(value) < min_items:
            return None, f"{field_name} doit contenir au moins {min_items} élément(s)"
        if max_items is not None and len(value) > max_items:
            return None, f"{field_name} ne peut pas dépasser {max_items} élément(s)"
        try:
            return [expected_type(item) for item in value], None
        except (ValueError, TypeError):
            return None, f"Tous les éléments de {field_name} doivent être de type {expected_type.__name__}"


    # -- Validation nom de fichier -----------------------------------------

    @staticmethod
    def validate_filename(
        filename:           str,
        allowed_extensions: Optional[List[str]] = None,
    ) -> Tuple[bool, Optional[str]]:
        """
        Valide un nom de fichier contre le path traversal et les extensions
        non autorisées.
        """
        if not filename:
            return False, "Nom de fichier requis"

        # Caractères interdits (path traversal)
        for char in ('/', '\\', '..', '\0', '\n', '\r'):
            if char in filename:
                logger.error("Path traversal tenté : %.100s", filename)
                return False, "Nom de fichier invalide"

        if allowed_extensions:
            ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
            if ext not in allowed_extensions:
                return False, f"Extension non autorisée (autorisées : {', '.join(allowed_extensions)})"

        return True, None


# ==============================================================================
# HELPERS RAPIDES
# Fonctions raccourcis utilisées massivement dans app.py.
# Lèvent ValidationError (capturée dans les blocs except de chaque route).
# ==============================================================================

def safe_string(value: Any, max_length: int = 255) -> str:
    """Valide et nettoie une chaîne. Lève ValidationError si invalide."""
    clean, error = InputValidator.validate_string(str(value) if value is not None else "",
                                                  max_length=max_length)
    if error:
        raise ValidationError(error)
    return clean

def safe_string_optional(value: Any, max_length: int = 255) -> str:
    """Comme safe_string mais accepte les chaînes vides."""
    clean, error = InputValidator.validate_string(
        str(value) if value is not None else "",
        max_length=max_length,
        allow_empty=True
    )
    if error:
        raise ValidationError(error)
    return clean

def safe_int(value: Any, min_val: int = None, max_val: int = None) -> int:
    """Valide un entier avec bornes. Lève ValidationError si invalide."""
    val, error = InputValidator.validate_integer(value, min_val, max_val)
    if error:
        raise ValidationError(error)
    return val


def safe_email(email: str) -> str:
    """Valide et normalise (lowercase + strip) un email. Lève ValidationError si invalide."""
    is_valid, error = InputValidator.validate_email(email)
    if not is_valid:
        raise ValidationError(error)
    return email.strip().lower()
