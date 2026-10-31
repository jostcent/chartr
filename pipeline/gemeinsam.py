"""Gemeinsame Bausteine: Konfiguration, Klientenliste, Prompts, lokaler LM-Studio-Server.

Datenschutz: Texte gehen nur an einen Server auf diesem Rechner. Andere Adressen werden abgelehnt,
und Proxy-Einstellungen des Systems werden ignoriert, damit nichts über einen Proxy umgeleitet wird.
"""
import json
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

HIER = Path(__file__).resolve().parent
LOKAL = {"localhost", "127.0.0.1", "::1"}
_OHNE_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def lade_config() -> dict:
    pfad = HIER / "config.json"
    if not pfad.is_file():
        sys.exit("config.json fehlt. Kopieren Sie config.example.json und passen Sie die Pfade an.")
    cfg = json.loads(pfad.read_text(encoding="utf-8"))
    if urlsplit(cfg["lm_studio"]["url"]).hostname not in LOKAL:
        sys.exit("lm_studio.url muss auf diesen Rechner zeigen (localhost). Es wurde nichts verarbeitet.")
    return cfg


def lade_klienten(cfg: dict) -> dict:
    """Code -> Kürzel, zum Beispiel {"XY1": "A.B."}. Fehlt die Liste oder ist sie leer: Abbruch, bevor etwas passiert."""
    try:
        roh = json.loads(Path(cfg["klienten_json"]).read_text(encoding="utf-8"))
        tabelle = {c: k.strip() for c, k in roh.items() if isinstance(k, str) and k.strip()}
    except (OSError, ValueError, AttributeError):
        sys.exit("Klientenliste fehlt oder ist nicht lesbar. Es wurde nichts verarbeitet.")
    if not tabelle:
        sys.exit("Klientenliste ist leer. Es wurde nichts verarbeitet.")
    if len(set(tabelle.values())) < len(tabelle):  # Kürzel selbst nicht ausgeben: sie landen sonst im Protokoll
        print("ACHTUNG: Mindestens ein Kürzel ist mehrfach vergeben. Bitte die Klientenliste prüfen.")
    return tabelle


def lade_prompt(name: str, kuerzel: str) -> str:
    return (HIER / "prompts" / f"{name}.txt").read_text(encoding="utf-8").replace("{kuerzel}", kuerzel)


def server_erreichbar(cfg: dict) -> bool:
    u = urlsplit(cfg["lm_studio"]["url"])
    try:
        with _OHNE_PROXY.open(f"{u.scheme}://{u.netloc}/v1/models", timeout=8) as r:
            return r.status == 200
    except OSError:
        return False


def frage_lm_studio(cfg: dict, system_prompt: str, text: str) -> str:
    lm = cfg["lm_studio"]
    nutzlast = {"model": lm["modell"], "temperature": lm.get("temperatur", 0.3), "max_tokens": lm.get("max_tokens", 1500),
                "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": text}]}
    anfrage = urllib.request.Request(lm["url"], data=json.dumps(nutzlast).encode("utf-8"),
                                     headers={"Content-Type": "application/json"})
    with _OHNE_PROXY.open(anfrage, timeout=1200) as r:
        antwort = json.loads(r.read().decode("utf-8"))
    try:
        return antwort["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError):
        raise RuntimeError("Unerwartete Antwort von LM Studio.") from None
