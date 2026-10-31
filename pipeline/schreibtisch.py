"""Schreibtisch: eine Notiz von Hand schreiben statt diktieren (python schreibtisch.py).

Kleiner Server, nur auf diesem Rechner erreichbar (127.0.0.1). Gespeichert wird im Ordner des Codes:

    <Code>_<JJJJMMTT>_<HHMM>_<Minuten>min.txt

Beginn und gesamte Einsatzdauer werden von Hand eingetragen, nie berechnet. Den Entwurf erzeugt danach
wie beim Diktat bericht_batch.py.
"""
import html
import secrets
import webbrowser
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

from gemeinsam import lade_config, lade_klienten

CFG = lade_config()
WURZEL = Path(CFG["transkript_wurzel"])
PORT = CFG.get("schreibtisch_port", 8765)
HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}   # gegen DNS-Rebinding: fremde Hostnamen abweisen
SCHLUESSEL = secrets.token_urlsafe(16)                 # gegen Formulare fremder Webseiten, die an 127.0.0.1 senden
MIN_ZEICHEN, MAX_MINUTEN = 20, 720
KOPF = {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"}

SEITE = """<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Schreibtisch</title><style>body{{font:17px/1.5 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px}}
label{{display:block;font-weight:600;margin-top:14px}}input,select,textarea{{font:inherit;width:100%;padding:8px;box-sizing:border-box}}
.r{{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}}textarea{{min-height:320px}}
button{{margin-top:16px;font:inherit;font-weight:700;padding:12px 20px;background:#FF5B1F;border:0}}
p.m{{padding:10px 14px;background:#f5f3ef;border-left:6px solid {farbe}}}</style>
<h1>Schreibtisch</h1><p>Läuft nur auf diesem Rechner. Nichts geht ins Internet.</p>{meldung}
<form method="post"><input type="hidden" name="schluessel" value="{schluessel}"><div class="r">
<label>Code<select name="code" required>{codes}</select></label>
<label>Datum<input type="date" name="datum" value="{heute}" required></label>
<label>Beginn<input type="time" name="beginn" required></label>
<label>Minuten gesamt<input type="number" name="minuten" min="1" max="{maxmin}" required></label></div>
<label>Text<textarea name="text" minlength="{minz}" required></textarea></label>
<label><input type="checkbox" name="fertig" required style="width:auto"> Der Text ist fertig und darf verarbeitet werden.</label>
<button>Speichern</button></form></html>"""


def seite(meldung: str = "", ok: bool = True) -> bytes:
    codes = "".join(f'<option>{html.escape(c)}</option>' for c in sorted(lade_klienten(CFG)))  # nur Codes, nie Kürzel
    return SEITE.format(meldung=f'<p class="m">{html.escape(meldung)}</p>' if meldung else "", farbe="#13C4B3" if ok else "#c0392b",
                        schluessel=SCHLUESSEL, codes=codes, heute=date.today().isoformat(), maxmin=MAX_MINUTEN,
                        minz=MIN_ZEICHEN).encode("utf-8")


def speichere(f: dict) -> str:
    g = lambda k: (f.get(k) or [""])[0].strip()
    if not secrets.compare_digest(g("schluessel").encode(), SCHLUESSEL.encode()):
        raise ValueError("Formular abgelaufen. Seite neu laden.")
    code, minuten, text = g("code"), g("minuten"), g("text")
    if code not in lade_klienten(CFG):
        raise ValueError("Unbekannter Code.")
    try:
        beginn = datetime.strptime(f"{g('datum')} {g('beginn')}", "%Y-%m-%d %H:%M")
    except ValueError:
        raise ValueError("Datum oder Beginn ungültig.") from None
    if not minuten.isdigit() or not 1 <= int(minuten) <= MAX_MINUTEN:
        raise ValueError(f"Minuten zwischen 1 und {MAX_MINUTEN} eintragen.")
    if len(text) < MIN_ZEICHEN:
        raise ValueError(f"Der Text ist kürzer als {MIN_ZEICHEN} Zeichen.")
    ziel = WURZEL / code / f"{code}_{beginn:%Y%m%d_%H%M}_{int(minuten)}min.txt"
    if ziel.exists():
        raise ValueError(f"{ziel.name} gibt es schon. Bitte Beginn prüfen.")
    ziel.parent.mkdir(exist_ok=True)
    tmp = ziel.with_suffix(".tmp")
    tmp.write_text(text + "\n", encoding="utf-8")
    tmp.replace(ziel)  # erst ganz schreiben, dann umbenennen: der Bericht-Lauf sieht nie eine halbe Datei
    return f"Gespeichert als {ziel.name}."


class Handler(BaseHTTPRequestHandler):
    def _antworte(self, status: int, inhalt: bytes):
        self.send_response(status)
        for k, v in KOPF.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(inhalt)))
        self.end_headers()
        self.wfile.write(inhalt)

    def do_GET(self):
        if self.headers.get("Host") not in HOSTS:
            return self._antworte(403, b"")
        self._antworte(200, seite())

    def do_POST(self):
        if self.headers.get("Host") not in HOSTS:
            return self._antworte(403, b"")
        try:
            laenge = min(int(self.headers.get("Content-Length", 0)), 200_000)
            self._antworte(200, seite(speichere(parse_qs(self.rfile.read(laenge).decode("utf-8")))))
        except ValueError as exc:
            self._antworte(400, seite(str(exc), ok=False))

    def log_message(self, *args):  # keine Anfragen in die Konsole
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Schreibtisch läuft unter http://127.0.0.1:{PORT}/ . Fenster offen lassen, Schliessen beendet ihn.")
    webbrowser.open(f"http://127.0.0.1:{PORT}/")
    server.serve_forever()
