import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Modal,
  Share,
  ActivityIndicator,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect } from '@react-navigation/native';
import { getNextcloudConfig } from './SettingsScreen';

const NAVY = '#1a4a6e';
const TEAL = '#2d8a7a';

const READ_FILE = FileSystem.documentDirectory + 'chartr_inbox.json';

// ─── Gelesen-Status lokal persistieren ───────────────────────────────────────
const loadReadSet = async () => {
  try {
    const info = await FileSystem.getInfoAsync(READ_FILE);
    if (!info.exists) return new Set();
    return new Set(JSON.parse(await FileSystem.readAsStringAsync(READ_FILE)));
  } catch (_) {
    return new Set();
  }
};
const saveReadSet = (set) =>
  FileSystem.writeAsStringAsync(READ_FILE, JSON.stringify([...set])).catch(() => {});

// ─── Dateiname CODE_JJJJMMTT_von_bis.txt → Anzeige-Infos ─────────────────────
const parseFilename = (name) => {
  const stem = name.replace(/\.(txt|md)$/i, '');
  const parts = stem.split('_');
  const code = parts[0] || stem;
  let datum = '';
  if (/^\d{8}$/.test(parts[1] || '')) {
    datum = `${parts[1].slice(6, 8)}.${parts[1].slice(4, 6)}.${parts[1].slice(0, 4)}`;
  }
  let zeit = '';
  if (/^\d{4}$/.test(parts[2] || '') && /^\d{4}$/.test(parts[3] || '')) {
    zeit = `${parts[2].slice(0, 2)}:${parts[2].slice(2)}–${parts[3].slice(0, 2)}:${parts[3].slice(2)}`;
  }
  return { code, datum, zeit };
};

