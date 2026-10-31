"""Überwacht den Eingangsordner und transkribiert neue Aufnahmen lokal mit Whisper (pip install faster-whisper).

audio_eingang/<Code>/aufnahme.m4a  ->  transkript_wurzel/<Code>/aufnahme.txt

Verarbeitete Aufnahmen wandern nach audio_eingang/_verarbeitet und werden nach "audio_aufbewahrung_tage"
gelöscht. Beim ersten Start lädt faster-whisper das Modell einmalig aus dem Internet (Hugging Face).
Dabei wird keine Aufnahme übertragen. Danach läuft alles offline.
"""
import shutil
import socket
import sys
import time
from datetime import datetime
from pathlib import Path

from gemeinsam import HIER, lade_config

AUDIO = {".m4a", ".wav", ".mp3", ".ogg", ".flac", ".aac", ".mp4"}


def log(text: str):  # nur Dateinamen, Dauer und Fehler, nie Inhalte
    with open(HIER / "transkription.log", "a", encoding="utf-8") as f:
        f.write(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {text}\n")


def lade_modell(w: dict):
    from faster_whisper import WhisperModel
    for name in filter(None, (w["modell"], w.get("ersatzmodell"))):
        try:
            return WhisperModel(name, device=w.get("geraet", "cpu"), compute_type=w.get("rechenart", "int8"))
        except Exception as exc:  # Modell fehlt oder passt nicht zur Hardware: das nächste versuchen
            log(f"Modell {name} nicht ladbar: {exc}")
    sys.exit("Kein Whisper-Modell ladbar.")


def stabil(datei: Path) -> bool:
    """Eine Datei, die noch synchronisiert wird, wächst noch. Erst verarbeiten, wenn sie stillsteht."""
    try:
        groesse = datei.stat().st_size
        time.sleep(3)
        return groesse > 0 and groesse == datei.stat().st_size
    except OSError:
        return False


def transkribiere(modell, w: dict, audio: Path, eingang: Path, wurzel: Path):
    rel = audio.relative_to(eingang)
    ziel, n = (wurzel / rel).with_suffix(".txt"), 2
    while ziel.exists():  # gleicher Name, neue Aufnahme: nichts überschreiben, nichts verlieren
        ziel, n = ziel.with_name(f"{audio.stem}_{n}.txt"), n + 1
    segmente, _ = modell.transcribe(str(audio), language=w.get("sprache", "de"), beam_size=5,
                                    vad_filter=True, condition_on_previous_text=False)
    text = " ".join(s.text.strip() for s in segmente).strip()
    ziel.parent.mkdir(parents=True, exist_ok=True)
    tmp = ziel.with_suffix(".tmp")
    tmp.write_text(text + "\n", encoding="utf-8")
    tmp.replace(ziel)  # erst ganz schreiben, dann umbenennen: der Bericht-Lauf sieht nie eine halbe Datei
    archiv = eingang / "_verarbeitet" / rel
    archiv.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(audio), str(archiv))
    archiv.touch()  # Aufbewahrungsfrist ab heute, nicht ab Aufnahmedatum
    log(f"{rel} -> {ziel.name} ({len(text)} Zeichen)")


def aufraeumen(eingang: Path, tage: float):
    grenze = time.time() - tage * 86400
    for p in (eingang / "_verarbeitet").rglob("*"):
        if p.is_file() and p.stat().st_mtime < grenze:
            p.unlink()


def main():
    sperre = socket.socket()  # nur eine Instanz: zwei würden dieselbe Aufnahme gleichzeitig verarbeiten
    try:
        sperre.bind(("127.0.0.1", 47391))
    except OSError:
        sys.exit("Die Transkription läuft bereits.")
    cfg = lade_config()
    w = cfg["whisper"]
    eingang, wurzel = Path(cfg["audio_eingang"]), Path(cfg["transkript_wurzel"])
    modell = lade_modell(w)
    log("Transkription gestartet.")
    while True:
        for audio in [p for p in eingang.rglob("*") if p.suffix.lower() in AUDIO and "_verarbeitet" not in p.parts]:
            if stabil(audio):
                try:
                    transkribiere(modell, w, audio, eingang, wurzel)
                except Exception as exc:
                    log(f"Fehler bei {audio.name}: {exc}")
        aufraeumen(eingang, cfg.get("audio_aufbewahrung_tage", 14))
        (HIER / "transkription_status.txt").write_text(f"läuft, zuletzt {datetime.now():%Y-%m-%d %H:%M:%S}\n", encoding="utf-8")
        time.sleep(w.get("intervall_sekunden", 30))


if __name__ == "__main__":
    main()
