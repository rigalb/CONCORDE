#!/usr/bin/python3
# -*- coding: utf-8 -*-

"""
utils.py - Boite a outils utilitaires Python
=============================================
Classes disponibles :
  - Colors          : codes ANSI, colorisation de texte
  - Log             : logging niveaux multiples, historique, stats
  - Timer           : chronometrage simple et multi-laps
  - ProgressBar     : barre de progression terminal
  - JsonFileManager : lecture/ecriture JSON robuste avec cache
  - ErrorHandler    : gestion et historique d'erreurs
  - PipInstaller    : installation de paquets pip avec proxy
  - FileTree        : affichage arborescence de dossiers
  - Plotter         : graphes matplotlib (line, bar, scatter, subplots)

Usage demo :
  python3 utils.py --demo
  python3 utils.py --install <paquet> [--proxy http://...]
  python3 utils.py --tree [dossier]
"""

# =============================================================================
# IMPORTS STANDARD - tous verifies et necessaires
# =============================================================================

import os
import re
import sys
import json
import time
import inspect
import argparse
import subprocess

from pathlib import       Path
from datetime import      datetime, timedelta
from contextlib import    contextmanager
from dataclasses import   dataclass, field
from typing import        Any, Dict, List, Optional, Tuple, Union


# =============================================================================
# IMPORTS OPTIONNELS - charges a la demande pour eviter les erreurs fatales
# =============================================================================

def _try_import_matplotlib():
    """Tente d'importer matplotlib, retourne None si absent."""
    try:
        import matplotlib
        import matplotlib.pyplot as plt
        import matplotlib.gridspec as gridspec
        return plt, gridspec
    except ImportError:
        return None, None


# =============================================================================
# COLORS - codes ANSI + methodes utilitaires
# =============================================================================

class Colors:
    """
    Centralise tous les codes de couleur ANSI.
    Utilisation : Colors.redbold, Colors.colorize(...), etc.
    Compatible Linux/macOS. Sur Windows, activer ANSI via os.system('color').
    """

    # --- noirs et gris ---
    black        = '\033[0;30m'
    darkgray     = '\033[1;30m'

    # --- rouges ---
    red          = '\033[0;31m'
    redbold      = '\033[1;31m'
    reditalic    = '\033[3;31m'
    redunderline = '\033[4;31m'
    redblink     = '\033[5;31m'
    redinverse   = '\033[7;31m'

    # --- verts ---
    green        = '\033[0;32m'
    lightgreen   = '\033[1;32m'

    # --- jaunes ---
    yellow       = '\033[0;33m'
    yellowbold   = '\033[1;33m'
    yellowitalic = '\033[3;33m'
    yellowunder  = '\033[4;33m'
    yellowblink  = '\033[5;33m'

    # --- bleus ---
    blue         = '\033[0;34m'
    lightblue    = '\033[1;34m'

    # --- violets ---
    purple       = '\033[0;35m'
    lightpurple  = '\033[1;35m'

    # --- cyans ---
    cyan         = '\033[0;36m'
    cyanbold     = '\033[1;36m'
    cyanitalic   = '\033[3;36m'
    cyanunder    = '\033[4;36m'
    cyanblink    = '\033[5;36m'

    # --- blancs ---
    white        = '\033[0;37m'
    whitebold    = '\033[1;37m'
    whiteitalic  = '\033[3;37m'
    whiteunder   = '\033[4;37m'
    whiteblink   = '\033[5;37m'

    # --- reset ---
    nc           = '\033[0m'

    # ------------------------------------------------------------------

    @classmethod
    def strip(cls, text: str) -> str:
        """Supprime tous les codes ANSI d'une chaine."""
        return re.sub(r'\033\[[0-9;]*m', '', text)

    @classmethod
    def colorize(cls, text: str, color_name: str, reset: bool = True) -> str:
        """
        Applique une couleur par nom ('redbold', 'cyan', ...).
        Si la couleur est inconnue, retourne le texte sans modification.
        """
        code = getattr(cls, color_name.lower(), cls.nc)
        suffix = cls.nc if reset else ''
        return f"{code}{text}{suffix}"

    @classmethod
    def by_value(cls, value: float,
                 pos: str = 'lightgreen',
                 neg: str = 'redbold',
                 zero: str = 'yellowbold') -> str:
        """Retourne un code couleur selon le signe d'une valeur numerique."""
        if value > 0:
            return getattr(cls, pos, cls.lightgreen)
        if value < 0:
            return getattr(cls, neg, cls.redbold)
        return getattr(cls, zero, cls.yellowbold)

    @classmethod
    def demo(cls) -> None:
        """Affiche toutes les couleurs disponibles."""
        attrs = [a for a in vars(cls) if not a.startswith('_') and isinstance(getattr(cls, a), str)]
        print(f"\n{'='*50}")
        print("  DEMO Colors")
        print(f"{'='*50}")
        for name in sorted(attrs):
            code = getattr(cls, name)
            print(f"  {code}Colors.{name:<20}{cls.nc}  -> {repr(code)}")
        print()


# alias court pour usage interne (conserve la compatibilite avec l'ancien code)
c = Colors


# =============================================================================
# LOG - systeme de logging configurable
# =============================================================================

