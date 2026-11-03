import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNotes } from './lib/store';
import { navigate, parseRoute, replaceRoute, routeToHash, useRoute, type TabName } from './lib/useRoute';
import { getAgentPersona, getStoredTheme, setAgentPersona, setStoredTheme } from './lib/prefs';
import { downloadText } from './lib/exportImport';
import { buildDailyBrief } from './lib/brief';
import { decodeHealthPayload, healthSamplesToNotes, parseHealthCsv, parseHealthJson } from './lib/health';
import { summarizeRange } from './lib/insights';
import type { AgentPersona, Note, NoteKind, NotePosition, RecordDraft, ThemeMode } from './lib/types';
import type { KindFilter } from './screens/RecordsScreen';
import { TodayScreen } from './screens/TodayScreen';
import { RecordsScreen } from './screens/RecordsScreen';
import { EditorScreen, type Mode as EditorMode } from './screens/EditorScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { GraphView } from './components/GraphView';
import { AgentPanel } from './components/AgentPanel';
import { CaptureSheet } from './components/CaptureSheet';
import { NodeEditorSheet, type NodeEditorValues } from './components/NodeEditorSheet';
import { TabBar } from './components/TabBar';
import { ActionSheet, type ActionSheetItem } from './components/ActionSheet';
import { SearchScreen } from './components/SearchScreen';

const APP_TITLE = '麻薯';

