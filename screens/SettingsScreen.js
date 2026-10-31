import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  ladeKlienten,
  speichereKlienten,
  standDerListe,
  klientenAlsText,
  parseKlientenText,
  holeKlientenVonNextcloud,
} from './klienten';

const NAVY = '#1a4a6e';
const TEAL = '#2d8a7a';

export const getNextcloudConfig = async () => {
  const url              = await SecureStore.getItemAsync('nc_url');
  const username         = await SecureStore.getItemAsync('nc_user');
  const password         = await SecureStore.getItemAsync('nc_pass');
  const folder           = await SecureStore.getItemAsync('nc_folder');
  const transkriptFolder = await SecureStore.getItemAsync('nc_transkript');
  const zeitFolder       = await SecureStore.getItemAsync('nc_zeit');
  const klientenPfad     = await SecureStore.getItemAsync('nc_klienten');
  return { url, username, password, folder, transkriptFolder, zeitFolder, klientenPfad };
};

export const uploadToNextcloud = async (localPath, filename) => {
  const { url, username, password, folder } = await getNextcloudConfig();
  if (!url || !username || !password) throw new Error('Nextcloud nicht konfiguriert');

  // Kein persönlicher Pfad als Rückfallwert im Quelltext: lieber eine klare
  // Fehlermeldung als ein Upload in einen fremden Ordner.
  const uploadFolder = folder && folder.trim();
  if (!uploadFolder) throw new Error('Kein Upload-Ordner konfiguriert (Einstellungen)');
  const webdavBase  = url.replace(/\/$/, '') + '/remote.php/dav/files/' + username;
  const uploadUrl   = `${webdavBase}/${uploadFolder}/${filename}`;

  const authPre = btoa(`${username}:${password}`);
  // Ordnerpfad best-effort anlegen (405 = existiert bereits, ist ok)
  let acc = webdavBase;
  for (const seg of uploadFolder.split('/').filter(Boolean)) {
    acc += '/' + seg;
    try {
      await fetch(acc, { method: 'MKCOL', headers: { Authorization: `Basic ${authPre}` } });
    } catch (_) {}
  }

  const fileData = await fetch(`file://${localPath}`);
  const blob     = await fileData.blob();

  const auth = btoa(`${username}:${password}`);
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'audio/mp4',
    },
    body: blob,
  });

  if (!response.ok) throw new Error(`Upload fehlgeschlagen: HTTP ${response.status}`);
  return true;
};