class Log:
    """
    Systeme de logging avec niveaux, couleurs, timestamps, historique et stats.

    Niveaux (du plus critique au plus verbeux) :
      critical > error > warning > info > debug > trace

    Exemple :
      log = Log(level='debug', show_timestamp=True)
      log.info("Demarrage")
      log.debug("Valeur : {val}", val=42)
    """

    LEVELS: Dict[str, int] = {
        'critical': 0,
        'error':    1,
        'warning':  2,
        'info':     3,
        'debug':    4,
        'trace':    5,
    }

    COLORS: Dict[str, str] = {
        'critical': c.redbold + c.redblink,
        'error':    c.redbold,
        'warning':  c.yellowbold,
        'info':     c.cyanbold,
        'debug':    c.lightblue,
        'trace':    c.darkgray,
    }

    # ------------------------------------------------------------------

    def __init__(self,
                 level: str          = 'info',
                 show_timestamp: bool = False,
                 show_caller: bool    = False,
                 quiet: bool          = False,
                 max_history: int     = 50,
                 args: Any            = None):
        """
        level          : niveau de log initial
        show_timestamp : affiche l'heure pour debug/trace
        show_caller    : affiche fichier:ligne de l'appelant
        quiet          : desactive toute sortie
        max_history    : nombre de messages conserves en memoire
        args           : namespace argparse (surcharge level si log_level present)
        """
        # resolution du niveau depuis args si fourni
        if args is not None:
            if hasattr(args, 'log_level') and args.log_level:
                level = args.log_level
            elif hasattr(args, 'verbose') and args.verbose:
                level = 'debug'
            elif hasattr(args, 'quiet') and args.quiet:
                quiet = True

        self._level        = self.LEVELS.get(level.lower(), 3)
        self.show_timestamp = show_timestamp
        self.show_caller    = show_caller
        self.quiet          = quiet
        self.max_history    = max_history

        self._stats: Dict[str, int]   = {k: 0 for k in self.LEVELS}
        self._history: List[Dict]     = []
        self._session_start: datetime = datetime.now()

    # --- getter / setter niveau ---

    @property
    def level(self) -> str:
        """Retourne le nom du niveau actuel."""
        return self._level_name(self._level)

    @level.setter
    def level(self, value: str) -> None:
        """Change le niveau par son nom."""
        if value.lower() not in self.LEVELS:
            self.warning(f"Niveau inconnu : {value}")
            return
        old = self.level
        self._level = self.LEVELS[value.lower()]
        self.info(f"Niveau de log : {old} -> {value}")

    def _level_name(self, numeric: int) -> str:
        """Convertit un entier en nom de niveau."""
        for name, val in self.LEVELS.items():
            if val == numeric:
                return name
        return 'info'

    # --- methode principale ---

    def log(self, msg: str, level_name: str, **kwargs) -> None:
        """Enregistre et affiche un message si le niveau est actif."""
        if self.quiet:
            return
        if self.LEVELS.get(level_name, 99) > self._level:
            return

        self._stats[level_name] += 1

        # formatage des arguments nommés
        if kwargs:
            try:
                msg = msg.format(**kwargs)
            except (KeyError, ValueError):
                pass  # garde le message brut en cas d'erreur de format

        # construction du prefixe
        color     = self.COLORS.get(level_name, '')
        prefix    = f"{color}[{level_name.upper():^8}]{c.nc}"
        timestamp = ''
        caller    = ''

        if self.show_timestamp:
            timestamp = f" [{time.strftime('%H:%M:%S')}]"

        if self.show_caller:
            frame = inspect.currentframe()
            # remonte deux niveaux : log() -> critical/error/... -> appelant
            if frame and frame.f_back and frame.f_back.f_back:
                fr = frame.f_back.f_back
                fname = os.path.basename(fr.f_code.co_filename)
                caller = f" [{fname}:{fr.f_lineno}]"

        full = f"{prefix}{timestamp}{caller} {msg}"

        try:
            print(full)
        except Exception:
            # fallback sans ANSI si le terminal ne supporte pas
            print(f"[{level_name.upper()}] {c.strip(msg)}")

        self._add_history(level_name, msg)

    def _add_history(self, level: str, message: str) -> None:
        """Ajoute une entree dans l'historique circulaire."""
        self._history.append({
            'level':   level,
            'message': message,
            'time':    time.strftime('%Y-%m-%d %H:%M:%S'),
        })
        if len(self._history) > self.max_history:
            self._history.pop(0)

    # --- methodes de convenance ---

    def critical(self, msg: str, **kw) -> None: self.log(msg, 'critical', **kw)
    def error   (self, msg: str, **kw) -> None: self.log(msg, 'error',    **kw)
    def warning (self, msg: str, **kw) -> None: self.log(msg, 'warning',  **kw)
    def info    (self, msg: str, **kw) -> None: self.log(msg, 'info',     **kw)
    def debug   (self, msg: str, **kw) -> None: self.log(msg, 'debug',    **kw)
    def trace   (self, msg: str, **kw) -> None: self.log(msg, 'trace',    **kw)

    def separator(self, char: str = '-', width: int = 60, level: str = 'info') -> None:
        """Affiche une ligne de separation."""
        self.log(char * width, level)

    def toggle_quiet(self) -> None:
        """Bascule le mode silencieux."""
        self.quiet = not self.quiet
        if not self.quiet:
            self.info("Mode silencieux desactive")

    # --- context managers ---

    @contextmanager
    def timing(self, name: str, level: str = 'debug'):
        """Mesure et affiche le temps d'execution d'un bloc."""
        t0 = time.perf_counter()
        self.debug(f"Debut : {name}")
        try:
            yield
        finally:
            elapsed = time.perf_counter() - t0
            self.log(f"Fin : {name} ({elapsed:.4f}s)", level)

    @contextmanager
    def progress_ctx(self, total: int, name: str = ""):
        """
        Context manager de progression minimal (mis a jour manuelle).
        Exemple :
          with log.progress_ctx(100, 'chargement') as p:
              for i in range(100):
                  p.update()
        """
        class _Tracker:
            def __init__(self_, logger, total_, name_):
                self_.logger  = logger
                self_.total   = total_
                self_.current = 0
                self_.name    = name_
                self_.t0      = time.perf_counter()

            def update(self_, n: int = 1, msg: str = '') -> None:
                self_.current += n
                pct  = self_.current / self_.total * 100 if self_.total else 0
                rate = self_.current / max(time.perf_counter() - self_.t0, 1e-9)
                line = f"{self_.name} {self_.current}/{self_.total} ({pct:.1f}%) {rate:.1f}/s"
                if msg:
                    line += f" - {msg}"
                self_.logger.debug(line)

        tracker = _Tracker(self, total, name)
        try:
            yield tracker
        finally:
            elapsed = time.perf_counter() - tracker.t0
            self.info(f"{name} termine : {tracker.current}/{total} en {elapsed:.2f}s")

    # --- stats et historique ---

    @property
    def stats(self) -> Dict[str, Any]:
        """Retourne les statistiques de la session."""
        total    = sum(self._stats.values())
        duration = datetime.now() - self._session_start
        secs     = max(duration.total_seconds(), 1)
        return {
            'by_level':    dict(self._stats),
            'total':       total,
            'duration':    str(duration).split('.')[0],
            'rate_per_min': round(total / secs * 60, 2),
            'level':       self.level,
        }

    def get_history(self, n: Optional[int] = None, level: Optional[str] = None) -> List[Dict]:
        """
        Retourne l'historique.
        n     : nombre de derniers messages (None = tous)
        level : filtre par niveau
        """
        hist = self._history if level is None else [h for h in self._history if h['level'] == level]
        return hist[-n:] if n else hist

    def dump_stats(self) -> None:
        """Affiche un resume de session."""
        s = self.stats
        self.separator('=', 50)
        self.info("RESUME SESSION")
        self.info(f"  Duree       : {s['duration']}")
        self.info(f"  Total msgs  : {s['total']}")
        self.info(f"  Debit       : {s['rate_per_min']} msg/min")
        for lvl, cnt in s['by_level'].items():
            if cnt:
                self.info(f"  {lvl:<10}: {cnt}")
        self.separator('=', 50)

    # --- operateurs ---

    def __repr__(self) -> str:
        return f"Log(level='{self.level}', quiet={self.quiet})"

    def __str__(self) -> str:
        return f"Log [{self.level}]"

    # --- demo ---

    @staticmethod
    def demo() -> None:
        """Demonstration complete de la classe Log."""
        print(f"\n{'='*50}")
        print("  DEMO Log")
        print(f"{'='*50}")
        log = Log(level='trace', show_timestamp=True)
        log.critical("Ceci est un message CRITICAL")
        log.error   ("Ceci est un message ERROR")
        log.warning ("Ceci est un message WARNING")
        log.info    ("Ceci est un message INFO")
        log.debug   ("Ceci est un message DEBUG")
        log.trace   ("Ceci est un message TRACE")
        log.info    ("Formatage : valeur={val} nom={nom}", val=42, nom='test')
        log.separator()
        with log.timing("operation demo"):
            time.sleep(0.05)
        log.dump_stats()


# =============================================================================
# TIMER - chronometrage avec laps et statistiques
# =============================================================================

