import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNotes } from './lib/store';
import { navigate, replaceRoute, useRoute, type TabName } from './lib/useRoute';
import { getStoredTheme, setStoredTheme } from './lib/prefs';
import { downloadText } from './lib/exportImport';
import type { Note, ThemeMode } from './lib/types';
import { NotesScreen } from './screens/NotesScreen';
import { EditorScreen } from './screens/EditorScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { GraphView } from './components/GraphView';
import { SearchScreen } from './components/SearchScreen';
import { TabBar } from './components/TabBar';
import { ActionSheet, type ActionSheetItem } from './components/ActionSheet';
import { Icon } from './components/Icon';

const APP_TITLE = 'Inkstone · 砚';

function safeFileName(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[\\/:*?"<>|#%{}$!'@+`=]/g, '-')
    .replace(/\s+/g, ' ');
  return cleaned.slice(0, 60) || 'note';
}

/** Application shell: routing, theme, toast and the action sheets. */
export default function App() {
  const api = useNotes();
  const route = useRoute();

  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [noteMenu, setNoteMenu] = useState<Note | null>(null);
  const [editorMenuOpen, setEditorMenuOpen] = useState(false);

  const returnToRef = useRef<TabName>('notes');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  // Ensure the URL always describes a real route.
  useEffect(() => {
    if (!window.location.hash) replaceRoute({ name: 'notes' });
  }, []);

  // Resolve the active theme (including the `system` preference).
  useEffect(() => {
    const apply = () => {
      const resolved =
        theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: light)').matches
            ? 'light'
            : 'dark'
          : theme;
      document.documentElement.dataset.theme = resolved;
      document.title = APP_TITLE;
      const meta = document.querySelector('meta[name="theme-color"]');
      meta?.setAttribute('content', resolved === 'light' ? '#f6f6f8' : '#0e0e12');
    };
    apply();
    setStoredTheme(theme);
    if (theme !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: light)');
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [theme]);

  const activeNote = useMemo(
    () => (route.name === 'note' ? api.notes.find((note) => note.id === route.id) ?? null : null),
    [api.notes, route],
  );

  // If a note disappears (deleted elsewhere), fall back to the previous tab.
  useEffect(() => {
    if (!api.ready) return;
    if (route.name === 'note' && !activeNote) {
      replaceRoute({ name: returnToRef.current });
    }
  }, [activeNote, api.ready, route]);

  useEffect(() => {
    setNoteMenu(null);
    setEditorMenuOpen(false);
  }, [route]);

  const openNote = useCallback(
    (id: string) => {
      if (route.name !== 'note') returnToRef.current = route.name;
      navigate({ name: 'note', id });
    },
    [route],
  );

  const createNote = useCallback(
    async (input: { title?: string; content?: string } = {}) => {
      if (route.name !== 'note') returnToRef.current = route.name;
      const note = await api.createNote(input);
      navigate({ name: 'note', id: note.id });
    },
    [api.createNote, route],
  );

  const openOrCreateByTitle = useCallback(
    async (title: string) => {
      if (route.name !== 'note') returnToRef.current = route.name;
      const note = await api.ensureNote(title);
      notify(`已打开「${note.title}」`);
      navigate({ name: 'note', id: note.id });
    },
    [api.ensureNote, notify, route],
  );

  const goBack = useCallback(() => {
    navigate({ name: returnToRef.current });
  }, []);

  const removeNote = useCallback(
    async (note: Note) => {
      const label = note.title || '未命名笔记';
      if (!window.confirm(`删除「${label}」？此操作不可撤销。`)) return;
      await api.deleteNote(note.id);
      notify('已删除笔记');
      if (route.name === 'note') navigate({ name: returnToRef.current });
    },
    [api.deleteNote, notify, route],
  );

  const copyMarkdown = useCallback(
    async (note: Note) => {
      const markdown = `# ${note.title}\n\n${note.content}`;
      try {
        await navigator.clipboard.writeText(markdown);
        notify('已复制 Markdown');
      } catch {
        notify('复制失败，请使用「导出为 .md」');
      }
    },
    [notify],
  );

  const exportMarkdown = useCallback(
    (note: Note) => {
      downloadText(
        `${safeFileName(note.title)}.md`,
        `# ${note.title}\n\n${note.content}`,
        'text/markdown',
      );
      notify('已导出 .md 文件');
    },
    [notify],
  );

  const noteMenuItems = useMemo<ActionSheetItem[]>(() => {
    if (!noteMenu) return [];
    return [
      {
        label: noteMenu.pinned ? '取消置顶' : '置顶笔记',
        icon: 'pin',
        onSelect: () => api.togglePin(noteMenu.id),
      },
      { label: '复制 Markdown', icon: 'book', onSelect: () => void copyMarkdown(noteMenu) },
      { label: '导出为 .md', icon: 'download', onSelect: () => exportMarkdown(noteMenu) },
      {
        label: '删除笔记',
        icon: 'trash',
        danger: true,
        onSelect: () => void removeNote(noteMenu),
      },
    ];
  }, [api, copyMarkdown, exportMarkdown, noteMenu, removeNote]);

  const editorMenuItems = useMemo<ActionSheetItem[]>(() => {
    if (!activeNote) return [];
    return [
      { label: '复制 Markdown', icon: 'book', onSelect: () => void copyMarkdown(activeNote) },
      { label: '导出为 .md', icon: 'download', onSelect: () => exportMarkdown(activeNote) },
      {
        label: '删除笔记',
        icon: 'trash',
        danger: true,
        onSelect: () => void removeNote(activeNote),
      },
    ];
  }, [activeNote, copyMarkdown, exportMarkdown, removeNote]);

  if (!api.ready) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <p>正在打开你的笔记库…</p>
      </div>
    );
  }

  const activeTab: TabName = route.name === 'note' ? returnToRef.current : route.name;

  const renderTabScreen = () => {
    switch (route.name) {
      case 'graph':
        return (
          <div className="screen graph-screen">
            <header className="screen-header app-header">
              <div className="app-brand">
                <span className="app-logo" aria-hidden="true">
                  砚
                </span>
                <div className="app-brand-text">
                  <h1 className="app-title">关系图谱</h1>
                  <p className="app-subtitle">{api.notes.length} 个节点 · 点按节点打开笔记</p>
                </div>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="返回笔记列表"
                onClick={() => navigate({ name: 'notes' })}
              >
                <Icon name="notes" size={21} />
              </button>
            </header>
            <div className="graph-host">
              <GraphView
                notes={api.notes}
                activeNoteId={null}
                onOpenNote={openNote}
                onCreateNote={(title) => void openOrCreateByTitle(title)}
              />
            </div>
          </div>
        );
      case 'search':
        return (
          <SearchScreen
            notes={api.sortedNotes}
            onOpenNote={openNote}
            onOpenTag={(tag) => {
              setTagFilter(tag);
              navigate({ name: 'notes' });
            }}
          />
        );
      case 'settings':
        return (
          <SettingsScreen
            notes={api.notes}
            storageMode={api.storageMode}
            theme={theme}
            onThemeChange={setTheme}
            onReplaceAll={api.replaceAll}
            onClearAll={api.clearAll}
            notify={notify}
            onOpenNote={openNote}
          />
        );
      case 'notes':
      default:
        return (
          <NotesScreen
            notes={api.sortedNotes}
            loading={false}
            tagFilter={tagFilter}
            onTagFilter={setTagFilter}
            onOpenNote={openNote}
            onNoteMenu={setNoteMenu}
            onOpenSearch={() => navigate({ name: 'search' })}
            storageWarning={api.storageWarning}
          />
        );
    }
  };

  const editing = route.name === 'note' && activeNote;

  return (
    <div className="app">
      {editing ? (
        <EditorScreen
          key={activeNote.id}
          note={activeNote}
          notes={api.notes}
          onChange={(patch) => api.updateNote(activeNote.id, patch)}
          onBack={goBack}
          onTogglePin={() => api.togglePin(activeNote.id)}
          onMenu={() => setEditorMenuOpen(true)}
          onOpenNote={openNote}
          onCreateNote={(title) => void openOrCreateByTitle(title)}
        />
      ) : (
        <>
          <main className="app-main">{renderTabScreen()}</main>
          <TabBar active={activeTab} onChange={(tab) => navigate({ name: tab })} notesCount={api.notes.length} />
          {activeTab === 'notes' ? (
            <button
              type="button"
              className="fab"
              aria-label="新建笔记"
              onClick={() => void createNote()}
            >
              <Icon name="plus" size={26} />
            </button>
          ) : null}
        </>
      )}

      <ActionSheet
        open={noteMenu !== null}
        title="笔记操作"
        items={noteMenuItems}
        onClose={() => setNoteMenu(null)}
      />
      <ActionSheet
        open={editorMenuOpen}
        title="笔记操作"
        items={editorMenuItems}
        onClose={() => setEditorMenuOpen(false)}
      />

      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