export default function SettingsScreen() {
  const [url,      setUrl]      = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // Keine persönlichen Pfade als Vorgabe — die stünden sonst im Quelltext.
  const [folder,     setFolder]     = useState('');
  const [transkript, setTranskript] = useState('');
  const [zeit,       setZeit]       = useState('');
  const [klientenPfad, setKlientenPfad] = useState('');
  const [saving,   setSaving]   = useState(false);
  const [testing,  setTesting]  = useState(false);
  const [saved,    setSaved]    = useState(false);

  // Klientenliste
  const [klientenText, setKlientenText] = useState('');
  const [klientenZahl, setKlientenZahl] = useState(0);
  const [klientenStand, setKlientenStand] = useState(null);
  const [ladend, setLadend] = useState(false);

  useEffect(() => {
    (async () => {
      const u  = await SecureStore.getItemAsync('nc_url');
      const un = await SecureStore.getItemAsync('nc_user');
      const pw = await SecureStore.getItemAsync('nc_pass');
      const f  = await SecureStore.getItemAsync('nc_folder');
      const t  = await SecureStore.getItemAsync('nc_transkript');
      const z  = await SecureStore.getItemAsync('nc_zeit');
      const kp = await SecureStore.getItemAsync('nc_klienten');
      if (u)  setUrl(u);
      if (un) setUsername(un);
      if (pw) setPassword(pw);
      if (f)  setFolder(f);
      if (t)  setTranskript(t);
      if (z)  setZeit(z);
      if (kp) setKlientenPfad(kp);
      await klientenAnzeigen();
    })();
  }, []);

  const klientenAnzeigen = async () => {
    const liste = await ladeKlienten();
    setKlientenText(klientenAlsText(liste));
    setKlientenZahl(liste.length);
    setKlientenStand(await standDerListe());
  };

  const klientenSpeichern = async () => {
    const { liste, fehler, doppelt } = parseKlientenText(klientenText);
    if (fehler.length) {
      Alert.alert('Zeilen nicht lesbar', `Erwartet wird "CODE = KÜRZEL".\n\n${fehler.slice(0, 5).join('\n')}`);
      return;
    }
    if (doppelt.length) {
      Alert.alert('Code doppelt vergeben', doppelt.join(', '));
      return;
    }
    await speichereKlienten(liste);
    await klientenAnzeigen();
    Alert.alert('✓ Gespeichert', `${liste.length} Klienten übernommen.`);
  };

  const klientenVonNextcloud = async () => {
    setLadend(true);
    try {
      const liste = await holeKlientenVonNextcloud({
        url: url.trim(), username: username.trim(), password, pfad: klientenPfad.trim(),
      });
      await klientenAnzeigen();
      Alert.alert('✓ Geladen', `${liste.length} Klienten aus der Nextcloud übernommen.`);
    } catch (e) {
      Alert.alert('Laden fehlgeschlagen', e.message);
    }
    setLadend(false);
  };

  const save = async () => {
    if (!url || !username || !password) {
      Alert.alert('Fehler', 'URL, Benutzername und Passwort sind Pflichtfelder.');
      return;
    }
    // Klientendaten nur verschlüsselt übertragen: http blockieren, Schema ergänzen
    let cleanUrl = url.trim();
    if (/^http:\/\//i.test(cleanUrl)) {
      Alert.alert(
        'Unsichere Verbindung',
        'http:// überträgt Zugangsdaten und Klientendaten unverschlüsselt. Bitte https:// verwenden.'
      );
      return;
    }
    if (!/^https:\/\//i.test(cleanUrl)) cleanUrl = 'https://' + cleanUrl;
    setUrl(cleanUrl);
    setSaving(true);
    await SecureStore.setItemAsync('nc_url',    cleanUrl);
    await SecureStore.setItemAsync('nc_user',   username.trim());
    await SecureStore.setItemAsync('nc_pass',   password);
    await SecureStore.setItemAsync('nc_folder', folder.trim());
    await SecureStore.setItemAsync('nc_transkript', transkript.trim());
    await SecureStore.setItemAsync('nc_zeit', zeit.trim());
    await SecureStore.setItemAsync('nc_klienten', klientenPfad.trim());
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const testConnection = async () => {
    if (!url || !username || !password) {
      Alert.alert('Fehler', 'Erst speichern, dann testen.');
      return;
    }
    setTesting(true);
    try {
      const webdavUrl = url.replace(/\/$/, '') + '/remote.php/dav/files/' + username.trim() + '/';
      const auth = btoa(`${username.trim()}:${password}`);
      const res = await fetch(webdavUrl, {
        method: 'PROPFIND',
        headers: {
          Authorization: `Basic ${auth}`,
          Depth: '0',
        },
      });
      if (res.status === 207 || res.status === 200) {
        Alert.alert('✓ Verbindung OK', 'Nextcloud ist erreichbar.');
      } else {
        Alert.alert('Fehler', `HTTP ${res.status} — URL oder Zugangsdaten prüfen.`);
      }
    } catch (e) {
      Alert.alert('Verbindungsfehler', e.message);
    }
    setTesting(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chartr</Text>
        <Text style={styles.headerSub}>Einstellungen</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        <Text style={styles.sectionLabel}>Nextcloud</Text>
        <Text style={styles.hint}>
          App-Passwort erstellen: Nextcloud → Einstellungen → Sicherheit → App-Passwörter
        </Text>

        <Text style={styles.fieldLabel}>Server-URL</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder="https://cloud.beispiel.ch"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <Text style={styles.fieldLabel}>Benutzername</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          placeholder="jost"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.fieldLabel}>App-Passwort</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="xxxx-xxxx-xxxx-xxxx"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.fieldLabel}>Upload-Ordner</Text>
        <TextInput
          style={styles.input}
          value={folder}
          onChangeText={setFolder}
          placeholder="MeinOrdner/AUDIO_ROH"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.fieldLabel}>Transkript-Ordner (Inbox)</Text>
        <TextInput
          style={styles.input}
          value={transkript}
          onChangeText={setTranskript}
          placeholder="MeinOrdner/AUDIO_TRANSKRIPT"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.fieldLabel}>Zeiterfassungs-Ordner</Text>
        <TextInput
          style={styles.input}
          value={zeit}
          onChangeText={setZeit}
          placeholder="leer lassen = neben dem Upload-Ordner"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.hintKlein}>
          Bleibt das Feld leer, wird der Ordner aus dem Upload-Ordner abgeleitet:
          aus „…/AUDIO_ROH" wird „…/ZEITERFASSUNG".
        </Text>

        <Text style={styles.fieldLabel}>Klientenliste (Datei in der Nextcloud)</Text>
        <TextInput
          style={styles.input}
          value={klientenPfad}
          onChangeText={setKlientenPfad}
          placeholder="Ordner/klienten.json"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>{saved ? '✓ Gespeichert' : 'Speichern'}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.testBtn} onPress={testConnection} disabled={testing}>
          {testing ? (
            <ActivityIndicator color={TEAL} />
          ) : (
            <Text style={styles.testBtnText}>Verbindung testen</Text>
          )}
        </TouchableOpacity>

        {/* ── Klientenliste ───────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>Klientenliste</Text>
        <Text style={styles.hint}>
          Eine Zeile je Klient: <Text style={styles.mono}>CODE = KÜRZEL</Text>.
          Der Code ist zugleich der Ordnername, das Kürzel erscheint im Bericht.
          Jedes Kürzel darf nur einmal vorkommen.
        </Text>

        <Text style={styles.klientenStatus}>
          {klientenZahl} Klienten auf diesem Gerät
          {klientenStand ? ` · Stand ${new Date(klientenStand).toLocaleDateString('de-CH')}` : ''}
        </Text>

        <TextInput
          style={[styles.input, styles.klientenFeld]}
          value={klientenText}
          onChangeText={setKlientenText}
          placeholder={'XY1 = X.Y.\nAB2 = A.B.'}
          multiline
          autoCapitalize="characters"
          autoCorrect={false}
        />

        <TouchableOpacity style={styles.saveBtn} onPress={klientenSpeichern}>
          <Text style={styles.saveBtnText}>Klientenliste speichern</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.testBtn} onPress={klientenVonNextcloud} disabled={ladend}>
          {ladend ? (
            <ActivityIndicator color={TEAL} />
          ) : (
            <Text style={styles.testBtnText}>Aus Nextcloud laden</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.hintKlein}>
          Überschreibt die Liste auf dem Gerät mit der Datei aus der Nextcloud.
          So wird ein neuer Klient nur an einer Stelle gepflegt.
        </Text>

      </ScrollView>
    </View>
  );
}

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
    fontSize: 12, fontWeight: '600', color: '#888',
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 6, marginTop: 16,
  },
  hint: { fontSize: 12, color: '#aaa', marginBottom: 16, lineHeight: 18 },

  fieldLabel: { fontSize: 13, color: '#555', fontWeight: '500', marginBottom: 4, marginTop: 12 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#dde', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#222',
  },

  saveBtn: {
    backgroundColor: NAVY, borderRadius: 10,
    paddingVertical: 14, alignItems: 'center', marginTop: 28,
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  testBtn: {
    borderWidth: 1.5, borderColor: TEAL, borderRadius: 10,
    paddingVertical: 13, alignItems: 'center', marginTop: 12,
  },
  testBtnText: { color: TEAL, fontSize: 15, fontWeight: '600' },

  hintKlein: { fontSize: 11, color: '#aaa', marginTop: 6, lineHeight: 16 },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  klientenStatus: { fontSize: 12, color: TEAL, fontWeight: '600', marginBottom: 8 },
  klientenFeld: { minHeight: 160, textAlignVertical: 'top', fontSize: 13, lineHeight: 20 },
});