class Timer:
    """
    Chronometre multi-laps avec stats (min, max, moyenne).

    Exemple :
      t = Timer("traitement")
      t.start()
      ...
      t.lap("etape 1")
      ...
      t.stop()
      print(t)
      t.report()
    """

    def __init__(self, name: str = "timer"):
        self._name:    str              = name
        self._start:   Optional[float]  = None
        self._stop:    Optional[float]  = None
        self._laps:    List[Tuple[str, float]] = []  # (nom, timestamp absolu)
        self._running: bool             = False

    # --- getter / setter ---

    @property
    def name(self) -> str:
        return self._name

    @name.setter
    def name(self, value: str) -> None:
        self._name = str(value)

    @property
    def elapsed(self) -> float:
        """Temps ecoule en secondes (depuis start, ou total si stoppe)."""
        if self._start is None:
            return 0.0
        end = self._stop if self._stop else time.perf_counter()
        return end - self._start

    @property
    def is_running(self) -> bool:
        return self._running

    # --- controle ---

    def start(self) -> 'Timer':
        """Demarre (ou redemarre) le chronometre."""
        self._start   = time.perf_counter()
        self._stop    = None
        self._running = True
        self._laps    = []
        return self  # chainable

    def stop(self) -> float:
        """Arrete le chronometre, retourne le temps total en secondes."""
        if not self._running:
            return self.elapsed
        self._stop    = time.perf_counter()
        self._running = False
        return self.elapsed

    def lap(self, label: str = '') -> float:
        """
        Enregistre un lap. Retourne le temps depuis le lap precedent (ou le debut).
        """
        if not self._running:
            return 0.0
        now = time.perf_counter()
        self._laps.append((label or f"lap_{len(self._laps)+1}", now))
        # temps depuis dernier repere
        prev = self._laps[-2][1] if len(self._laps) > 1 else self._start
        return now - prev

    def reset(self) -> 'Timer':
        """Remet le chronometre a zero."""
        self._start   = None
        self._stop    = None
        self._laps    = []
        self._running = False
        return self

    def restart(self) -> 'Timer':
        """Reset + start en une seule operation."""
        return self.reset().start()

    # --- stats laps ---

    def lap_durations(self) -> List[Tuple[str, float]]:
        """Retourne les durees de chaque interval entre laps."""
        if not self._laps:
            return []
        result = []
        prev = self._start or 0.0
        for label, ts in self._laps:
            result.append((label, ts - prev))
            prev = ts
        return result

    def lap_stats(self) -> Dict[str, float]:
        """Statistiques sur les durees de laps (min, max, moyenne, total)."""
        durations = [d for _, d in self.lap_durations()]
        if not durations:
            return {}
        return {
            'count':   len(durations),
            'total':   sum(durations),
            'min':     min(durations),
            'max':     max(durations),
            'average': sum(durations) / len(durations),
        }

    def report(self) -> None:
        """Affiche un rapport complet dans le terminal."""
        w = 50
        print(f"\n{'='*w}")
        print(f"  Timer : {self._name}")
        print(f"  Elapsed : {self._format(self.elapsed)}")
        print(f"{'='*w}")
        laps = self.lap_durations()
        if laps:
            print(f"  {'Lap':<20} {'Duree':>10}  {'Cumul':>10}")
            print(f"  {'-'*42}")
            cumul = 0.0
            for label, dur in laps:
                cumul += dur
                print(f"  {label:<20} {self._format(dur):>10}  {self._format(cumul):>10}")
            print(f"  {'-'*42}")
            stats = self.lap_stats()
            print(f"  min={self._format(stats['min'])}  "
                  f"max={self._format(stats['max'])}  "
                  f"moy={self._format(stats['average'])}")
        print()

    # --- formatage ---

    @staticmethod
    def _format(seconds: float) -> str:
        """Formate des secondes en chaine lisible."""
        if seconds < 1e-3:
            return f"{seconds*1e6:.1f}us"
        if seconds < 1.0:
            return f"{seconds*1e3:.2f}ms"
        if seconds < 60:
            return f"{seconds:.3f}s"
        m = int(seconds // 60)
        s = seconds % 60
        return f"{m}m{s:.1f}s"

    # --- operateurs ---

    def __add__(self, other: 'Timer') -> float:
        """Somme des temps elapsed de deux timers."""
        return self.elapsed + other.elapsed

    def __lt__(self, other: 'Timer') -> bool:
        return self.elapsed < other.elapsed

    def __le__(self, other: 'Timer') -> bool:
        return self.elapsed <= other.elapsed

    def __gt__(self, other: 'Timer') -> bool:
        return self.elapsed > other.elapsed

    def __ge__(self, other: 'Timer') -> bool:
        return self.elapsed >= other.elapsed

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Timer):
            return NotImplemented
        return abs(self.elapsed - other.elapsed) < 1e-9

    def __repr__(self) -> str:
        state = "running" if self._running else "stopped"
        return f"Timer('{self._name}', {state}, elapsed={self._format(self.elapsed)})"

    def __str__(self) -> str:
        return f"[{self._name}] {self._format(self.elapsed)}"

    # --- context manager ---

    def __enter__(self) -> 'Timer':
        return self.start()

    def __exit__(self, *_) -> None:
        self.stop()

    # --- demo ---

    @staticmethod
    def demo() -> None:
        """Demonstration complete de la classe Timer."""
        print(f"\n{'='*50}")
        print("  DEMO Timer")
        print(f"{'='*50}")

        t = Timer("demo")
        with t:
            for i in range(4):
                time.sleep(0.03 * (i + 1))
                t.lap(f"etape_{i+1}")

        t.report()

        # comparaison de deux timers
        t2 = Timer("rapide").start()
        time.sleep(0.01)
        t2.stop()
        t3 = Timer("lent").start()
        time.sleep(0.05)
        t3.stop()
        print(f"  {t2} < {t3} : {t2 < t3}")
        print(f"  somme elapsed : {Timer._format(t2 + t3)}")
        print()


# =============================================================================
# PROGRESSBAR - barre de progression terminal
# =============================================================================

