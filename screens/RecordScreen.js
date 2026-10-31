import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  Platform,
  Modal,
} from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { uploadToNextcloud, getNextcloudConfig } from './SettingsScreen';
import { ladeKlienten } from './klienten';

// Die Klientenliste steht bewusst NICHT hier im Quelltext, sondern in einer
// Datei auf dem Gerät (siehe klienten.js). Gründe: sie besteht aus Kürzeln
// realer Personen, und sie existiert auf der Auswertungsseite bereits ein
// zweites Mal. Gepflegt wird sie in den Einstellungen.

// ─── Lokales Datum (nicht UTC — toISOString liefert nach 00:00 Lokalzeit den Vortag) ─
const localDateISO = (d) => {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const t = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${t}`;
};

// ─── Datumsauswahl für manuelle Einträge: heute + letzte 14 Tage ─────────────
const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

const getLast14Days = () => {
  const days = [];
  for (let i = 0; i <= 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso   = localDateISO(d);
    const tag   = d.getDate().toString().padStart(2, '0');
    const monat = (d.getMonth() + 1).toString().padStart(2, '0');
    const label = i === 0 ? 'Heute' : i === 1 ? 'Gestern' : `${WOCHENTAGE[d.getDay()]} ${tag}.${monat}.`;
    days.push({ iso, label });
  }
  return days;
};

// ─── Kalender: beliebig weit zurückliegende Einsätze nachtragen ──────────────
// Bewusst OHNE zusätzliche Bibliothek. Ein Datepicker-Paket bräuchte einen
// nativen Rebuild und müsste zur Expo-Version passen; dieses Raster ist reines
// JavaScript und läuft mit dem bestehenden Build.
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
                'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WOCHENTAGE_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// Liefert die Zellen eines Monats, Montag als erste Spalte. null = Leerzelle.
const monatsRaster = (jahr, monat) => {
  const tageImMonat = new Date(jahr, monat + 1, 0).getDate();
  // getDay() liefert 0 für Sonntag - für eine Montagsspalte um 6 verschieben.
  const versatz = (new Date(jahr, monat, 1).getDay() + 6) % 7;
  const zellen = [];
  for (let i = 0; i < versatz; i++) zellen.push(null);
  for (let t = 1; t <= tageImMonat; t++) zellen.push(new Date(jahr, monat, t));
  while (zellen.length % 7 !== 0) zellen.push(null);
  return zellen;
};

// Kurzform für Button-/Warntext, z.B. "heute", "gestern", "18.08." (bzw. "am 18.08.")
const formatDatumHinweis = (iso, mitAm = false) => {
  const heute   = localDateISO(new Date());
  const gestern = localDateISO(new Date(Date.now() - 86400000));
  if (iso === heute) return 'heute';
  if (iso === gestern) return 'gestern';
  const [j, m, t] = iso.split('-');
  // Jahr nur zeigen, wenn es nicht das laufende ist: beim Nachtragen alter
  // Einsätze wäre "07.07." sonst nicht von einem Vorjahresdatum zu unterscheiden.
  const kern = j === heute.slice(0, 4) ? `${t}.${m}.` : `${t}.${m}.${j}`;
  return mitAm ? `am ${kern}` : kern;
};

// ─── Persistenz: Einträge überleben App-Neustart ─────────────────────────────
const STATE_FILE = FileSystem.documentDirectory + 'chartr_state.json';

// ─── Zeiterfassung: CSV-Zeile nach Nextcloud hochladen ───────────────────────
const uploadZeiterfassung = async (entry) => {
  const cfg = await getNextcloudConfig();
  const { url, username, password } = cfg;
  if (!url || !username || !password) throw new Error('Nextcloud nicht konfiguriert');

  // Kein fester Pfad im Quelltext. Ist kein eigener Zeiterfassungs-Ordner
  // hinterlegt, wird er aus dem Upload-Ordner abgeleitet: dessen letztes
  // Segment wird durch ZEITERFASSUNG ersetzt, aus "<Basis>/AUDIO_ROH" also
  // "<Basis>/ZEITERFASSUNG". Das gilt für jede Nextcloud, nicht nur für eine.
  const folder = (cfg.zeitFolder && cfg.zeitFolder.trim())
    || (cfg.folder ? cfg.folder.replace(/\/[^/]+\/?$/, '/ZEITERFASSUNG') : '');
  if (!folder) throw new Error('Kein Zeiterfassungs-Ordner konfiguriert (Einstellungen)');

  const auth       = btoa(`${username}:${password}`);
  const base       = url.replace(/\/$/, '') + '/remote.php/dav/files/' + username;
  const yearMonth  = entry.datum.slice(0, 7);          // YYYY-MM
  const filename   = `Zeiterfassung_${yearMonth}.csv`;
  const fileUrl    = `${base}/${folder}/${filename}`;

  // Ordnerpfad anlegen, Segment für Segment (405 = bereits vorhanden, ist ok)
  let acc = base;
  for (const seg of folder.split('/').filter(Boolean)) {
    acc += '/' + seg;
    try {
      await fetch(acc, { method: 'MKCOL', headers: { Authorization: `Basic ${auth}` } });
    } catch (_) {}
  }

  // Bestehende Datei laden. Wichtig: Nur bei 404 (Datei existiert noch nicht)
  // mit leerem Inhalt weiterfahren — jeder andere Fehler bricht ab, sonst
  // würde die bestehende Monatsdatei mit einer einzigen Zeile überschrieben.
  let existing = '';
  const get = await fetch(fileUrl, { headers: { Authorization: `Basic ${auth}` } });
  if (get.ok) {
    existing = await get.text();
  } else if (get.status !== 404) {
    throw new Error(`Bestehende CSV nicht lesbar (HTTP ${get.status}) — Upload abgebrochen`);
  }

  const header = 'Datum,Von,Bis,Dauer_Min,Code,Kuerzel\n';
  const row    = `${entry.datum},${entry.von},${entry.bis},${entry.dauer},${entry.klient.code},${entry.klient.kuerzel}\n`;
  const body   = existing ? existing + row : header + row;

  const put = await fetch(fileUrl, {
    method: 'PUT',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'text/csv' },
    body,
  });
  if (!put.ok) throw new Error(`HTTP ${put.status}`);
};

// ─── Hauptkomponente ──────────────────────────────────────────────────────────
export default function RecordScreen() {
  const [selectedKlient, setSelectedKlient]   = useState(null);
  const [klienten, setKlienten]               = useState([]);

  // Audio-Aufnahme
  const [isRecording, setIsRecording]         = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [savedRecordings, setSavedRecordings] = useState([]);
  const [startzeit, setStartzeit]             = useState('');
  const [endzeit, setEndzeit]                 = useState('');
  const recordingRef = useRef(null);
  const timerRef     = useRef(null);

  // Zeiterfassung
  const [isTracking, setIsTracking]           = useState(false);
  const [trackingStart, setTrackingStart]     = useState(null);
  const [trackingElapsed, setTrackingElapsed] = useState(0);
  const [zeitEntries, setZeitEntries]         = useState([]);
  const [selectedDate, setSelectedDate]       = useState(localDateISO(new Date()));
  const [kalenderOffen, setKalenderOffen]     = useState(false);
  const [kalenderMonat, setKalenderMonat]     = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const trackTimerRef = useRef(null);

  // Klientenliste bei jedem Anzeigen neu einlesen. So wirken Änderungen aus
  // den Einstellungen sofort — ohne App-Neustart.
  useFocusEffect(
    useCallback(() => {
      let aktiv = true;
      (async () => {
        const liste = await ladeKlienten();
        if (aktiv) setKlienten(liste);
      })();
      return () => { aktiv = false; };
    }, [])
  );

  // ── Persistenz: beim Start laden, bei Änderung speichern ──────────────────
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const info = await FileSystem.getInfoAsync(STATE_FILE);
        if (info.exists) {
          const raw = JSON.parse(await FileSystem.readAsStringAsync(STATE_FILE));
          // Beim letzten Beenden noch laufende Uploads als fehlgeschlagen markieren
          setZeitEntries((raw.zeitEntries || []).map((e) =>
            e.uploading ? { ...e, uploading: false, uploadError: true } : e
          ));
          setSavedRecordings((raw.savedRecordings || []).map((r) =>
            r.uploading ? { ...r, uploading: false, uploadError: true } : r
          ).slice(0, 50));
          // Aufräumen aus älteren Versionen: bereits hochgeladene Aufnahmen liegen noch auf dem Handy.
          (raw.savedRecordings || []).filter((r) => r.uploaded && r.path).forEach((r) => loescheNachUpload(r.path));
        }
      } catch (_) {}
      setHydrated(true);
    })();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    FileSystem.writeAsStringAsync(
      STATE_FILE,
      JSON.stringify({ zeitEntries, savedRecordings })
    ).catch(() => {});
  }, [hydrated, zeitEntries, savedRecordings]);

  // ── Hilfs-Formatierungen ──────────────────────────────────────────────────
  const formatDuration = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const formatElapsed = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
  };

  const nowHHMM = () => {
    const d  = new Date();
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    return `${hh}:${mm}`;
  };

  // ── Zeiterfassung: START ──────────────────────────────────────────────────
  const startTracking = () => {
    if (!selectedKlient) {
      Alert.alert('Klient wählen', 'Bitte zuerst einen Klienten auswählen.');
      return;
    }
    const now = new Date();
    setTrackingStart(now);
    setTrackingElapsed(0);
    setIsTracking(true);
    setStartzeit(nowHHMM());
    setEndzeit('');
    // Aus Zeitstempeln rechnen, nicht Sekunden zählen: JS-Timer pausieren,
    // wenn die App im Hintergrund ist — die Dauer wäre sonst zu kurz.
    trackTimerRef.current = setInterval(() => {
      setTrackingElapsed(Math.floor((Date.now() - now.getTime()) / 1000));
    }, 1000);
  };

  // ── Zeiterfassung: STOP ───────────────────────────────────────────────────
  const stopTracking = async () => {
    if (!trackTimerRef.current) return;
    clearInterval(trackTimerRef.current);
    trackTimerRef.current = null;

    const ende    = new Date();
    const bis     = nowHHMM();
    const von     = `${trackingStart.getHours().toString().padStart(2,'0')}:${trackingStart.getMinutes().toString().padStart(2,'0')}`;
    const datum   = localDateISO(trackingStart);
    // Dauer aus Zeitstempeln (hintergrundsicher); Einsätze unter 1 Min. als 1 Min.
    const dauer   = Math.max(1, Math.round((ende.getTime() - trackingStart.getTime()) / 60000));

    setEndzeit(bis);
    setIsTracking(false);

    const entry = { datum, von, bis, dauer, klient: selectedKlient, uploading: true };
    setZeitEntries((prev) => [entry, ...prev]);

    try {
      await uploadZeiterfassung(entry);
      setZeitEntries((prev) =>
        prev.map((e, i) => (i === 0 ? { ...e, uploading: false, uploaded: true } : e))
      );
    } catch (err) {
      setZeitEntries((prev) =>
        prev.map((e, i) => (i === 0 ? { ...e, uploading: false, uploadError: true } : e))
      );
    }
  };

  // ── Manueller Zeiteintrag ─────────────────────────────────────────────────
  // Akzeptiert "8:00", "08:00" oder "0800"; liefert Minuten seit Mitternacht oder null.
  const parseHHMM = (s) => {
    const t = (s || '').trim();
    let h, m;
    if (/^\d{1,2}:\d{2}$/.test(t)) {
      [h, m] = t.split(':').map(Number);
    } else if (/^\d{4}$/.test(t)) {
      h = Number(t.slice(0, 2));
      m = Number(t.slice(2));
    } else {
      return null;
    }
    if (h > 23 || m > 59) return null;
    return h * 60 + m;
  };

  const minToHHMM = (min) =>
    `${Math.floor(min / 60).toString().padStart(2, '0')}:${(min % 60).toString().padStart(2, '0')}`;

  const saveManualEntry = () => {
    if (!selectedKlient) {
      Alert.alert('Klient wählen', 'Bitte zuerst einen Klienten auswählen.');
      return;
    }
    if (isTracking) {
      Alert.alert('Zeiterfassung läuft', 'Zuerst STOP drücken, dann manuell erfassen.');
      return;
    }
    const vonMin = parseHHMM(startzeit);
    const bisMin = parseHHMM(endzeit);
    if (vonMin == null || bisMin == null) {
      Alert.alert('Zeiten prüfen', 'Von und Bis im Format HH:MM eingeben, z.B. 08:00 und 09:30.');
      return;
    }
    const dauer = bisMin - vonMin;
    if (dauer <= 0) {
      Alert.alert('Zeiten prüfen', 'Bis muss nach Von liegen (Einsätze über Mitternacht bitte als zwei Einträge erfassen).');
      return;
    }

    const entry = {
      datum: selectedDate,
      von: minToHHMM(vonMin),
      bis: minToHHMM(bisMin),
      dauer,
      klient: selectedKlient,
      uploading: true,
      manuell: true,
    };

    const duplikat = zeitEntries.some(
      (e) =>
        e.datum === entry.datum &&
        e.von === entry.von &&
        e.bis === entry.bis &&
        e.klient.code === entry.klient.code
    );

    const doSave = async () => {
      setZeitEntries((prev) => [entry, ...prev]);
      setStartzeit('');
      setEndzeit('');
      try {
        await uploadZeiterfassung(entry);
        setZeitEntries((prev) =>
          prev.map((e, i) => (i === 0 ? { ...e, uploading: false, uploaded: true } : e))
        );
      } catch (_) {
        setZeitEntries((prev) =>
          prev.map((e, i) => (i === 0 ? { ...e, uploading: false, uploadError: true } : e))
        );
      }
    };

    if (duplikat) {
      Alert.alert(
        'Doppelter Eintrag?',
        `${entry.klient.code} · ${entry.von}–${entry.bis} ist ${formatDatumHinweis(entry.datum, true)} schon erfasst.`,
        [
          { text: 'Abbrechen', style: 'cancel' },
          { text: 'Trotzdem speichern', onPress: doSave },
        ]
      );
    } else {
      doSave();
    }
  };

  // ── Uploads erneut versuchen ──────────────────────────────────────────────
  const retryZeitUpload = async (index) => {
    const entry = zeitEntries[index];
    if (!entry || entry.uploading) return;
    setZeitEntries((prev) =>
      prev.map((e, i) => (i === index ? { ...e, uploading: true, uploadError: false } : e))
    );
    try {
      await uploadZeiterfassung(entry);
      setZeitEntries((prev) =>
        prev.map((e, i) => (i === index ? { ...e, uploading: false, uploaded: true, uploadError: false } : e))
      );
    } catch (_) {
      setZeitEntries((prev) =>
        prev.map((e, i) => (i === index ? { ...e, uploading: false, uploadError: true } : e))
      );
    }
  };

  // Nach erfolgreichem Upload liegt die Aufnahme in der eigenen Nextcloud. Auf dem Handy wird sie
  // gelöscht, damit sich dort keine Gesundheitsdaten ansammeln. Behalten wird sie nur bei Fehlern,
  // für "Erneut hochladen".
  const loescheNachUpload = (path) => FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});

  const retryRecordingUpload = async (rec) => {
    if (rec.uploading) return;
    setSavedRecordings((prev) =>
      prev.map((r) => (r.filename === rec.filename ? { ...r, uploading: true, uploadError: false } : r))
    );
    try {
      await uploadToNextcloud(rec.path, rec.filename);
      await loescheNachUpload(rec.path);
      setSavedRecordings((prev) =>
        prev.map((r) => (r.filename === rec.filename ? { ...r, uploading: false, uploaded: true, uploadError: false } : r))
      );
    } catch (_) {
      setSavedRecordings((prev) =>
        prev.map((r) => (r.filename === rec.filename ? { ...r, uploading: false, uploadError: true } : r))
      );
    }
  };

  // ── Audio: START ──────────────────────────────────────────────────────────
  const startRecording = async () => {
    if (!selectedKlient) {
      Alert.alert('Klient wählen', 'Bitte zuerst einen Klienten auswählen.');
      return;
    }
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      setIsRecording(true);
      setRecordingDuration(0);
      setStartzeit(nowHHMM());
      setEndzeit('');
      timerRef.current = setInterval(() => { setRecordingDuration((d) => d + 1); }, 1000);
    } catch (err) {
      Alert.alert('Fehler', 'Aufnahme konnte nicht gestartet werden: ' + err.message);
    }
  };

  // ── Audio: STOP ───────────────────────────────────────────────────────────
  const stopRecording = async () => {
    if (!recordingRef.current) return;
    try {
      clearInterval(timerRef.current);
      await recordingRef.current.stopAndUnloadAsync();
      const uri       = recordingRef.current.getURI();
      const bis       = nowHHMM();
      setEndzeit(bis);

      const datestamp = localDateISO(new Date()).replace(/-/g, '');
      const vonClean  = startzeit.replace(':', '');
      const bisClean  = bis.replace(':', '');
      const filename  = `${selectedKlient.code}_${datestamp}_${vonClean}_${bisClean}.m4a`;
      const dest      = FileSystem.documentDirectory + filename;

      await FileSystem.moveAsync({ from: uri, to: dest });
      setSavedRecordings((prev) => [
        { filename, path: dest, klient: selectedKlient, duration: recordingDuration, uploading: true },
        ...prev,
      ].slice(0, 50));
      recordingRef.current = null;
      setIsRecording(false);

      try {
        await uploadToNextcloud(dest, filename);
        await loescheNachUpload(dest);
        setSavedRecordings((prev) =>
          prev.map((r) => r.filename === filename ? { ...r, uploading: false, uploaded: true } : r)
        );
      } catch (uploadErr) {
        setSavedRecordings((prev) =>
          prev.map((r) => r.filename === filename ? { ...r, uploading: false, uploadError: true } : r)
        );
      }
    } catch (err) {
      Alert.alert('Fehler', 'Aufnahme konnte nicht gespeichert werden: ' + err.message);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chartr</Text>
        <Text style={styles.headerSub}>Klinischer Diktier-Assistent</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        {/* Klient auswählen */}
        <Text style={styles.sectionLabel}>Klient</Text>
        {klienten.length === 0 ? (
          <Text style={styles.keineKlienten}>
            Noch keine Klienten hinterlegt. In den Einstellungen unter
            „Klientenliste" eintragen oder aus der Nextcloud laden.
          </Text>
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.klientRow}>
          {klienten.map((k) => (
            <TouchableOpacity
              key={k.code}
              style={[styles.klientChip, selectedKlient?.code === k.code && styles.klientChipActive]}
              onPress={() => setSelectedKlient(k)}
            >
              <Text style={[styles.klientChipText, selectedKlient?.code === k.code && styles.klientChipTextActive]}>
                {k.code}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── ZEITERFASSUNG ── */}
        <Text style={styles.sectionLabel}>Zeiterfassung</Text>
        <View style={styles.trackingCard}>
          {selectedKlient ? (
            <Text style={styles.trackingKlient}>
              {selectedKlient.code} · {selectedKlient.kuerzel}
            </Text>
          ) : (
            <Text style={styles.trackingHintTop}>Klient wählen, dann START drücken</Text>
          )}

          <TouchableOpacity
            style={[styles.trackBtn, isTracking && styles.trackBtnActive]}
            onPress={isTracking ? stopTracking : startTracking}
            activeOpacity={0.8}
          >
            <Text style={styles.trackBtnText}>{isTracking ? 'STOP' : 'START'}</Text>
          </TouchableOpacity>

          {isTracking ? (
            <View style={styles.trackingRunning}>
              <Text style={styles.trackingTimer}>{formatElapsed(trackingElapsed)}</Text>
              <Text style={styles.trackingTimerLabel}>läuft seit {startzeit}</Text>
            </View>
          ) : (
            startzeit && endzeit ? (
              <Text style={styles.trackingDone}>
                {startzeit} – {endzeit} · {(() => {
                  const [sh, sm] = startzeit.split(':').map(Number);
                  const [eh, em] = endzeit.split(':').map(Number);
                  const diff = (eh * 60 + em) - (sh * 60 + sm);
                  return diff > 0 ? `${diff} Min.` : '--';
                })()}
              </Text>
            ) : null
          )}
        </View>

        {/* Datum (manueller Eintrag) */}
        <Text style={styles.sectionLabel}>Datum</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.datumRow}>
          {/* Kalender-Chip steht bewusst zuerst: er ist ohne Scrollen erreichbar
              und zeigt das gewählte Datum an, sobald es älter als 14 Tage ist. */}
          {(() => {
            const inListe = getLast14Days().some((d) => d.iso === selectedDate);
            return (
              <TouchableOpacity
                style={[styles.datumChip, styles.kalenderChip, !inListe && styles.datumChipActive]}
                onPress={() => {
                  const [j, m] = selectedDate.split('-').map(Number);
                  setKalenderMonat(new Date(j, m - 1, 1));
                  setKalenderOffen(true);
                }}
              >
                <Text style={[styles.datumChipText, !inListe && styles.datumChipTextActive]}>
                  {inListe ? 'Kalender' : formatDatumHinweis(selectedDate)}
                </Text>
              </TouchableOpacity>
            );
          })()}
          {getLast14Days().map((d) => (
            <TouchableOpacity
              key={d.iso}
              style={[styles.datumChip, selectedDate === d.iso && styles.datumChipActive]}
              onPress={() => setSelectedDate(d.iso)}
            >
              <Text style={[styles.datumChipText, selectedDate === d.iso && styles.datumChipTextActive]}>
                {d.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Kalender für beliebig weit zurückliegende Daten */}
        <Modal
          visible={kalenderOffen}
          transparent
          animationType="fade"
          onRequestClose={() => setKalenderOffen(false)}
        >
          <TouchableOpacity
            style={styles.kalenderOverlay}
            activeOpacity={1}
            onPress={() => setKalenderOffen(false)}
          >
            {/* eigenes TouchableOpacity, damit ein Tipp INS Fenster es nicht schliesst */}
            <TouchableOpacity style={styles.kalenderBox} activeOpacity={1}>
              <View style={styles.kalenderKopf}>
                <TouchableOpacity
                  style={styles.kalenderPfeil}
                  onPress={() => setKalenderMonat(
                    new Date(kalenderMonat.getFullYear(), kalenderMonat.getMonth() - 1, 1))}
                >
                  <Text style={styles.kalenderPfeilText}>‹</Text>
                </TouchableOpacity>
                <Text style={styles.kalenderTitel}>
                  {MONATE[kalenderMonat.getMonth()]} {kalenderMonat.getFullYear()}
                </Text>
                <TouchableOpacity
                  style={styles.kalenderPfeil}
                  onPress={() => setKalenderMonat(
                    new Date(kalenderMonat.getFullYear(), kalenderMonat.getMonth() + 1, 1))}
                >
                  <Text style={styles.kalenderPfeilText}>›</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.kalenderWoche}>
                {WOCHENTAGE_KURZ.map((w) => (
                  <Text key={w} style={styles.kalenderWochentag}>{w}</Text>
                ))}
              </View>

              <View style={styles.kalenderGitter}>
                {monatsRaster(kalenderMonat.getFullYear(), kalenderMonat.getMonth()).map((d, i) => {
                  if (!d) return <View key={`leer${i}`} style={styles.kalenderZelle} />;
                  const iso      = localDateISO(d);
                  const heuteIso = localDateISO(new Date());
                  // Zeichenkettenvergleich reicht: YYYY-MM-DD sortiert chronologisch.
                  const zukunft  = iso > heuteIso;
                  const gewaehlt = iso === selectedDate;
                  return (
                    <TouchableOpacity
                      key={iso}
                      disabled={zukunft}
                      style={[
                        styles.kalenderZelle,
                        gewaehlt && styles.kalenderZelleAktiv,
                        iso === heuteIso && !gewaehlt && styles.kalenderZelleHeute,
                      ]}
                      onPress={() => { setSelectedDate(iso); setKalenderOffen(false); }}
                    >
                      <Text style={[
                        styles.kalenderTag,
                        zukunft && styles.kalenderTagAus,
                        gewaehlt && styles.kalenderTagAktiv,
                      ]}>
                        {d.getDate()}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.kalenderFuss}>
                <TouchableOpacity onPress={() => {
                  const n = new Date();
                  setKalenderMonat(new Date(n.getFullYear(), n.getMonth(), 1));
                  setSelectedDate(localDateISO(n));
                  setKalenderOffen(false);
                }}>
                  <Text style={styles.kalenderFussText}>Heute</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setKalenderOffen(false)}>
                  <Text style={[styles.kalenderFussText, styles.kalenderFussGrau]}>Schliessen</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        {/* Zeitfelder (manuell) */}
        <View style={styles.zeitRow}>
          <View style={styles.zeitField}>
            <Text style={styles.zeitLabel}>Von</Text>
            <TextInput
              style={styles.zeitInput}
              value={startzeit}
              onChangeText={setStartzeit}
              placeholder="08:00"
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={styles.zeitField}>
            <Text style={styles.zeitLabel}>Bis</Text>
            <TextInput
              style={styles.zeitInput}
              value={endzeit}
              onChangeText={setEndzeit}
              placeholder="09:30"
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={styles.zeitField}>
            <Text style={styles.zeitLabel}>Dauer</Text>
            <Text style={styles.zeitDauer}>
              {startzeit && endzeit ? (() => {
                const [sh, sm] = startzeit.split(':').map(Number);
                const [eh, em] = endzeit.split(':').map(Number);
                const diff = (eh * 60 + em) - (sh * 60 + sm);
                return diff > 0 ? `${diff} Min.` : '--';
              })() : '--'}
            </Text>
          </View>
        </View>

        {/* Manuell speichern */}
        <TouchableOpacity style={styles.manualBtn} onPress={saveManualEntry} activeOpacity={0.8}>
          <Text style={styles.manualBtnText}>Eintrag speichern ({formatDatumHinweis(selectedDate)})</Text>
        </TouchableOpacity>
        <Text style={styles.manualHint}>
          Für vergessene Einsätze: Datum wählen, Von/Bis eintippen, Klient wählen, speichern.
          Liegt der Einsatz länger als 14 Tage zurück, über „Kalender" beliebig weit zurückblättern.
        </Text>

        {/* Zeiteinträge */}
        {zeitEntries.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Erfasste Zeiten</Text>
            {zeitEntries.map((e, i) => (
              <View key={i} style={styles.recCard}>
                <Text style={styles.recFilename}>
                  {e.klient.code} · {e.klient.kuerzel} · {e.von}–{e.bis} · {e.dauer} Min.{e.manuell ? ' · manuell' : ''}
                </Text>
                <Text style={styles.recMeta}>
                  {e.datum}
                  {e.uploading   ? '  ⏫ Nextcloud…' : ''}
                  {e.uploaded    ? '  ✓ Nextcloud'  : ''}
                  {e.uploadError ? '  ⚠ Upload fehlgeschlagen' : ''}
                </Text>
                {e.uploadError && !e.uploading && (
                  <TouchableOpacity style={styles.retryBtn} onPress={() => retryZeitUpload(i)}>
                    <Text style={styles.retryBtnText}>⟳ Erneut hochladen</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </>
        )}

        {/* ── DIKTIEREN ── */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Diktieren</Text>
        <View style={styles.recordArea}>
          {selectedKlient && (
            <Text style={styles.klientLabel}>
              {selectedKlient.code} · {selectedKlient.kuerzel}
            </Text>
          )}

          <TouchableOpacity
            style={[styles.recordBtn, isRecording && styles.recordBtnActive]}
            onPress={isRecording ? stopRecording : startRecording}
            activeOpacity={0.8}
          >
            <View style={[styles.recordInner, isRecording && styles.recordInnerActive]}>
              {isRecording ? <View style={styles.stopIcon} /> : <View style={styles.micIcon} />}
            </View>
          </TouchableOpacity>

          {isRecording ? (
            <Text style={styles.recordingStatus}>
              🔴 {formatDuration(recordingDuration)} — Tippen zum Stoppen
            </Text>
          ) : (
            <Text style={styles.recordingHint}>Tippen zum Starten</Text>
          )}
        </View>

        {/* Gespeicherte Aufnahmen */}
        {savedRecordings.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Gespeicherte Aufnahmen</Text>
            {savedRecordings.map((rec, i) => (
              <View key={i} style={styles.recCard}>
                <Text style={styles.recFilename}>{rec.filename}</Text>
                <Text style={styles.recMeta}>
                  {rec.klient.code} · {formatDuration(rec.duration)}
                  {rec.uploading   ? '  ⏫ Uploading…' : ''}
                  {rec.uploaded    ? '  ✓ Nextcloud'  : ''}
                  {rec.uploadError ? '  ⚠ Upload fehlgeschlagen' : ''}
                </Text>
                {rec.uploadError && !rec.uploading && (
                  <TouchableOpacity style={styles.retryBtn} onPress={() => retryRecordingUpload(rec)}>
                    <Text style={styles.retryBtnText}>⟳ Erneut hochladen</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </>
        )}

      </ScrollView>
    </View>
  );
}

const NAVY  = '#1a4a6e';
const TEAL  = '#2d8a7a';
const GREEN = '#27ae60';
const RED   = '#c0392b';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafb' },
  header: {
    backgroundColor: NAVY,
    paddingTop: 56,
    paddingBottom: 20,
    paddingHorizontal: 24,
  },
  headerTitle: { color: '#fff', fontSize: 28, fontWeight: '700', letterSpacing: 1 },
  headerSub:   { color: 'rgba(255,255,255,0.65)', fontSize: 13, marginTop: 2 },

  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 60 },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 16,
  },

  klientRow: { marginBottom: 4 },
  klientChip: {
    borderWidth: 1.5,
    borderColor: '#d0e8e4',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginRight: 8,
    backgroundColor: '#fff',
  },
  klientChipActive:     { backgroundColor: TEAL, borderColor: TEAL },
  klientChipText:       { color: '#555', fontSize: 13, fontWeight: '500' },
  klientChipTextActive: { color: '#fff' },

  // Zeiterfassung Card
  trackingCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#d0e8e4',
    padding: 20,
    alignItems: 'center',
    marginBottom: 4,
  },
  trackingKlient: {
    fontSize: 16,
    fontWeight: '600',
    color: TEAL,
    marginBottom: 16,
  },
  trackingHintTop: {
    fontSize: 13,
    color: '#bbb',
    marginBottom: 16,
  },
  trackBtn: {
    width: 140,
    height: 56,
    borderRadius: 28,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  trackBtnActive: { backgroundColor: RED },
  trackBtnText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 2,
  },
  trackingRunning: { alignItems: 'center', marginTop: 16 },
  trackingTimer: {
    fontSize: 36,
    fontWeight: '300',
    color: RED,
    letterSpacing: 2,
  },
  trackingTimerLabel: { fontSize: 12, color: '#aaa', marginTop: 2 },
  trackingDone: {
    marginTop: 14,
    fontSize: 15,
    color: NAVY,
    fontWeight: '500',
  },

  datumRow: { marginBottom: 4 },
  datumChip: {
    borderWidth: 1.5,
    borderColor: '#d0e8e4',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginRight: 8,
    backgroundColor: '#fff',
  },
  datumChipActive:     { backgroundColor: TEAL, borderColor: TEAL },
  datumChipText:       { color: '#555', fontSize: 13, fontWeight: '500' },
  datumChipTextActive: { color: '#fff' },

  keineKlienten: {
    fontSize: 13, color: '#b06a00', lineHeight: 19,
    backgroundColor: '#fff6e5', borderRadius: 8, padding: 10, marginBottom: 8,
  },

  kalenderChip:     { borderColor: TEAL },
  kalenderOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
  kalenderBox:      { width: '88%', maxWidth: 360, backgroundColor: '#fff', borderRadius: 16, padding: 16 },
  kalenderKopf:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  kalenderPfeil:    { paddingHorizontal: 18, paddingVertical: 4 },
  kalenderPfeilText:{ fontSize: 26, lineHeight: 30, color: TEAL, fontWeight: '600' },
  kalenderTitel:    { fontSize: 16, fontWeight: '600', color: NAVY },
  kalenderWoche:    { flexDirection: 'row', marginBottom: 4 },
  kalenderWochentag:{ width: '14.28%', textAlign: 'center', fontSize: 11, color: '#999', fontWeight: '600' },
  kalenderGitter:   { flexDirection: 'row', flexWrap: 'wrap' },
  kalenderZelle:    { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  kalenderZelleAktiv:{ backgroundColor: TEAL },
  kalenderZelleHeute:{ borderWidth: 1.5, borderColor: TEAL },
  kalenderTag:      { fontSize: 15, color: '#333' },
  kalenderTagAus:   { color: '#ccc' },
  kalenderTagAktiv: { color: '#fff', fontWeight: '700' },
  kalenderFuss:     { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#eee' },
  kalenderFussText: { fontSize: 14, color: TEAL, fontWeight: '600' },
  kalenderFussGrau: { color: '#999' },

  zeitRow:   { flexDirection: 'row', gap: 12, marginTop: 8 },
  zeitField: { flex: 1 },
  zeitLabel: { fontSize: 11, color: '#999', marginBottom: 4, fontWeight: '500' },
  zeitInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dde',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    color: '#222',
  },
  zeitDauer: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dde',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    color: NAVY,
    fontWeight: '600',
  },

  recordArea: { alignItems: 'center', marginTop: 20, marginBottom: 20 },
  klientLabel: { color: TEAL, fontWeight: '600', fontSize: 15, marginBottom: 20 },

  recordBtn: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#fff',
    borderWidth: 3,
    borderColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  recordBtnActive: { borderColor: RED },
  recordInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordInnerActive: { backgroundColor: RED },
  micIcon:  { width: 20, height: 30, borderRadius: 10, backgroundColor: '#fff' },
  stopIcon: { width: 24, height: 24, borderRadius: 4,  backgroundColor: '#fff' },

  recordingStatus: { marginTop: 20, color: RED,  fontSize: 14, fontWeight: '500' },
  recordingHint:   { marginTop: 20, color: '#aaa', fontSize: 13 },

  recCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5eef0',
  },
  recFilename: { fontSize: 13, color: '#333', fontWeight: '500' },
  recMeta:     { fontSize: 12, color: '#888', marginTop: 3 },

  manualBtn: {
    backgroundColor: NAVY,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 14,
  },
  manualBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  manualHint: { fontSize: 12, color: '#aaa', marginTop: 6, textAlign: 'center' },

  retryBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderColor: TEAL,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 8,
  },
  retryBtnText: { color: TEAL, fontSize: 13, fontWeight: '600' },
});
