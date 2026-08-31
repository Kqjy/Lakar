import { create } from "zustand";
import type {
  CollabState,
  FolderMeta,
  ItemDefaults,
  SatchelItem,
  SceneMeta,
  SessionUser,
  SyncStatus,
  LockedAccount,
  Theme,
  ToolType,
  LakarElement,
  Viewport,
} from "./types";
import {
  DEFAULT_CANVAS_BG,
  DEFAULT_ITEM,
  LOCAL_UI_KEY,
  MAX_ZOOM,
  MIN_ZOOM,
} from "./constants";
import { clamp } from "./math";

export type DialogKind =
  | null
  | "export"
  | "help"
  | "auth"
  | "scenes"
  | "clear-confirm"
  | "account"
  | "share"
  | "publish"
  | "mermaid"
  | "join"
  | "keep-collab-copy"
  | "leave-live-confirm"
  | "unlock"
  | "recovery-code"
  | "recover"
  | "change-password";

export type PaletteMode = null | "command" | "search";

export interface ContextMenuState {
  x: number;
  y: number;
  
  onCanvas: boolean;
}

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "success" | "error";
}

export interface StorageUsage {
  sceneBytes: number;
  quotaBytes: number | null;
}

interface UIPrefs {
  theme: Theme;
  toolLocked: boolean;
  displayName: string;
  snapEnabled: boolean;
  gridSize: number | null;
}

const ANON_NAMES = [
  "Kingfisher", "Otter", "Heron", "Marten", "Lynx", "Falcon",
  "Wombat", "Ibis", "Pangolin", "Tanager", "Vireo", "Serval",
];

const randomDisplayName = () =>
  ANON_NAMES[Math.floor(Math.random() * ANON_NAMES.length)];

const loadUIPrefs = (): UIPrefs => {
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const fallback: UIPrefs = {
    theme: prefersDark ? "dark" : "light",
    toolLocked: false,
    displayName: randomDisplayName(),
    snapEnabled: true,
    gridSize: null,
  };
  try {
    const raw = localStorage.getItem(LOCAL_UI_KEY);
    const stored = raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
    if (!stored.displayName) stored.displayName = fallback.displayName;
    localStorage.setItem(LOCAL_UI_KEY, JSON.stringify(stored));
    return stored;
  } catch {

  }
  return fallback;
};

const saveUIPrefs = (p: UIPrefs) => {
  try {
    localStorage.setItem(LOCAL_UI_KEY, JSON.stringify(p));
  } catch {

  }
};

export const IDLE_COLLAB: CollabState = {
  status: "idle",
  roomId: null,
  mode: "link",
  isHost: false,
  peers: [],
  shareLink: null,
};

export interface AppStore {

  elements: LakarElement[];
  sceneNonce: number;
  selectedIds: ReadonlySet<string>;

  activeTool: ToolType;
  toolLocked: boolean;
  snapEnabled: boolean;
  gridSize: number | null;
  editingTextId: string | null;
  
  pendingEraseIds: ReadonlySet<string>;

  viewport: Viewport;
  theme: Theme;
  canvasBg: string;
  itemDefaults: ItemDefaults;

  sceneId: string | null;
  sceneTitle: string;

  user: SessionUser | null;
  lockedAccount: LockedAccount | null;
  pendingRecoveryCode: string | null;
  pendingInviteCode: string | null;
  syncStatus: SyncStatus;
  storage: StorageUsage | null;
  scenes: SceneMeta[];
  folders: FolderMeta[];

  collab: CollabState;
  displayName: string;
  pendingRoomId: string | null;

  satchelOpen: boolean;
  satchelItems: SatchelItem[];

  dialog: DialogKind;
  palette: PaletteMode;
  linkEditorId: string | null;
  contextMenu: ContextMenuState | null;
  toasts: Toast[];
  zenMode: boolean;
  presenting: boolean;
  presentIndex: number;
  viewerMode: boolean;
  viewerLoadFailed: boolean;