class ProgressBar:
    """
    Barre de progression affichee dans le terminal.

    Exemple :
      bar = ProgressBar(total=100, prefix="chargement", width=40)
      for i in range(100):
          time.sleep(0.01)
          bar.update(1)
      bar.done()
    """

    def __init__(self,
                 total:    int  = 100,
                 prefix:   str  = '',
                 suffix:   str  = '',
                 width:    int  = 40,
                 fill:     str  = '#',
                 empty:    str  = '-',
                 show_pct: bool = True,
                 show_eta: bool = True):
        """
        total    : valeur cible
        prefix   : texte avant la barre
        suffix   : texte apres la barre
        width    : largeur de la barre en caracteres
        fill     : caractere de remplissage
        empty    : caractere de fond
        show_pct : afficher le pourcentage
        show_eta : afficher le temps restant estime
        """
        self._total    = max(total, 1)
        self._prefix   = prefix
        self._suffix   = suffix
        self._width    = width
        self._fill     = fill[0] if fill else '#'
        self._empty    = empty[0] if empty else '-'
        self._show_pct = show_pct
        self._show_eta = show_eta

        self._current: int   = 0
        self._start:   float = time.perf_counter()
        self._done:    bool  = False

        self._render()  # affichage initial a 0%

    # --- getter / setter ---

    @property
    def current(self) -> int:
        return self._current

    @property
    def total(self) -> int:
        return self._total

    @total.setter
    def total(self, value: int) -> None:
        self._total = max(value, 1)

    @property
    def percent(self) -> float:
        return self._current / self._total * 100

    # --- mise a jour ---

    def update(self, increment: int = 1) -> None:
        """Avance la barre de `increment` unites."""
        if self._done:
            return
        self._current = min(self._current + increment, self._total)
        self._render()
        if self._current >= self._total:
            self.done()

    def set(self, value: int) -> None:
        """Positionne la barre a une valeur absolue."""
        if self._done:
            return
        self._current = max(0, min(value, self._total))
        self._render()

    def reset(self) -> None:
        """Remet la barre a zero."""
        self._current = 0
        self._start   = time.perf_counter()
        self._done    = False
        self._render()

    def done(self) -> None:
        """Marque la barre comme complete et passe a la ligne."""
        if self._done:
            return
        self._current = self._total
        self._done    = True
        self._render()
        print()  # saut de ligne apres la barre

    # --- rendu ---

    def _render(self) -> None:
        """Construit et affiche la barre sur la ligne courante."""
        filled    = int(self._width * self._current / self._total)
        bar       = self._fill * filled + self._empty * (self._width - filled)
        pct_str   = f" {self.percent:5.1f}%" if self._show_pct else ''
        eta_str   = self._eta_str()           if self._show_eta else ''
        suffix    = f" {self._suffix}"        if self._suffix   else ''

        line = f"\r{self._prefix} [{bar}]{pct_str}{eta_str}{suffix}  "
        sys.stdout.write(line)
        sys.stdout.flush()

    def _eta_str(self) -> str:
        """Calcule et formate l'ETA."""
        if self._current <= 0:
            return ' ETA:--:--'
        elapsed = time.perf_counter() - self._start
        rate    = self._current / elapsed
        if rate <= 0:
            return ' ETA:--:--'
        remaining = (self._total - self._current) / rate
        m = int(remaining // 60)
        s = int(remaining % 60)
        return f' ETA:{m:02d}:{s:02d}'

    # --- operateurs ---

    def __repr__(self) -> str:
        return f"ProgressBar({self._current}/{self._total}, {self.percent:.1f}%)"

    def __str__(self) -> str:
        return f"{self._prefix} {self.percent:.1f}%"

    def __len__(self) -> int:
        return self._total

    def __bool__(self) -> bool:
        return not self._done

    # --- demo ---

    @staticmethod
    def demo() -> None:
        """Demonstration de ProgressBar."""
        print(f"\n{'='*50}")
        print("  DEMO ProgressBar")
        print(f"{'='*50}")
        print("  Barre standard :")
        bar = ProgressBar(total=50, prefix="  chargement", width=35)
        for _ in range(50):
            time.sleep(0.02)
            bar.update()

        print("  Barre personnalisee :")
        bar2 = ProgressBar(total=30, prefix="  export", fill='=', empty='.', width=30)
        for _ in range(30):
            time.sleep(0.015)
            bar2.update()
        print()


# =============================================================================
# JSONFILEMANAGER - lecture / ecriture JSON robuste
# =============================================================================

class JsonFileManager:
    """
    Gestionnaire JSON avec cache, ecriture atomique et sauvegardes.

    Exemple :
      jm = JsonFileManager(base_dir='/tmp')
      jm.write('config.json', {'key': 'val'})
      data = jm.read('config.json')
    """

    _CACHE_TTL_SECONDS: int = 300  # 5 minutes

    def __init__(self,
                 base_dir:       Optional[str] = None,
                 default_indent: int           = 4,
                 log:            Optional[Log] = None):
        """
        base_dir       : dossier de base (defaut : dossier du script)
        default_indent : indentation JSON par defaut
        log            : instance Log partagee (cree une interne si None)
        """
        self._base        = Path(base_dir) if base_dir else Path(os.path.dirname(os.path.abspath(__file__)))
        self._indent      = default_indent
        self._log         = log or Log(level='warning')

        self._cache:        Dict[str, Any]      = {}
        self._cache_times:  Dict[str, datetime] = {}
        self._stats                             = {'hits': 0, 'misses': 0, 'writes': 0, 'errors': 0}

    # --- getter / setter ---

    @property
    def base_dir(self) -> Path:
        return self._base

    @base_dir.setter
    def base_dir(self, value: Union[str, Path]) -> None:
        self._base = Path(value)

    @property
    def cache_ttl(self) -> int:
        return self._CACHE_TTL_SECONDS

    # --- chemins ---

    def resolve(self, path: Union[str, Path]) -> Path:
        """Retourne un Path absolu : relatif -> base_dir / path."""
        p = Path(path)
        return p if p.is_absolute() else self._base / p

    # --- lecture ---

    def read(self, path: Union[str, Path],
             use_cache: bool = True,
             encoding: str   = 'utf-8') -> Optional[Dict[str, Any]]:
        """
        Lit un fichier JSON. Retourne None en cas d'erreur.
        use_cache : utilise le cache interne (TTL = 5 min)
        """
        p         = self.resolve(path)
        cache_key = str(p)

        # verification cache
        if use_cache and cache_key in self._cache:
            age = (datetime.now() - self._cache_times[cache_key]).total_seconds()
            if age < self._CACHE_TTL_SECONDS:
                self._stats['hits'] += 1
                self._log.trace(f"Cache hit : {p.name}")
                return self._cache[cache_key]

        self._stats['misses'] += 1

        if not p.exists():
            self._log.warning(f"Fichier absent : {p}")
            return None

        if not os.access(p, os.R_OK):
            self._log.error(f"Permission refusee (lecture) : {p}")
            self._stats['errors'] += 1
            return None

        try:
            with open(p, 'r', encoding=encoding) as fh:
                data = json.load(fh)

            if use_cache:
                self._cache[cache_key]       = data
                self._cache_times[cache_key] = datetime.now()

            self._log.trace(f"Lu : {p.name}")
            return data

        except json.JSONDecodeError as e:
            self._log.error(f"JSON invalide dans {p.name} : {e}")
        except UnicodeDecodeError as e:
            self._log.error(f"Encodage incorrect dans {p.name} : {e}")
        except IOError as e:
            self._log.error(f"Erreur I/O sur {p.name} : {e}")

        self._stats['errors'] += 1
        return None

    # --- ecriture ---

    def write(self, path: Union[str, Path],
              data:          Any,
              backup:        bool = True,
              indent:        Optional[int] = None,
              encoding:      str  = 'utf-8',
              atomic:        bool = True) -> bool:
        """
        Ecrit data dans un fichier JSON.
        backup : cree un .bak avant d'ecraser
        atomic : ecrit dans un .tmp puis renomme (evite la corruption)
        """
        p      = self.resolve(path)
        indent = indent if indent is not None else self._indent

        p.parent.mkdir(parents=True, exist_ok=True)

        # sauvegarde de l'existant
        if backup and p.exists():
            bak = p.with_suffix('.bak')
            try:
                bak.write_bytes(p.read_bytes())
                self._log.trace(f"Backup cree : {bak.name}")
            except Exception as e:
                self._log.warning(f"Backup impossible : {e}")

        try:
            if atomic:
                tmp = p.with_suffix('.tmp')
                with open(tmp, 'w', encoding=encoding) as fh:
                    json.dump(data, fh, indent=indent, ensure_ascii=False)
                tmp.replace(p)  # operation atomique sur la plupart des OS
            else:
                with open(p, 'w', encoding=encoding) as fh:
                    json.dump(data, fh, indent=indent, ensure_ascii=False)

            # mise a jour cache
            cache_key                    = str(p)
            self._cache[cache_key]       = data
            self._cache_times[cache_key] = datetime.now()
            self._stats['writes']       += 1
            self._log.trace(f"Ecrit : {p.name}")
            return True

        except Exception as e:
            self._log.error(f"Erreur ecriture {p.name} : {e}")
            self._stats['errors'] += 1
            # nettoyage du .tmp si present
            tmp = p.with_suffix('.tmp')
            if tmp.exists():
                try:
                    tmp.unlink()
                except Exception:
                    pass
            return False

    # --- utilitaires cache ---

    def invalidate(self, path: Optional[Union[str, Path]] = None) -> None:
        """Vide le cache pour un fichier ou entierement si path=None."""
        if path:
            key = str(self.resolve(path))
            self._cache.pop(key, None)
            self._cache_times.pop(key, None)
            self._log.trace(f"Cache invalide : {key}")
        else:
            n = len(self._cache)
            self._cache.clear()
            self._cache_times.clear()
            self._log.trace(f"Cache vide ({n} entrees)")

    @property
    def cache_stats(self) -> Dict[str, Any]:
        """Retourne les statistiques d'utilisation."""
        total    = self._stats['hits'] + self._stats['misses']
        hit_rate = self._stats['hits'] / total * 100 if total else 0.0
        return {
            'hit_rate_pct': round(hit_rate, 1),
            **self._stats,
            'cached_files': len(self._cache),
        }

    def file_info(self, path: Union[str, Path], max_age_days: int = 30) -> Dict[str, Any]:
        """Retourne des metadonnees sur un fichier."""
        p = self.resolve(path)
        info: Dict[str, Any] = {
            'path':     str(p),
            'exists':   p.exists(),
            'readable': False,
            'writable': False,
            'size':     None,
            'age_days': None,
            'status':   'absent',
        }
        if not p.exists():
            return info

        try:
            st  = p.stat()
            age = (datetime.now() - datetime.fromtimestamp(st.st_mtime)).days
            info.update({
                'readable': os.access(p, os.R_OK),
                'writable': os.access(p, os.W_OK),
                'size':     st.st_size,
                'age_days': age,
                'status':   'old' if age > max_age_days else 'recent',
            })
        except OSError as e:
            self._log.warning(f"Stat impossible sur {p} : {e}")
            info['status'] = 'error'

        return info

    def cleanup_backups(self, keep: int = 5) -> None:
        """Supprime les anciens .bak en gardant les `keep` plus recents."""
        baks = sorted(self._base.glob('*.bak'), key=lambda f: f.stat().st_mtime)
        for bak in baks[:-keep] if len(baks) > keep else []:
            try:
                bak.unlink()
                self._log.trace(f"Backup supprime : {bak.name}")
            except Exception as e:
                self._log.warning(f"Impossible de supprimer {bak.name} : {e}")

    # --- operateurs ---

    def __contains__(self, path: Union[str, Path]) -> bool:
        """Permet : 'config.json' in jm"""
        return self.resolve(path).exists()

    def __repr__(self) -> str:
        return f"JsonFileManager(base='{self._base}', cache={len(self._cache)} entries)"

    # --- demo ---

    def demo(self) -> None:
        """Demonstration avec un fichier temporaire."""
        import tempfile

        print(f"\n{'='*50}")
        print("  DEMO JsonFileManager")
        print(f"{'='*50}")

        with tempfile.TemporaryDirectory() as tmp:
            jm   = JsonFileManager(base_dir=tmp, log=Log(level='trace'))
            data = {'projet': 'utils', 'version': 1, 'actif': True, 'valeurs': [1, 2, 3]}

            print("  Ecriture...")
            ok = jm.write('test.json', data)
            print(f"  Succes : {ok}")

            print("  Lecture (cache miss)...")
            result = jm.read('test.json')
            print(f"  Resultat : {result}")

            print("  Lecture (cache hit)...")
            jm.read('test.json')

            print(f"  Stats cache : {jm.cache_stats}")
            print(f"  Info fichier : {jm.file_info('test.json')}")
            print(f"  'test.json' in jm : {'test.json' in jm}")
        print()


# =============================================================================
# ERRORHANDLER - suivi et gestion des erreurs
# =============================================================================

class ErrorHandler:
    """
    Gestionnaire d'erreurs avec historique, compteurs et context manager.

    Exemple :
      eh = ErrorHandler(log)
      with eh.guard("parsing", continue_on_error=True):
          int("abc")  # ne leve pas d'exception grace a continue_on_error
    """

    def __init__(self, log: Optional[Log] = None, max_history: int = 100):
        self._log         = log or Log(level='warning')
        self._max_history = max_history
        self._counts:  Dict[str, int]  = {}
        self._history: List[Dict]      = []

    # --- getter ---

    @property
    def total_errors(self) -> int:
        return sum(self._counts.values())

    @property
    def error_counts(self) -> Dict[str, int]:
        return dict(self._counts)

    # --- context manager ---

    @contextmanager
    def guard(self, operation: str,
              continue_on_error: bool = False,
              max_errors:        Optional[int] = None,
              level:             str  = 'error'):
        """
        Protege un bloc de code.
        continue_on_error : si True, avale l'exception (log seulement)
        max_errors        : leve une exception apres N erreurs sur la meme operation
        level             : niveau de log pour l'erreur capturee
        """
        t0 = time.perf_counter()
        try:
            yield
        except KeyboardInterrupt:
            self._log.warning(f"Interruption : {operation}")
            raise
        except Exception as e:
            duration = time.perf_counter() - t0

            record = {
                'operation': operation,
                'type':      type(e).__name__,
                'message':   str(e),
                'time':      datetime.now().isoformat(),
                'duration':  round(duration, 4),
            }

            self._counts[operation] = self._counts.get(operation, 0) + 1
            self._history.append(record)

            if len(self._history) > self._max_history:
                self._history.pop(0)

            getattr(self._log, level)(
                f"[{operation}] {type(e).__name__}: {e}"
            )

            if max_errors and self._counts[operation] >= max_errors:
                self._log.critical(
                    f"Trop d'erreurs sur '{operation}' ({max_errors}), abandon"
                )
                raise

            if not continue_on_error:
                raise

    # --- utilitaires ---

    def reset(self, operation: Optional[str] = None) -> None:
        """Remet les compteurs a zero pour une operation ou tout."""
        if operation:
            removed = self._counts.pop(operation, 0)
            self._log.debug(f"Compteur reinitialise : {operation} (etait {removed})")
        else:
            total = self.total_errors
            self._counts.clear()
            self._log.debug(f"Tous les compteurs reinitialises (total etait {total})")

    def summary(self) -> Dict[str, Any]:
        """Retourne un resume des erreurs."""
        one_hour_ago = datetime.now() - timedelta(hours=1)
        recent       = [e for e in self._history
                        if datetime.fromisoformat(e['time']) > one_hour_ago]

        type_counts: Dict[str, int] = {}
        for e in self._history:
            type_counts[e['type']] = type_counts.get(e['type'], 0) + 1

        return {
            'total':              self.total_errors,
            'operations':         len(self._counts),
            'recent_1h':          len(recent),
            'by_operation':       dict(self._counts),
            'by_type':            dict(sorted(type_counts.items(), key=lambda x: -x[1])),
        }

    def dump_summary(self) -> None:
        """Affiche le resume dans le terminal."""
        s = self.summary()
        self._log.separator('=', 50)
        self._log.info("RESUME ERREURS")
        self._log.info(f"  Total         : {s['total']}")
        self._log.info(f"  Operations    : {s['operations']}")
        self._log.info(f"  Derniere heure: {s['recent_1h']}")
        for op, n in s['by_operation'].items():
            self._log.info(f"  {op:<25} : {n}")
        self._log.separator('=', 50)

    # --- operateurs ---

    def __repr__(self) -> str:
        return f"ErrorHandler(total={self.total_errors}, operations={len(self._counts)})"

    def __len__(self) -> int:
        return self.total_errors

    def __bool__(self) -> bool:
        """True s'il n'y a aucune erreur."""
        return self.total_errors == 0

    # --- demo ---

    @staticmethod
    def demo() -> None:
        """Demonstration de ErrorHandler."""
        print(f"\n{'='*50}")
        print("  DEMO ErrorHandler")
        print(f"{'='*50}")
        log = Log(level='debug')
        eh  = ErrorHandler(log)

        with eh.guard("parsing", continue_on_error=True):
            int("abc")

        with eh.guard("division", continue_on_error=True):
            _ = 1 / 0

        with eh.guard("parsing", continue_on_error=True):
            json.loads("invalid json {{")

        eh.dump_summary()
        print(f"  bool(eh) si aucune erreur : {bool(eh)}")
        print(f"  len(eh) : {len(eh)}")
        print()


# =============================================================================
# PIPINSTALLER - installation de paquets pip avec gestion proxy
# =============================================================================

class PipInstaller:
    """
    Installe des paquets Python via pip, avec support proxy et diagnostic.

    Exemple :
      installer = PipInstaller(log, proxy='http://user:pass@host:3128')
      code = installer.install('requests')
    """

    # codes de retour
    RC_OK         = 0
    RC_ALREADY    = 1
    RC_FAIL_PIP   = 2
    RC_TIMEOUT    = 3
    RC_NOT_FOUND  = 4
    RC_UNKNOWN    = 5

    # -- messages pip -> code / log
    _PATTERNS: List[Tuple[str, str, str]] = [
        ('requirement already satisfied', 'info',    'Module deja installe'),
        ('proxy',                         'error',   'Probleme de connexion au proxy'),
        ('ssl',                           'error',   'Erreur SSL'),
        ('could not find a version',      'error',   'Module introuvable sur PyPI'),
        ('permission denied',             'error',   'Permission refusee (essayer --user)'),
        ('requires',                      'error',   'Conflit de dependances'),
        ('network is unreachable',        'error',   'Aucune connexion reseau'),
        ('temporary failure in name',     'error',   'Erreur DNS'),
        ('no space left',                 'error',   'Disque plein'),
    ]

    def __init__(self, log: Optional[Log] = None, proxy: Optional[str] = None,
                 timeout: int = 120):
        self._log     = log or Log(level='info')
        self._proxy   = proxy
        self._timeout = timeout

    # --- getter / setter ---

    @property
    def proxy(self) -> Optional[str]:
        return self._proxy

    @proxy.setter
    def proxy(self, value: Optional[str]) -> None:
        self._proxy = value

    # --- installation ---

    def install(self, package: str, upgrade: bool = True, user: bool = False) -> int:
        """
        Installe un paquet.
        upgrade : ajoute -U
        user    : ajoute --user
        Retourne un code RC_* de la classe.
        """
        cmd = [sys.executable, '-m', 'pip', 'install']
        if upgrade:
            cmd.append('-U')
        if user:
            cmd.append('--user')
        cmd.append(package)

        env = os.environ.copy()
        if self._proxy:
            env['http_proxy']  = self._proxy
            env['https_proxy'] = self._proxy
            self._log.info(f"Proxy : {self._proxy}")

        self._log.info(f"Installation : {package}")

        try:
            result = subprocess.run(
                cmd,
                env=env,
                capture_output=True,
                text=True,
                timeout=self._timeout,
            )
        except subprocess.TimeoutExpired:
            self._log.error(f"Timeout ({self._timeout}s) depasse")
            return self.RC_TIMEOUT
        except FileNotFoundError:
            self._log.error(f"pip introuvable avec {sys.executable}")
            return self.RC_NOT_FOUND
        except Exception as e:
            self._log.error(f"Erreur inattendue : {type(e).__name__} : {e}")
            return self.RC_UNKNOWN

        # diagnostic de la sortie
        stdout_lc = result.stdout.lower()
        stderr_lc = result.stderr.lower()

        rc = self.RC_FAIL_PIP
        for pattern, level, message in self._PATTERNS:
            if pattern in stdout_lc or pattern in stderr_lc:
                getattr(self._log, level)(message)
                rc = self.RC_OK if level in ('info',) else self.RC_FAIL_PIP
                break
        else:
            if result.returncode == 0:
                self._log.info(f"'{package}' installe avec succes")
                rc = self.RC_OK
            else:
                self._log.error(f"Echec de l'installation de '{package}'")

        # affichage debug de la sortie brute
        if result.stdout.strip():
            self._log.debug("--- PIP STDOUT ---")
            for line in result.stdout.strip().splitlines():
                self._log.debug(f"  {line}")

        if result.stderr.strip():
            self._log.debug("--- PIP STDERR ---")
            for line in result.stderr.strip().splitlines():
                self._log.debug(f"  {line}")

        return rc

    def install_many(self, packages: List[str], **kwargs) -> Dict[str, int]:
        """Installe plusieurs paquets, retourne {package: rc}."""
        return {pkg: self.install(pkg, **kwargs) for pkg in packages}

    def is_installed(self, package: str) -> bool:
        """Verifie si un paquet est importe (ne teste pas la version)."""
        import importlib
        try:
            importlib.import_module(package)
            return True
        except ImportError:
            return False

    # --- demo ---

    @staticmethod
    def demo() -> None:
        """Demonstration (simulation uniquement, pas d'installation reelle)."""
        print(f"\n{'='*50}")
        print("  DEMO PipInstaller")
        print(f"{'='*50}")
        log     = Log(level='debug')
        inst    = PipInstaller(log=log)
        print("  Test is_installed('os') :", inst.is_installed('os'))
        print("  Test is_installed('module_inexistant') :", inst.is_installed('module_inexistant'))
        print("  (Installation reelle non executee en mode demo)")
        print()


# =============================================================================
# FILETREE - affichage d'arborescence de dossiers
# =============================================================================

class FileTree:
    """
    Affiche ou retourne l'arborescence d'un dossier.

    Exemple :
      ft = FileTree(show_hidden=False, max_depth=3)
      ft.print('/etc')
      tree_str = ft.render('/etc')
    """

    _BRANCH = '|-- '
    _LAST   = '`-- '
    _PIPE   = '|   '
    _SPACE  = '    '

    def __init__(self,
                 show_hidden: bool          = False,
                 max_depth:   Optional[int] = None,
                 dirs_only:   bool          = False,
                 sort:        bool          = True):
        """
        show_hidden : inclure les fichiers/dossiers commencant par '.'
        max_depth   : profondeur maximale (None = illimitee)
        dirs_only   : n'afficher que les dossiers
        sort        : trier alphabetiquement
        """
        self._show_hidden = show_hidden
        self._max_depth   = max_depth
        self._dirs_only   = dirs_only
        self._sort        = sort

        # stats de la derniere execution
        self._n_dirs:  int = 0
        self._n_files: int = 0

    # --- getter / setter ---

    @property
    def show_hidden(self) -> bool:
        return self._show_hidden

    @show_hidden.setter
    def show_hidden(self, value: bool) -> None:
        self._show_hidden = value

    @property
    def max_depth(self) -> Optional[int]:
        return self._max_depth

    @max_depth.setter
    def max_depth(self, value: Optional[int]) -> None:
        self._max_depth = value

    @property
    def last_stats(self) -> Dict[str, int]:
        """Statistiques du dernier appel a print/render."""
        return {'dirs': self._n_dirs, 'files': self._n_files}

    # --- rendu ---

    def render(self, root: Union[str, Path] = '.') -> str:
        """Retourne l'arborescence sous forme de chaine."""
        root = Path(root).resolve()
        self._n_dirs  = 0
        self._n_files = 0
        lines = [root.name]
        self._build(root, '', lines, depth=0)
        return '\n'.join(lines)

    def print(self, root: Union[str, Path] = '.') -> None:
        """Affiche l'arborescence dans le terminal."""
        print(self.render(root))
        print(f"\n  {self._n_dirs} dossier(s), {self._n_files} fichier(s)")

    def _build(self, directory: Path, prefix: str,
               lines: List[str], depth: int) -> None:
        """Construction recursive."""
        if self._max_depth is not None and depth >= self._max_depth:
            return

        try:
            entries = list(directory.iterdir())
        except PermissionError:
            lines.append(f"{prefix}{self._LAST}[permission refusee]")
            return

        # filtrages
        if not self._show_hidden:
            entries = [e for e in entries if not e.name.startswith('.')]
        if self._dirs_only:
            entries = [e for e in entries if e.is_dir()]
        if self._sort:
            entries = sorted(entries, key=lambda e: (e.is_file(), e.name.lower()))

        for i, entry in enumerate(entries):
            is_last   = (i == len(entries) - 1)
            connector = self._LAST if is_last else self._BRANCH
            lines.append(f"{prefix}{connector}{entry.name}")

            if entry.is_dir():
                self._n_dirs += 1
                extension = self._SPACE if is_last else self._PIPE
                self._build(entry, prefix + extension, lines, depth + 1)
            else:
                self._n_files += 1

    # --- operateurs ---

    def __repr__(self) -> str:
        return (f"FileTree(hidden={self._show_hidden}, "
                f"max_depth={self._max_depth}, dirs_only={self._dirs_only})")

    def __str__(self) -> str:
        return self.render('.')

    # --- demo ---

    @staticmethod
    def demo() -> None:
        """Demonstration avec un dossier temporaire."""
        import tempfile

        print(f"\n{'='*50}")
        print("  DEMO FileTree")
        print(f"{'='*50}")

        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            # creation d'une arborescence de test
            (base / 'src').mkdir()
            (base / 'src' / 'main.py').write_text('# main')
            (base / 'src' / 'utils.py').write_text('# utils')
            (base / 'docs').mkdir()
            (base / 'docs' / 'readme.md').write_text('# docs')
            (base / 'tests').mkdir()
            (base / 'tests' / 'test_main.py').write_text('# tests')
            (base / 'config.json').write_text('{}')
            (base / '.gitignore').write_text('*.pyc')

            ft = FileTree(show_hidden=False, sort=True)
            ft.print(base)

            print("\n  Avec fichiers caches :")
            ft.show_hidden = True
            ft.print(base)
        print()


# =============================================================================
# PLOTTER - graphes matplotlib simplifies
# =============================================================================

class Plotter:
    """
    Facade autour de matplotlib pour creer des graphes courants rapidement.

    Necessite matplotlib (pip install matplotlib).
    Si matplotlib est absent, les methodes affichent un avertissement.

    Exemple :
      p = Plotter(style='dark_background', figsize=(10, 5))
      p.line([1,2,3,4], [1,4,9,16], title='Carre')
      p.show()
    """

    def __init__(self,
                 figsize:  Tuple[float, float] = (9, 5),
                 style:    str                  = 'default',
                 dpi:      int                  = 100,
                 colormap: str                  = 'tab10'):
        """
        figsize  : taille par defaut des figures (largeur, hauteur) en pouces
        style    : style matplotlib ('ggplot', 'seaborn-v0_8', 'dark_background', ...)
        dpi      : resolution des figures
        colormap : palette de couleurs par defaut pour les series multiples
        """
        self._plt, self._gs = _try_import_matplotlib()
        self._available     = self._plt is not None

        self._figsize  = figsize
        self._style    = style
        self._dpi      = dpi
        self._colormap = colormap

        if self._available:
            try:
                self._plt.style.use(style)
            except OSError:
                pass  # style inconnu -> on garde le defaut

    # --- getter / setter ---

    @property
    def available(self) -> bool:
        """True si matplotlib est installe."""
        return self._available

    @property
    def figsize(self) -> Tuple[float, float]:
        return self._figsize

    @figsize.setter
    def figsize(self, value: Tuple[float, float]) -> None:
        self._figsize = value

    @property
    def style(self) -> str:
        return self._style

    @style.setter
    def style(self, value: str) -> None:
        if self._available:
            try:
                self._plt.style.use(value)
                self._style = value
            except OSError:
                pass

    # --- verification interne ---

    def _check(self) -> bool:
        """Verifie la disponibilite de matplotlib."""
        if not self._available:
            print("  [PLOTTER] matplotlib non disponible. Installer avec : pip install matplotlib")
            return False
        return True

    def _apply_meta(self, ax: Any, title: str, xlabel: str,
                    ylabel: str, grid: bool, legend: bool) -> None:
        """Applique les metadonnees communes a un axe."""
        if title:   ax.set_title(title)
        if xlabel:  ax.set_xlabel(xlabel)
        if ylabel:  ax.set_ylabel(ylabel)
        if grid:    ax.grid(True, alpha=0.3)
        if legend:
            handles, labels = ax.get_legend_handles_labels()
            if labels:
                ax.legend()

    # --- types de graphes ---

    def line(self,
             x:       Any,
             y:       Any,
             label:   str   = '',
             title:   str   = '',
             xlabel:  str   = '',
             ylabel:  str   = '',
             grid:    bool  = True,
             legend:  bool  = True,
             marker:  str   = '',
             color:   Optional[str] = None,
             ax:      Any   = None) -> Any:
        """
        Courbe lineaire.
        x, y : listes ou tableaux numpy.
        Retourne l'axe matplotlib.
        """
        if not self._check():
            return None

        fig_created = ax is None
        if fig_created:
            _, ax = self._plt.subplots(figsize=self._figsize, dpi=self._dpi)

        kwargs: Dict[str, Any] = {}
        if label:  kwargs['label']  = label
        if color:  kwargs['color']  = color
        if marker: kwargs['marker'] = marker

        ax.plot(x, y, **kwargs)
        self._apply_meta(ax, title, xlabel, ylabel, grid, legend)
        return ax

    def bar(self,
            categories: Any,
            values:     Any,
            label:      str   = '',
            title:      str   = '',
            xlabel:     str   = '',
            ylabel:     str   = '',
            grid:       bool  = True,
            horizontal: bool  = False,
            color:      Optional[str] = None,
            ax:         Any   = None) -> Any:
        """
        Graphe en barres (vertical ou horizontal).
        categories : labels des barres.
        values     : valeurs correspondantes.
        """
        if not self._check():
            return None

        fig_created = ax is None
        if fig_created:
            _, ax = self._plt.subplots(figsize=self._figsize, dpi=self._dpi)

        kwargs: Dict[str, Any] = {}
        if label: kwargs['label'] = label
        if color: kwargs['color'] = color

        if horizontal:
            ax.barh(categories, values, **kwargs)
        else:
            ax.bar(categories, values, **kwargs)

        self._apply_meta(ax, title, xlabel, ylabel, grid, legend=bool(label))
        return ax

    def scatter(self,
                x:      Any,
                y:      Any,
                label:  str            = '',
                title:  str            = '',
                xlabel: str            = '',
                ylabel: str            = '',
                grid:   bool           = True,
                size:   float          = 30,
                color:  Optional[str]  = None,
                alpha:  float          = 0.7,
                ax:     Any            = None) -> Any:
        """Nuage de points."""
        if not self._check():
            return None

        fig_created = ax is None
        if fig_created:
            _, ax = self._plt.subplots(figsize=self._figsize, dpi=self._dpi)

        kwargs: Dict[str, Any] = {'s': size, 'alpha': alpha}
        if label: kwargs['label'] = label
        if color: kwargs['color'] = color

        ax.scatter(x, y, **kwargs)
        self._apply_meta(ax, title, xlabel, ylabel, grid, legend=bool(label))
        return ax

    def histogram(self,
                  data:    Any,
                  bins:    int           = 20,
                  label:   str           = '',
                  title:   str           = '',
                  xlabel:  str           = '',
                  ylabel:  str           = 'Frequence',
                  grid:    bool          = True,
                  density: bool          = False,
                  color:   Optional[str] = None,
                  ax:      Any           = None) -> Any:
        """Histogramme."""
        if not self._check():
            return None

        fig_created = ax is None
        if fig_created:
            _, ax = self._plt.subplots(figsize=self._figsize, dpi=self._dpi)

        kwargs: Dict[str, Any] = {'bins': bins, 'density': density, 'alpha': 0.75}
        if label: kwargs['label'] = label
        if color: kwargs['color'] = color

        ax.hist(data, **kwargs)
        self._apply_meta(ax, title, xlabel, ylabel, grid, legend=bool(label))
        return ax

    def subplots(self,
                 rows:    int   = 1,
                 cols:    int   = 2,
                 title:   str   = '',
                 figsize: Optional[Tuple[float, float]] = None,
                 sharex:  bool  = False,
                 sharey:  bool  = False) -> Tuple[Any, Any]:
        """
        Cree une figure avec plusieurs sous-graphes.
        Retourne (fig, axes) ou axes est un tableau numpy d'axes.

        Exemple :
          fig, axes = p.subplots(2, 2, title='Mon tableau de bord')
          p.line([1,2,3], [1,4,9], ax=axes[0][0])
        """
        if not self._check():
            return None, None

        sz  = figsize or (self._figsize[0] * cols * 0.6, self._figsize[1] * rows * 0.7)
        fig, axes = self._plt.subplots(rows, cols, figsize=sz, dpi=self._dpi,
                                       sharex=sharex, sharey=sharey)
        if title:
            fig.suptitle(title, fontsize=14, fontweight='bold')
        fig.tight_layout(pad=2.5)
        return fig, axes

    def multi_line(self,
                   x:      Any,
                   series: Dict[str, Any],
                   title:  str   = '',
                   xlabel: str   = '',
                   ylabel: str   = '',
                   grid:   bool  = True,
                   ax:     Any   = None) -> Any:
        """
        Trace plusieurs courbes sur un meme axe.
        series : {nom: valeurs_y}
        """
        if not self._check():
            return None

        if ax is None:
            _, ax = self._plt.subplots(figsize=self._figsize, dpi=self._dpi)

        for name, y in series.items():
            ax.plot(x, y, label=name)

        self._apply_meta(ax, title, xlabel, ylabel, grid, legend=True)
        return ax

    # --- affichage / sauvegarde ---

    def show(self) -> None:
        """Affiche toutes les figures ouvertes."""
        if self._check():
            self._plt.tight_layout()
            self._plt.show()

    def save(self, path: Union[str, Path], dpi: Optional[int] = None) -> bool:
        """
        Sauvegarde la figure courante.
        Retourne True si reussi.
        """
        if not self._check():
            return False
        try:
            self._plt.savefig(str(path), dpi=dpi or self._dpi, bbox_inches='tight')
            return True
        except Exception as e:
            print(f"  [PLOTTER] Erreur sauvegarde : {e}")
            return False

    def close(self, all_figures: bool = True) -> None:
        """Ferme la ou toutes les figures."""
        if self._check():
            if all_figures:
                self._plt.close('all')
            else:
                self._plt.close()

    def clear(self) -> None:
        """Efface la figure courante."""
        if self._check():
            self._plt.clf()

    # --- operateurs ---

    def __repr__(self) -> str:
        status = "ok" if self._available else "matplotlib manquant"
        return f"Plotter(style='{self._style}', figsize={self._figsize}, status={status})"

    # --- demo ---

    def demo(self) -> None:
        """Demonstration de la classe Plotter (4 types de graphes)."""
        if not self._check():
            return

        import math

        print(f"\n{'='*50}")
        print("  DEMO Plotter")
        print(f"{'='*50}")

        x     = [i * 0.1 for i in range(63)]
        sin_y = [math.sin(v) for v in x]
        cos_y = [math.cos(v) for v in x]

        import random
        random.seed(42)
        scatter_x = [random.gauss(0, 1) for _ in range(80)]
        scatter_y = [x_ * 1.5 + random.gauss(0, 0.5) for x_ in scatter_x]
        hist_data = [random.gauss(50, 15) for _ in range(500)]
        categories = ['A', 'B', 'C', 'D', 'E']
        bar_values = [23, 45, 12, 67, 38]

        fig, axes = self.subplots(2, 2, title="Demo Plotter - apercu des types de graphes")

        # axes[0][0] : multi-lignes
        self.multi_line(x, {'sin': sin_y, 'cos': cos_y},
                        title="Courbes", xlabel="x", ylabel="y",
                        ax=axes[0][0])

        # axes[0][1] : barres
        self.bar(categories, bar_values,
                 title="Barres", xlabel="Cat.", ylabel="Val.",
                 ax=axes[0][1])

        # axes[1][0] : scatter
        self.scatter(scatter_x, scatter_y,
                     title="Scatter", xlabel="x", ylabel="y",
                     ax=axes[1][0])

        # axes[1][1] : histogramme
        self.histogram(hist_data, bins=25,
                       title="Histogramme", xlabel="Valeur",
                       ax=axes[1][1])

        print("  Affichage en cours...")
        self.show()


# =============================================================================
# ARGPARSE + POINT D'ENTREE
# =============================================================================

def _build_parser() -> argparse.ArgumentParser:
    """Construit et retourne le parseur d'arguments."""
    parser = argparse.ArgumentParser(
        prog='utils.py',
        description='Boite a outils Python - utilitaires generaux',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemples :
  python3 utils.py --demo
  python3 utils.py --demo --classes log timer
  python3 utils.py --install requests numpy
  python3 utils.py --install requests --proxy http://user:pass@host:3128
  python3 utils.py --tree /home/user --depth 3 --hidden
  python3 utils.py --tree . --dirs-only
        """,
    )

    # --- demo ---
    demo_group = parser.add_argument_group('Demo des classes')
    demo_group.add_argument(
        '--demo',
        action='store_true',
        help='Lance la demonstration de toutes les classes (ou celles specifiees avec --classes)',
    )
    demo_group.add_argument(
        '--classes',
        nargs='+',
        metavar='NOM',
        choices=['colors', 'log', 'timer', 'progressbar', 'json', 'errorhandler', 'pip', 'filetree', 'plotter'],
        help='Limite la demo aux classes specifiees',
    )

    # --- installation pip ---
    pip_group = parser.add_argument_group('Installation de paquets pip')
    pip_group.add_argument(
        '--install',
        nargs='+',
        metavar='PAQUET',
        help='Installe un ou plusieurs paquets Python',
    )
    pip_group.add_argument(
        '--proxy',
        metavar='URL',
        help='Proxy HTTP(S) pour pip (ex: http://user:pass@host:3128)',
    )
    pip_group.add_argument(
        '--no-upgrade',
        action='store_true',
        help='Ne pas ajouter -U lors de l\'installation',
    )

    # --- arborescence ---
    tree_group = parser.add_argument_group('Affichage d\'arborescence')
    tree_group.add_argument(
        '--tree',
        metavar='DOSSIER',
        nargs='?',
        const='.',
        help='Affiche l\'arborescence d\'un dossier (defaut : .)',
    )
    tree_group.add_argument(
        '--depth',
        type=int,
        metavar='N',
        default=None,
        help='Profondeur maximale de l\'arborescence',
    )
    tree_group.add_argument(
        '--hidden',
        action='store_true',
        help='Inclure les fichiers/dossiers caches (commen\'cant par .)',
    )
    tree_group.add_argument(
        '--dirs-only',
        action='store_true',
        help='N\'afficher que les dossiers',
    )

    # --- logging ---
    log_group = parser.add_argument_group('Logging')
    log_group.add_argument(
        '--log-level',
        metavar='NIVEAU',
        default='info',
        choices=list(Log.LEVELS.keys()),
        help='Niveau de log (defaut : info)',
    )

    return parser


def main() -> int:
    """Point d'entree principal."""
    parser = _build_parser()
    args   = parser.parse_args()

    log = Log(level=args.log_level, show_timestamp=False)

    # aucun argument : afficher l'aide
    if len(sys.argv) == 1:
        parser.print_help()
        return 0

    # --- demo ---
    if args.demo:
        classes_to_demo = args.classes or [
            'colors', 'log', 'timer', 'progressbar',
            'json', 'errorhandler', 'pip', 'filetree', 'plotter',
        ]

        dispatch = {
            'colors':      Colors.demo,
            'log':         Log.demo,
            'timer':       Timer.demo,
            'progressbar': ProgressBar.demo,
            'json':        JsonFileManager(log=log).demo,
            'errorhandler':ErrorHandler.demo,
            'pip':         PipInstaller.demo,
            'filetree':    FileTree.demo,
            'plotter':     Plotter(style='ggplot').demo,
        }

        for name in classes_to_demo:
            fn = dispatch.get(name)
            if fn:
                try:
                    fn()
                except Exception as e:
                    log.error(f"Erreur demo '{name}' : {e}")

        return 0

    # --- installation pip ---
    if args.install:
        installer = PipInstaller(log=log, proxy=args.proxy)
        results   = installer.install_many(
            args.install,
            upgrade=not args.no_upgrade,
        )
        for pkg, rc in results.items():
            status = 'OK' if rc == PipInstaller.RC_OK else f'ECHEC (code {rc})'
            log.info(f"  {pkg:<30} : {status}")
        return 0 if all(rc == PipInstaller.RC_OK for rc in results.values()) else 1

    # --- arborescence ---
    if args.tree is not None:
        ft = FileTree(
            show_hidden=args.hidden,
            max_depth=args.depth,
            dirs_only=args.dirs_only,
        )
        ft.print(args.tree)
        return 0

    parser.print_help()
    return 0


# =============================================================================
# ENTREE
# =============================================================================

if __name__ == '__main__':
    sys.exit(main())