function safeFileName(title: string): string {
  return (
    title
      .trim()
      .replace(/[\\/:*?"<>|#%{}$!'@+`=]/g, '-')
      .replace(/\s+/g, ' ')
      .slice(0, 60) || 'note'
  );
}

/** Application shell: dashboard, records, life graph and the local agent. */
export default function App() {
  const api = useNotes();
  const route = useRoute();

  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const [persona, setPersona] = useState<AgentPersona>(() => getAgentPersona());
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [toast, setToast] = useState<string | null>(null);
  const [noteMenu, setNoteMenu] = useState<Note | null>(null);
  const [editorMenuOpen, setEditorMenuOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>('preview');
  const [graphSelectedId, setGraphSelectedId] = useState<string | null>(null);
  const [graphFullscreen, setGraphFullscreen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureKind, setCaptureKind] = useState<NoteKind | undefined>(undefined);
  const [nodeEditor, setNodeEditor] = useState<{ open: boolean; noteId: string | null; position?: NotePosition }>({
    open: false,
    noteId: null,
  });

  const returnToRef = useRef<TabName>('today');
  const openedFromAppRef = useRef(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const healthImportStarted = useRef(false);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  // Canonical hash.
  useEffect(() => {
    const parsed = parseRoute(window.location.hash);
    if (routeToHash(parsed) !== window.location.hash) replaceRoute(parsed);
  }, [route]);

  // Offline / online feedback.
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

  // Theme + document colour scheme.
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
      meta?.setAttribute('content', resolved === 'light' ? '#f7f3ec' : '#171410');
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

  useEffect(() => {
    if (!activeNote) return;
    setEditorMode(activeNote.content.trim() ? 'preview' : 'edit');
  }, [activeNote?.id]);

  useEffect(() => {
    if (!api.ready) return;
    if (route.name === 'note' && !activeNote) replaceRoute({ name: returnToRef.current });
  }, [activeNote, api.ready, route]);

  useEffect(() => {
    setNoteMenu(null);
    setEditorMenuOpen(false);
    setNodeEditor((current) => (current.open ? { open: false, noteId: null } : current));
  }, [route]);

  const openNote = useCallback(
    (id: string) => {
      if (route.name !== 'note') {
        returnToRef.current = route.name === 'search' ? 'records' : route.name;
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
      notify(`已记下：${note.title}`);
    },
    [api.createNote, notify],
  );

  const openOrCreateByTitle = useCallback(
    async (title: string) => {
      if (route.name !== 'note') {
        returnToRef.current = route.name === 'search' ? 'records' : route.name;
        openedFromAppRef.current = true;
      }
      const note = await api.ensureNote(title);
      navigate({ name: 'note', id: note.id });
    },
    [api.ensureNote, route],
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
      if (!window.confirm(`删除「${note.title || '未命名记录'}」？此操作不可撤销。`)) return;
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
      try {
        await navigator.clipboard.writeText(`# ${note.title}\n\n${note.content}`);
        notify('已复制 Markdown');
      } catch {
        notify('复制失败');
      }
    },
    [notify],
  );

  const exportMarkdown = useCallback(
    (note: Note) => {
      downloadText(`${safeFileName(note.title)}.md`, `# ${note.title}\n\n${note.content}`, 'text/markdown');
      notify('已导出 .md');
    },
    [notify],
  );

  const editRecord = useCallback((note: Note) => setNodeEditor({ open: true, noteId: note.id }), []);

  const noteMenuItems = useMemo<ActionSheetItem[]>(() => {
    if (!noteMenu) return [];
    return [
      { label: noteMenu.pinned ? '取消置顶' : '置顶', icon: 'pin', onSelect: () => api.togglePin(noteMenu.id) },
      { label: '编辑记录信息', icon: 'edit', onSelect: () => editRecord(noteMenu) },
      { label: '复制 Markdown', icon: 'book', onSelect: () => void copyMarkdown(noteMenu) },
      { label: '导出为 .md', icon: 'download', onSelect: () => exportMarkdown(noteMenu) },
      { label: '删除', icon: 'trash', danger: true, onSelect: () => void removeNote(noteMenu) },
    ];
  }, [api, copyMarkdown, editRecord, exportMarkdown, noteMenu, removeNote]);

  const editorMenuItems = useMemo<ActionSheetItem[]>(() => {
    if (!activeNote) return [];
    return [
      {
        label: editorMode === 'edit' ? '完成编辑' : '编辑正文',
        icon: 'edit',
        onSelect: () => setEditorMode(editorMode === 'edit' ? 'preview' : 'edit'),
      },
      { label: '编辑记录信息', icon: 'tag', onSelect: () => editRecord(activeNote) },
      {
        label: activeNote.pinned ? '取消置顶' : '置顶',
        icon: 'pin',
        onSelect: () => api.togglePin(activeNote.id),
      },
      { label: '复制 Markdown', icon: 'book', onSelect: () => void copyMarkdown(activeNote) },
      { label: '导出为 .md', icon: 'download', onSelect: () => exportMarkdown(activeNote) },
      { label: '删除', icon: 'trash', danger: true, onSelect: () => void removeNote(activeNote) },
    ];
  }, [activeNote, api, copyMarkdown, editRecord, editorMode, exportMarkdown, removeNote]);
  const nodeEditorNote = useMemo(
    () => (nodeEditor.noteId ? api.notes.find((note) => note.id === nodeEditor.noteId) ?? null : null),
    [api.notes, nodeEditor.noteId],
  );

  const handleNodeSave = useCallback(
    (values: NodeEditorValues) => {
      if (nodeEditorNote) {
        api.updateNote(nodeEditorNote.id, { title: values.title, kind: values.kind, meta: values.meta });
        const before = new Set(nodeEditorNote.manualLinks);
        const after = new Set(values.manualLinks);
        for (const id of after) if (!before.has(id)) api.addManualLink(nodeEditorNote.id, id);
        for (const id of before) if (!after.has(id)) api.removeManualLink(nodeEditorNote.id, id);
        notify('已更新记录');
      } else {
        void api
          .createNote({ title: values.title, kind: values.kind, meta: values.meta, position: nodeEditor.position })
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

  /* ---------------- Apple Health import ---------------- */

  const applyHealthDrafts = useCallback(
    async (drafts: ReturnType<typeof healthSamplesToNotes>): Promise<number> => {
      let count = 0;
      for (const draft of drafts) {
        if (draft.replaceId) {
          api.updateNote(draft.replaceId, {
            title: draft.title,
            content: draft.content,
            kind: 'health',
            meta: draft.meta,
          });
        } else {
          await api.createNote({
            title: draft.title,
            content: draft.content,
            kind: 'health',
            meta: draft.meta,
          });
        }
        count += 1;
      }
      return count;
    },
    [api],
  );

  const importHealthText = useCallback(
    async (text: string): Promise<number> => {
      const parsed = text.trim().startsWith('{') || text.trim().startsWith('[')
        ? parseHealthJson(text)
        : parseHealthCsv(text);
      if (parsed.samples.length === 0) {
        notify('没有解析到健康数据，请检查 JSON/CSV 格式');
        return 0;
      }
      const drafts = healthSamplesToNotes(parsed.samples, api.notes);
      const count = await applyHealthDrafts(drafts);
      notify(`已从 Apple 健康导入 ${count} 条记录`);
      return count;
    },
    [api.notes, applyHealthDrafts, notify],
  );

  // One-shot URL import for Shortcuts: ?health=<base64|json> (hash kept local too).
  useEffect(() => {
    if (!api.ready || healthImportStarted.current) return;
    const search = new URLSearchParams(window.location.search);
    const payload = search.get('health');
    if (!payload) return;
    healthImportStarted.current = true;
    try {
      const parsed = decodeHealthPayload(payload);
      if (parsed.samples.length === 0) {
        notify('健康数据解析失败，请检查链接');
      } else {
        const drafts = healthSamplesToNotes(parsed.samples, api.notes);
        void applyHealthDrafts(drafts).then((count) => notify(`已从 Apple 健康导入 ${count} 条记录`));
      }
    } catch {
      notify('健康数据解析失败，请检查链接');
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('health');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [api.notes, api.ready, applyHealthDrafts, notify]);

  const brief = useMemo(() => buildDailyBrief(api.notes), [api.notes]);
  const range = useMemo(() => summarizeRange(api.notes, 7), [api.notes]);

  if (!api.ready) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <p>正在整理记录…</p>
      </div>
    );
  }

  const activeTab: TabName =
    route.name === 'note' || route.name === 'search'
      ? returnToRef.current
      : route.name;

  const renderTabScreen = () => {
    switch (route.name) {
      case 'records':
        return (
          <RecordsScreen
            notes={api.sortedNotes}
            loading={false}
            kindFilter={kindFilter}
            onKindFilter={setKindFilter}
            onOpenNote={openNote}
            onNoteMenu={setNoteMenu}
            onOpenSearch={() => navigate({ name: 'search' })}
            onQuickCapture={openCapture}
            storageWarning={api.storageWarning}
          />
        );
      case 'graph':
        return (
          <div className={`screen graph-screen${graphFullscreen ? ' is-fullscreen' : ''}`}>
            <div className="graph-host">
              <GraphView
                notes={api.notes}
                activeNoteId={null}
                selectedNoteId={graphSelectedId}
                onSelectNote={setGraphSelectedId}
                onOpenNote={openNote}
                onMoveNote={(id, position) => api.setNodePosition(id, position)}
                onCreateNoteAt={(position) => setNodeEditor({ open: true, noteId: null, position })}
                onDeleteNote={(id) => {
                  void api.deleteNote(id);
                  setGraphSelectedId(null);
                }}
                onLinkNotes={(sourceId, targetId) => {
                  api.addManualLink(sourceId, targetId);
                  notify('已连线');
                }}
                onRequestResetLayout={() => {
                  api.resetNodePositions();
                  setGraphSelectedId(null);
                  notify('已恢复自动布局');
                }}
                fullscreen={graphFullscreen}
                onToggleFullscreen={() => setGraphFullscreen((value) => !value)}
              />
            </div>
          </div>
        );
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
      case 'search':
        return (
          <SearchScreen
            notes={api.sortedNotes}
            onOpenNote={openNote}
            onClose={() => navigate({ name: 'records' })}
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
            onImportHealth={importHealthText}
          />
        );
      case 'today':
      default:
        return (
          <TodayScreen
            notes={api.sortedNotes}
            brief={brief}
            range={range}
            onOpenNote={openNote}
            onQuickCapture={openCapture}
            onOpenRecords={() => navigate({ name: 'records' })}
            onOpenAgent={() => navigate({ name: 'agent' })}
            onOpenSearch={() => navigate({ name: 'search' })}
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
          mode={editorMode}
          onModeChange={setEditorMode}
          onChange={(patch) => api.updateNote(activeNote.id, patch)}
          onBack={goBack}
          onMenu={() => setEditorMenuOpen(true)}
          onOpenNote={openNote}
          onCreateNote={(title) => void openOrCreateByTitle(title)}
          onEditRecord={() => editRecord(activeNote)}
          storageWarning={api.storageWarning}
        />
      ) : (
        <>
          <main className={`app-main${graphFullscreen && route.name === 'graph' ? ' is-immersive' : ''}`}>
            {renderTabScreen()}
          </main>
          {graphFullscreen && route.name === 'graph' ? null : (
            <TabBar active={activeTab} onChange={(tab) => navigate({ name: tab })} />
          )}
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
                void removeNote(nodeEditorNote).then(() => setNodeEditor({ open: false, noteId: null }));
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