  setCollab: (patch: Partial<CollabState>) => void;
  setDisplayName: (name: string) => void;
  setPendingRoomId: (id: string | null) => void;
  setSatchelOpen: (open: boolean) => void;
  setSatchelItems: (items: SatchelItem[]) => void;

  bumpScene: () => void;
  replaceElements: (els: LakarElement[]) => void;
  setSelectedIds: (ids: Iterable<string>) => void;
  clearSelection: () => void;
  setTool: (tool: ToolType) => void;
  setToolLocked: (locked: boolean) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setGridSize: (size: number | null) => void;
  setEditingText: (id: string | null) => void;
  setPendingErase: (ids: Iterable<string>) => void;
  setViewport: (vp: Partial<Viewport>) => void;
  zoomAt: (
    nextZoom: number,
    clientX: number,
    clientY: number,
  ) => void;
  setTheme: (t: Theme) => void;
  setCanvasBg: (c: string) => void;
  setItemDefaults: (d: Partial<ItemDefaults>) => void;
  setScene: (id: string | null, title: string) => void;
  setSceneTitle: (title: string) => void;
  setUser: (u: SessionUser | null) => void;
  setLockedAccount: (a: LockedAccount | null) => void;
  setPendingRecoveryCode: (c: string | null) => void;
  setPendingInviteCode: (c: string | null) => void;
  setSyncStatus: (s: SyncStatus) => void;
  setStorage: (u: StorageUsage | null) => void;
  setScenes: (s: SceneMeta[]) => void;
  setFolders: (f: FolderMeta[]) => void;
  setDialog: (d: DialogKind) => void;
  setPalette: (p: PaletteMode) => void;
  setLinkEditorId: (id: string | null) => void;
  setContextMenu: (c: ContextMenuState | null) => void;
  toast: (message: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
  setZenMode: (z: boolean) => void;
  setPresenting: (p: boolean) => void;
  setPresentIndex: (i: number) => void;
  setViewerMode: (v: boolean) => void;
  setViewerLoadFailed: (v: boolean) => void;
}

const prefs = loadUIPrefs();
let toastId = 0;

const persistPrefs = (s: AppStore) =>
  saveUIPrefs({
    theme: s.theme,
    toolLocked: s.toolLocked,
    displayName: s.displayName,
    snapEnabled: s.snapEnabled,
    gridSize: s.gridSize,
  });

export const useStore = create<AppStore>((set, get) => ({
  elements: [],
  sceneNonce: 0,
  selectedIds: new Set<string>(),

  activeTool: "selection",
  toolLocked: prefs.toolLocked,
  snapEnabled: prefs.snapEnabled,
  gridSize: prefs.gridSize,
  editingTextId: null,
  pendingEraseIds: new Set<string>(),

  viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
  theme: prefs.theme,
  canvasBg: DEFAULT_CANVAS_BG,
  itemDefaults: { ...DEFAULT_ITEM },

  sceneId: null,
  sceneTitle: "Untitled scene",

  user: null,
  lockedAccount: null,
  pendingRecoveryCode: null,
  pendingInviteCode: null,
  syncStatus: "offline-guest",
  storage: null,
  scenes: [],
  folders: [],

  collab: IDLE_COLLAB,
  displayName: prefs.displayName,
  pendingRoomId: null,

  satchelOpen: false,
  satchelItems: [],

  dialog: null,
  palette: null,
  linkEditorId: null,
  contextMenu: null,
  toasts: [],
  zenMode: false,
  presenting: false,
  presentIndex: 0,
  viewerMode: false,
  viewerLoadFailed: false,

  setCollab: (patch) => set((s) => ({ collab: { ...s.collab, ...patch } })),
  setDisplayName: (displayName) => {
    set({ displayName });
    persistPrefs(get());
  },
  setPendingRoomId: (pendingRoomId) => set({ pendingRoomId }),
  setSatchelOpen: (satchelOpen) => set({ satchelOpen }),
  setSatchelItems: (satchelItems) => set({ satchelItems }),

  bumpScene: () => set((s) => ({ sceneNonce: s.sceneNonce + 1 })),
  replaceElements: (els) =>
    set((s) => ({ elements: els, sceneNonce: s.sceneNonce + 1 })),
  setSelectedIds: (ids) => set({ selectedIds: new Set(ids) }),
  clearSelection: () => set({ selectedIds: new Set() }),
  setTool: (tool) =>
    set((s) => ({
      activeTool: tool,
      selectedIds:
        tool === "selection" || tool === "hand" ? s.selectedIds : new Set(),
      contextMenu: null,
    })),
  setToolLocked: (locked) => {
    set({ toolLocked: locked });
    persistPrefs(get());
  },
  setSnapEnabled: (snapEnabled) => {
    set({ snapEnabled });
    persistPrefs(get());
  },
  setGridSize: (gridSize) => {
    set({ gridSize });
    persistPrefs(get());
  },
  setEditingText: (id) => set({ editingTextId: id }),
  setPendingErase: (ids) => set({ pendingEraseIds: new Set(ids) }),
  setViewport: (vp) =>
    set((s) => ({ viewport: { ...s.viewport, ...vp } })),
  zoomAt: (nextZoom, clientX, clientY) => {
    const { viewport } = get();
    const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (zoom === viewport.zoom) return;

    const sceneX = viewport.scrollX + clientX / viewport.zoom;
    const sceneY = viewport.scrollY + clientY / viewport.zoom;
    set({
      viewport: {
        zoom,
        scrollX: sceneX - clientX / zoom,
        scrollY: sceneY - clientY / zoom,
      },
    });
  },
  setTheme: (t) => {
    set({ theme: t });
    persistPrefs(get());
  },
  setCanvasBg: (c) => set({ canvasBg: c }),
  setItemDefaults: (d) =>
    set((s) => ({ itemDefaults: { ...s.itemDefaults, ...d } })),
  setScene: (id, title) => set({ sceneId: id, sceneTitle: title }),
  setSceneTitle: (title) => set({ sceneTitle: title }),
  setUser: (u) => set({ user: u }),
  setLockedAccount: (lockedAccount) => set({ lockedAccount }),
  setPendingRecoveryCode: (pendingRecoveryCode) => set({ pendingRecoveryCode }),
  setPendingInviteCode: (pendingInviteCode) => set({ pendingInviteCode }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setStorage: (storage) => set({ storage }),
  setScenes: (scenes) => set({ scenes }),
  setFolders: (folders) => set({ folders }),
  setDialog: (dialog) => set({ dialog, contextMenu: null, palette: null }),
  setPalette: (palette) => set({ palette, contextMenu: null }),
  setLinkEditorId: (linkEditorId) => set({ linkEditorId, contextMenu: null }),
  setContextMenu: (contextMenu) => set({ contextMenu }),
  toast: (message, kind = "info") => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    window.setTimeout(() => get().dismissToast(id), 4200);
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setZenMode: (zenMode) => set({ zenMode }),
  setPresenting: (presenting) =>
    set({
      presenting,
      contextMenu: null,
      palette: null,
      linkEditorId: null,
      presentIndex: presenting ? 0 : 0,
    }),
  setPresentIndex: (presentIndex) => set({ presentIndex }),
  setViewerMode: (viewerMode) => set({ viewerMode }),
  setViewerLoadFailed: (viewerLoadFailed) => set({ viewerLoadFailed }),
}));

export const getVisibleElements = () =>
  useStore.getState().elements.filter((el) => !el.isDeleted);

export const getSelectedElements = () => {
  const { elements, selectedIds } = useStore.getState();
  return elements.filter((el) => !el.isDeleted && selectedIds.has(el.id));
};
