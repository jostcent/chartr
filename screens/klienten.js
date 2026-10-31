// ───────────────────────────────────────────────────────────────────────────
// Klientenliste — bewusst NICHT im Quellcode.
//
// Bis 09/2026 stand die Liste als `const KLIENTEN` fest in RecordScreen.js.
// Zwei Probleme daran:
//
//   1. Datenschutz. Die Liste besteht aus Kürzeln realer Klientinnen und
//      Klienten. Im Quelltext einer veröffentlichten App wäre das eine
//      Personenliste — pseudonym ist nicht anonym.
//   2. Zwei Quellen der Wahrheit. Dieselbe Liste existiert auf der
//      Auswertungsseite (CODE_TO_KUERZEL). Wurde nur eine gepflegt, fiel das
//      erst auf, wenn ein Bericht unter dem falschen Kürzel landete.
//
// Deshalb: die Liste lebt als Datei auf dem Gerät und kann aus der eigenen
// Nextcloud nachgeladen werden. Ein neuer Klient wird dort einmal eingetragen,
// und die App holt ihn sich — ohne neuen App-Build.
// ───────────────────────────────────────────────────────────────────────────
import * as FileSystem from 'expo-file-system/legacy';

const KLIENTEN_FILE = FileSystem.documentDirectory + 'chartr_klienten.json';

// Erwartet werden zwei Formen, damit dieselbe Datei von der Auswertungsseite
// gelesen werden kann:
//   { "XY1": "X.Y.", "AB2": "A.B." }            <- wie CODE_TO_KUERZEL
//   [ { "code": "XY1", "kuerzel": "X.Y." } ]    <- ausführlich
const normalisiere = (roh) => {
  if (Array.isArray(roh)) {
    return roh
      .filter((e) => e && e.code)
      .map((e) => ({ code: String(e.code).trim(), kuerzel: String(e.kuerzel || '').trim() }));
  }
  if (roh && typeof roh === 'object') {
    return Object.keys(roh).map((c) => ({ code: c.trim(), kuerzel: String(roh[c]).trim() }));
  }
  return [];
};

const sortiere = (liste) =>
  [...liste].sort((a, b) => a.code.localeCompare(b.code, 'de'));

export const ladeKlienten = async () => {
  try {
    const info = await FileSystem.getInfoAsync(KLIENTEN_FILE);
    if (!info.exists) return [];
    const roh = JSON.parse(await FileSystem.readAsStringAsync(KLIENTEN_FILE));
    return sortiere(normalisiere(roh.klienten !== undefined ? roh.klienten : roh));
  } catch (_) {
    // Kaputte Datei darf die App nicht blockieren — lieber leere Liste und
    // der Nutzer lädt sie neu.
    return [];
  }
};

export const speichereKlienten = async (liste) => {
  const sauber = sortiere(normalisiere(liste));
  await FileSystem.writeAsStringAsync(
    KLIENTEN_FILE,
    JSON.stringify({ stand: new Date().toISOString(), klienten: sauber }, null, 2)
  );
  return sauber;
};

export const standDerListe = async () => {
  try {
    const info = await FileSystem.getInfoAsync(KLIENTEN_FILE);
    if (!info.exists) return null;
    const roh = JSON.parse(await FileSystem.readAsStringAsync(KLIENTEN_FILE));
    return roh.stand || null;
  } catch (_) {
    return null;
  }
};

// ─── Textform zum Bearbeiten von Hand: eine Zeile "CODE = KÜRZEL" ───────────
export const klientenAlsText = (liste) =>
  sortiere(liste).map((k) => `${k.code} = ${k.kuerzel}`).join('\n');

export const parseKlientenText = (text) => {
  const liste = [];
  const fehler = [];
  (text || '').split(/\r?\n/).forEach((zeile, i) => {
    const z = zeile.trim();
    if (!z || z.startsWith('#')) return;
    const m = z.match(/^([A-Za-z0-9]+)\s*[=;,\t]\s*(.+)$/);
    if (!m) { fehler.push(`Zeile ${i + 1}: "${z}"`); return; }
    liste.push({ code: m[1].trim(), kuerzel: m[2].trim() });
  });
  const codes = liste.map((k) => k.code);
  const doppelt = codes.filter((c, i) => codes.indexOf(c) !== i);
  return { liste: sortiere(liste), fehler, doppelt: [...new Set(doppelt)] };
};

// ─── Aus der Nextcloud nachladen ────────────────────────────────────────────
// Die Konfiguration wird übergeben, nicht importiert: sonst entstünde ein
// Ringschluss zwischen diesem Modul und SettingsScreen.
export const holeKlientenVonNextcloud = async ({ url, username, password, pfad }) => {
  if (!url || !username || !password) throw new Error('Nextcloud ist nicht eingerichtet.');
  if (!pfad) throw new Error('Kein Pfad zur Klientenliste hinterlegt.');

  const basis = url.replace(/\/$/, '') + '/remote.php/dav/files/' + username;
  const ziel  = `${basis}/${pfad.replace(/^\//, '')}`;
  const auth  = btoa(`${username}:${password}`);

  const res = await fetch(ziel, { method: 'GET', headers: { Authorization: `Basic ${auth}` } });
  if (res.status === 404) throw new Error(`Datei nicht gefunden: ${pfad}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} beim Laden der Klientenliste.`);

  let roh;
  try {
    roh = JSON.parse(await res.text());
  } catch (_) {
    throw new Error('Die Datei ist kein gültiges JSON.');
  }
  const liste = normalisiere(roh.klienten !== undefined ? roh.klienten : roh);
  if (liste.length === 0) throw new Error('Die Datei enthält keine Einträge.');
  return await speichereKlienten(liste);
};
