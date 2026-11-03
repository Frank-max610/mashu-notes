import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNotes } from './lib/store';
import { navigate, parseRoute, replaceRoute, routeToHash, useRoute, type TabName } from './lib/useRoute';
import { getAgentPersona, getStoredTheme, setAgentPersona, setStoredTheme } from './lib/prefs';
import { downloadText } from './lib/exportImport';
import type { AgentPersona, Note, NoteKind, NotePosition, RecordDraft, ThemeMode } from './lib/types';
import { KIND_INFO } from './lib/kinds';
import type { KindFilter } from './screens/NotesScreen';
import { NotesScreen } from './screens/NotesScreen';
import { EditorScreen } from './screens/EditorScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SearchScreen } from './components/SearchScreen';
import { GraphView } from './components/GraphView';
import { AgentPanel } from './components/AgentPanel';
import { CaptureSheet } from './components/CaptureSheet';
import { NodeEditorSheet, type NodeEditorValues } from './components/NodeEditorSheet';
import { TabBar } from './components/TabBar';
import { ActionSheet, type ActionSheetItem } from './components/ActionSheet';
import { Icon } from './components/Icon';

const APP_TITLE = '麻薯';

function safeFileName(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[\\/:*?"<>|#%{}$!'@+`=]/g, '-')
    .replace(/\s+/g, ' ');
  return cleaned.slice(0, 60) || 'note';
}

/** Application shell: routing, theme, capture sheet, life graph and agent. */
export default function App() {
  const api = useNotes();
  const route = useRoute();

  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const [persona, setPersona] = useState<AgentPersona>(() => getAgentPersona());
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [toast, setToast] = useState<string | null>(null);
  const [noteMenu, setNoteMenu] = useState<Note | null>(null);
  const [editorMenuOpen, setEditorMenuOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureKind, setCaptureKind] = useState<NoteKind | undefined>(undefined);
  const [nodeEditor, setNodeEditor] = useState<{
    open: boolean;
    noteId: string | null;
    position?: NotePosition;
  }>({ open: false, noteId: null });

  const returnToRef = useRef<TabName>('notes');
  const openedFromAppRef = useRef(false);
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

  // Keep the URL canonical.
  useEffect(() => {
    const parsed = parseRoute(window.location.hash);
    if (routeToHash(parsed) !== window.location.hash) replaceRoute(parsed);
  }, [route]);

  // Tell the user when the phone goes offline — everything keeps working.
  useEffect(() => {
    const onOffline = () => notify('已离线 · 记录仍然只保存在这台手机上');
    const onOnline = () => notify('网络已恢复');
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [notify]);

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
      meta?.setAttribute('content', resolved === 'light' ? '#f7f5f0' : '#1c1e1c');
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
    setNodeEditor((current) => (current.open ? { open: false, noteId: null } : current));
  }, [route]);

  const openNote = useCallback(
    (id: string) => {
      if (route.name !== 'note') {
        returnToRef.current = route.name;
        openedFromAppRef.current = true;
      }
      navigate({ name: 'note', id });
    },
    [route],
  );

  const openCapture = useCallback((kind?: NoteKind) => {
    setCaptureKind(kind);
    setCaptureOpen(true);
  }, []);

  const saveDraft = useCallback(
    async (draft: RecordDraft) => {
      const note = await api.createNote({
        title: draft.title,
        content: draft.content,
        kind: draft.kind,
        meta: draft.meta,
      });
      notify(`已记下：${KIND_INFO[draft.kind].label} · ${note.title}`);
    },
    [api.createNote, notify],
  );

  const openOrCreateByTitle = useCallback(
    async (title: string) => {
      if (route.name !== 'note') {
        returnToRef.current = route.name;
        openedFromAppRef.current = true;
      }
      const note = await api.ensureNote(title);
      notify(`已打开「${note.title}」`);
      navigate({ name: 'note', id: note.id });
    },
    [api.ensureNote, notify, route],
  );

  const goBack = useCallback(() => {
    if (openedFromAppRef.current && window.history.length > 1) {
      openedFromAppRef.current = false;
      window.history.back();
      return;
    }
    navigate({ name: returnToRef.current });
  }, []);

  const removeNote = useCallback(
    async (note: Note) => {
      const label = note.title || '未命名记录';
      if (!window.confirm(`删除「${label}」？此操作不可撤销。`)) return;
      const removed = await api.deleteNote(note.id);
      if (!removed) {
        notify('删除失败，请重试或先导出备份');
        return;
      }
      notify('已删除');
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
      downloadText(`${safeFileName(note.title)}.md`, `# ${note.title}\n\n${note.content}`, 'text/markdown');
      notify('已导出 .md 文件');
    },
    [notify],
  );

  const editRecord = useCallback((note: Note) => {
    setNodeEditor({ open: true, noteId: note.id });
  }, []);

  const noteMenuItems = useMemo<ActionSheetItem[]>(() => {
    if (!noteMenu) return [];
    return [
      {
        label: noteMenu.pinned ? '取消置顶' : '置顶记录',
        icon: 'pin',
        onSelect: () => api.togglePin(noteMenu.id),
      },
      { label: '编辑记录信息', icon: 'edit', onSelect: () => editRecord(noteMenu) },
      { label: '复制 Markdown', icon: 'book', onSelect: () => void copyMarkdown(noteMenu) },
      { label: '导出为 .md', icon: 'download', onSelect: () => exportMarkdown(noteMenu) },
      { label: '删除', icon: 'trash', danger: true, onSelect: () => void removeNote(noteMenu) },
    ];
  }, [api, copyMarkdown, editRecord, exportMarkdown, noteMenu, removeNote]);

  const editorMenuItems = useMemo<ActionSheetItem[]>(() => {
    if (!activeNote) return [];
    return [
      { label: '编辑记录信息', icon: 'edit', onSelect: () => editRecord(activeNote) },
      { label: '复制 Markdown', icon: 'book', onSelect: () => void copyMarkdown(activeNote) },
      { label: '导出为 .md', icon: 'download', onSelect: () => exportMarkdown(activeNote) },
      { label: '删除', icon: 'trash', danger: true, onSelect: () => void removeNote(activeNote) },
    ];
  }, [activeNote, copyMarkdown, editRecord, exportMarkdown, removeNote]);

  const nodeEditorNote = useMemo(
    () => (nodeEditor.noteId ? api.notes.find((note) => note.id === nodeEditor.noteId) ?? null : null),
    [api.notes, nodeEditor.noteId],
  );

  const handleNodeSave = useCallback(
    (values: NodeEditorValues) => {
      if (nodeEditorNote) {
        api.updateNote(nodeEditorNote.id, {
          title: values.title,
          kind: values.kind,
          meta: values.meta,
        });
        const before = new Set(nodeEditorNote.manualLinks);
        const after = new Set(values.manualLinks);
        for (const id of after) if (!before.has(id)) api.addManualLink(nodeEditorNote.id, id);
        for (const id of before) if (!after.has(id)) api.removeManualLink(nodeEditorNote.id, id);
        notify('已更新记录');
      } else {
        void api
          .createNote({
            title: values.title,
            kind: values.kind,
            meta: values.meta,
            position: nodeEditor.position,
          })
          .then(() => notify('已添加记录'));
      }
      setNodeEditor({ open: false, noteId: null });
    },
    [api, nodeEditor.position, nodeEditorNote, notify],
  );

  const handlePersonaChange = useCallback(
    (next: AgentPersona) => {
      setPersona(next);
      setAgentPersona(next);
      notify('助手已更新');
    },
    [notify],
  );

  if (!api.ready) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <p>正在打开本地记录…</p>
      </div>
    );
  }

  const activeTab: TabName = route.name === 'note' ? returnToRef.current : route.name;

  const renderTabScreen = () => {
    switch (route.name) {
      case 'graph':
        return (
          <div className="screen graph-screen">
            <header className="screen-header graph-header">
              <div>
                <h1 className="screen-title">生活图谱</h1>
                <p className="screen-subtitle">拖动、添加、连线，随你整理</p>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="回到记录"
                onClick={() => navigate({ name: 'notes' })}
              >
                <Icon name="notes" size={20} />
              </button>
            </header>
            <div className="graph-host">
              <GraphView
                notes={api.notes}
                activeNoteId={null}
                selectedNoteId={nodeEditor.open && nodeEditor.noteId ? nodeEditor.noteId : null}
                onSelectNote={(id) => setNodeEditor({ open: id !== null, noteId: id })}
                onOpenNote={openNote}
                onMoveNote={(id, position) => api.setNodePosition(id, position)}
                onCreateNoteAt={(position) => setNodeEditor({ open: true, noteId: null, position })}
                onLinkNotes={(sourceId, targetId) => {
                  api.addManualLink(sourceId, targetId);
                  notify('已连一条线');
                }}
                onRequestResetLayout={() => {
                  api.resetNodePositions();
                  notify('已恢复自动布局');
                }}
              />
            </div>
          </div>
        );
      case 'search':
        return <SearchScreen notes={api.sortedNotes} onOpenNote={openNote} />;
      case 'agent':
        return (
          <AgentPanel
            persona={persona}
            notes={api.sortedNotes}
            onSaveDraft={saveDraft}
            onOpenNote={openNote}
            onEditPersona={() => navigate({ name: 'settings' })}
            onCreateRecord={() => openCapture()}
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
            persona={persona}
            onPersonaChange={handlePersonaChange}
          />
        );
      case 'notes':
      default:
        return (
          <NotesScreen
            notes={api.sortedNotes}
            loading={false}
            kindFilter={kindFilter}
            onKindFilter={setKindFilter}
            onOpenNote={openNote}
            onNoteMenu={setNoteMenu}
            onOpenSearch={() => navigate({ name: 'search' })}
            onQuickCapture={openCapture}
            onOpenAgent={() => navigate({ name: 'agent' })}
            onOpenSettings={() => navigate({ name: 'settings' })}
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
          onEditRecord={() => editRecord(activeNote)}
          storageWarning={api.storageWarning}
        />
      ) : (
        <>
          <main className="app-main">{renderTabScreen()}</main>
          <TabBar
            active={activeTab}
            onChange={(tab) => navigate({ name: tab })}
            onCompose={() => openCapture()}
            notesCount={api.notes.length}
          />
        </>
      )}

      <ActionSheet
        open={noteMenu !== null}
        title="记录操作"
        items={noteMenuItems}
        onClose={() => setNoteMenu(null)}
      />
      <ActionSheet
        open={editorMenuOpen}
        title="记录操作"
        items={editorMenuItems}
        onClose={() => setEditorMenuOpen(false)}
      />

      <CaptureSheet
        open={captureOpen}
        initialKind={captureKind}
        onClose={() => setCaptureOpen(false)}
        onSave={saveDraft}
      />

      <NodeEditorSheet
        open={nodeEditor.open}
        note={nodeEditorNote}
        notes={api.notes}
        position={nodeEditor.position}
        onClose={() => setNodeEditor({ open: false, noteId: null })}
        onSave={handleNodeSave}
        onDelete={
          nodeEditorNote
            ? () => {
                void removeNote(nodeEditorNote).then(() =>
                  setNodeEditor({ open: false, noteId: null }),
                );
              }
            : undefined
        }
        onOpenNote={openNote}
      />

      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