export default function InboxScreen() {
  const [items, setItems]                 = useState([]);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState(null);
  const [readSet, setReadSet]             = useState(new Set());
  const [selected, setSelected]           = useState(null);
  const [content, setContent]             = useState('');
  const [contentLoading, setContentLoading] = useState(false);

  const getBase = async () => {
    const { url, username, password, transkriptFolder } = await getNextcloudConfig();
    if (!url || !username || !password) {
      throw new Error('Nextcloud nicht konfiguriert — siehe Einstellungen.');
    }
    // Kein persönlicher Pfad als Rückfallwert im Quelltext — lieber eine klare
    // Meldung als der Griff in einen fremden Ordner.
    const folder = transkriptFolder && transkriptFolder.trim();
    if (!folder) {
      throw new Error('Kein Transkript-Ordner konfiguriert — siehe Einstellungen.');
    }
    const base   = url.replace(/\/$/, '') + '/remote.php/dav/files/' + username;
    const auth   = btoa(`${username}:${password}`);
    return { base, folder, auth };
  };

  // ─── Liste laden (PROPFIND Depth 1) ────────────────────────────────────────
  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { base, folder, auth } = await getBase();
      const res = await fetch(`${base}/${folder}/`, {
        method: 'PROPFIND',
        headers: { Authorization: `Basic ${auth}`, Depth: '1' },
      });
      if (res.status === 404) {
        throw new Error(`Ordner «${folder}» existiert nicht auf Nextcloud. Pfad in den Einstellungen prüfen.`);
      }
      if (!(res.status === 207 || res.ok)) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();

      const found  = [];
      const respRe = /<[^>]*:?response[^>]*>([\s\S]*?)<\/[^>]*:?response>/gi;
      let m;
      while ((m = respRe.exec(xml))) {
        const block = m[1];
        const href  = (block.match(/<[^>]*:?href[^>]*>([^<]+)</i) || [])[1];
        if (!href) continue;
        const name = decodeURIComponent(href.split('/').filter(Boolean).pop() || '');
        if (!/\.(txt|md)$/i.test(name)) continue;
        const mod = (block.match(/<[^>]*:?getlastmodified[^>]*>([^<]+)</i) || [])[1];
        found.push({ filename: name, modified: mod ? new Date(mod) : null });
      }
      found.sort((a, b) => (b.modified?.getTime() || 0) - (a.modified?.getTime() || 0));
      setItems(found);
      setReadSet(await loadReadSet());
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadList();
    }, [loadList])
  );

  // ─── Transkript öffnen ─────────────────────────────────────────────────────
  const openItem = async (item) => {
    setSelected(item);
    setContent('');
    setContentLoading(true);
    try {
      const { base, folder, auth } = await getBase();
      const res = await fetch(`${base}/${folder}/${encodeURIComponent(item.filename)}`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setContent(await res.text());
      setReadSet((prev) => {
        const next = new Set(prev);
        next.add(item.filename);
        saveReadSet(next);
        return next;
      });
    } catch (e) {
      setContent('Fehler beim Laden: ' + e.message);
    }
    setContentLoading(false);
  };

  const shareContent = async () => {
    try {
      await Share.share({ message: content });
    } catch (_) {}
  };

  const unreadCount = items.filter((i) => !readSet.has(i.filename)).length;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chartr</Text>
        <Text style={styles.headerSub}>
          Inbox — Transkripte{unreadCount > 0 ? ` · ${unreadCount} neu` : ''}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadList} />}
      >
        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>⚠ {error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={loadList}>
              <Text style={styles.retryBtnText}>⟳ Erneut versuchen</Text>
            </TouchableOpacity>
          </View>
        )}

        {!error && !loading && items.length === 0 && (
          <Text style={styles.emptyText}>
            Keine Transkripte gefunden.{'\n'}Zum Aktualisieren nach unten ziehen.
          </Text>
        )}

        {items.map((item) => {
          const { code, datum, zeit } = parseFilename(item.filename);
          const isRead = readSet.has(item.filename);
          return (
            <TouchableOpacity
              key={item.filename}
              style={styles.card}
              onPress={() => openItem(item)}
              activeOpacity={0.7}
            >
              <View style={styles.cardRow}>
                {!isRead && <View style={styles.unreadDot} />}
                <Text style={[styles.cardCode, !isRead && styles.cardCodeUnread]}>{code}</Text>
                <Text style={styles.cardDate}>
                  {datum}{zeit ? ` · ${zeit}` : ''}
                </Text>
              </View>
              <Text style={styles.cardFilename}>{item.filename}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ─── Detail-Ansicht ─── */}
      <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {selected ? parseFilename(selected.filename).code : ''}
            </Text>
            <Text style={styles.headerSub}>{selected?.filename}</Text>
          </View>

          {contentLoading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={TEAL} />
            </View>
          ) : (
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
              <Text style={styles.transcriptText} selectable>
                {content}
              </Text>
            </ScrollView>
          )}

          <View style={styles.modalBar}>
            <TouchableOpacity style={styles.shareBtn} onPress={shareContent}>
              <Text style={styles.shareBtnText}>Teilen / Kopieren</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setSelected(null)}>
              <Text style={styles.closeBtnText}>Schliessen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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

  emptyText: { color: '#aaa', fontSize: 14, textAlign: 'center', marginTop: 48, lineHeight: 22 },

  errorCard: {
    backgroundColor: '#fdf3f2',
    borderWidth: 1,
    borderColor: '#e8c8c4',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  errorText: { color: '#a94438', fontSize: 13, lineHeight: 19 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5eef0',
  },
  cardRow: { flexDirection: 'row', alignItems: 'center' },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: TEAL,
    marginRight: 8,
  },
  cardCode:       { fontSize: 15, fontWeight: '600', color: '#555', marginRight: 10 },
  cardCodeUnread: { color: NAVY },
  cardDate:       { fontSize: 13, color: '#888' },
  cardFilename:   { fontSize: 11, color: '#bbb', marginTop: 4 },

  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  transcriptText: { fontSize: 15, color: '#222', lineHeight: 24 },

  modalBar: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    paddingBottom: 28,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5eef0',
  },
  shareBtn: {
    flex: 1,
    backgroundColor: NAVY,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  shareBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  closeBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: TEAL,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  closeBtnText: { color: TEAL, fontSize: 15, fontWeight: '600' },

  retryBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderColor: TEAL,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 10,
  },
  retryBtnText: { color: TEAL, fontSize: 13, fontWeight: '600' },
});
