"""Erzeugt aus Transkripten und Notizen Berichtsentwürfe, lokal über LM Studio.

    python bericht_batch.py              Verlaufsberichte:  <Code>/*.txt               -> <Code>/BERICHTE/
    python bericht_batch.py --planung    Pflegeplanungen:   <Code>/PFLEGEPLANUNG/*.txt -> <Code>/PFLEGEPLANUNG/ENTWURF/

Für einen periodischen Lauf gedacht (Windows-Aufgabenplanung, alle 30 Minuten). Jeder Entwurf wird von der
Pflegefachperson gelesen und geprüft, bevor er in die Dokumentation kommt.
"""
import csv
import sys
from datetime import datetime
from pathlib import Path

from gemeinsam import frage_lm_studio, lade_config, lade_klienten, lade_prompt, server_erreichbar

# Kürzere Quellen sind leer, abgeschnitten oder werden gerade noch geschrieben: liegen lassen, später erneut prüfen.
MIN_ZEICHEN = 20
# Ein Bericht fasst zusammen. Ist er deutlich länger als die Quelle, hat das Modell vermutlich ergänzt.
# Der Prompt verbietet das, aber ein Prompt ist keine Garantie. Solche Entwürfe heissen "..._PRUEFEN.txt".
VERDACHT_FAKTOR, VERDACHT_MIN_QUELLE = 2.5, 80

# Art: (Prompt, Quellordner im Code-Ordner, Zielordner im Quellordner, Namenszusatz).
# Der Zielordner liegt UNTER der Quelle; glob("*.txt") ist nicht rekursiv, ein Entwurf wird nie zur neuen Quelle.
ARTEN = {"verlauf": ("verlaufsbericht", ".", "BERICHTE", "_Bericht_lokal_"),
         "planung": ("pflegeplanung", "PFLEGEPLANUNG", "ENTWURF", "_Planung_lokal_")}


def verarbeite(cfg, art, ordner: Path, kuerzel: str, protokoll, erledigt: set) -> int:
    prompt, quelle_rel, ziel_rel, zusatz = ARTEN[art]
    quelle = ordner / quelle_rel
    ziel = quelle / ziel_rel
    neu = 0
    for src in sorted(quelle.glob("*.txt")):
        if (ordner.name, art, src.name) in erledigt or any(ziel.glob(f"{src.stem}{zusatz}*.txt")):
            continue
        try:
            text = src.read_text(encoding="utf-8").strip()
        except UnicodeDecodeError:
            print(f"Übersprungen, nicht UTF-8: {ordner.name}/{src.name}")
            continue
        if len(text) < MIN_ZEICHEN:
            continue
        try:
            entwurf = frage_lm_studio(cfg, lade_prompt(prompt, kuerzel), text)
        except (OSError, RuntimeError) as exc:
            print(f"Fehler bei {ordner.name}/{src.name}: {exc}")
            continue
        verdacht = len(entwurf) > VERDACHT_FAKTOR * len(text) or len(text) < VERDACHT_MIN_QUELLE
        ziel.mkdir(parents=True, exist_ok=True)
        aus = ziel / f"{src.stem}{zusatz}{datetime.now():%Y%m%d_%H%M}{'_PRUEFEN' if verdacht else ''}.txt"
        aus.write_text(entwurf, encoding="utf-8")
        protokoll.writerow([f"{datetime.now():%Y-%m-%d %H:%M}", ordner.name, art, src.name, aus.name, len(text), len(entwurf)])
        neu += 1
    return neu


def main():
    art = "planung" if "--planung" in sys.argv else "verlauf"
    cfg = lade_config()
    wurzel = Path(cfg["transkript_wurzel"])
    tabelle = lade_klienten(cfg)                 # zuerst die Liste, dann der Server: fehlt etwas,
    if not server_erreichbar(cfg):               # wird keine einzige Datei angefasst
        sys.exit("LM Studio ist nicht erreichbar. Es wurde nichts verarbeitet.")

    log = wurzel / "_STATISTIK" / "log.csv"      # nur Codes, Dateinamen und Zeichenzahlen, nie Inhalte
    log.parent.mkdir(parents=True, exist_ok=True)
    neu_angelegt = not log.exists()
    erledigt = set()
    if not neu_angelegt:
        with open(log, encoding="utf-8-sig") as f:
            erledigt = {tuple(z[1:4]) for z in csv.reader(f, delimiter=";") if len(z) >= 4}

    gesamt, unbekannt = 0, []
    with open(log, "a", newline="", encoding="utf-8-sig") as f:
        protokoll = csv.writer(f, delimiter=";")
        if neu_angelegt:
            protokoll.writerow(["Zeit", "Code", "Art", "Quelle", "Entwurf", "Zeichen_Quelle", "Zeichen_Entwurf"])
        # Ordner mit "_" am Anfang und reine Jahreszahlen sind keine Code-Ordner.
        for ordner in sorted(p for p in wurzel.iterdir() if p.is_dir() and p.name[0] != "_" and not p.name.isdigit()):
            if ordner.name in tabelle:
                gesamt += verarbeite(cfg, art, ordner, tabelle[ordner.name], protokoll, erledigt)
            else:
                unbekannt.append(ordner.name)    # kein Ersatzkürzel: lieber kein Entwurf als ein falsch zugeordneter

    print(f"{datetime.now():%Y-%m-%d %H:%M} {art}: {gesamt} neu.")
    if unbekannt:
        print(f"ACHTUNG: Ordner ohne Eintrag in der Klientenliste, nichts erzeugt: {', '.join(unbekannt)}")


if __name__ == "__main__":
    main()
