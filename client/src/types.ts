export type ToolType =
  | "selection"
  | "hand"
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "arrow"
  | "line"
  | "freedraw"
  | "text"
  | "frame"
  | "laser"
  | "bucket"
  | "eraser";

export type ElementType =
  | Exclude<ToolType, "selection" | "hand" | "eraser" | "laser" | "bucket">
  | "image";

export type FillStyle = "hachure" | "cross-hatch" | "solid";
export type StrokeStyle = "solid" | "dashed" | "dotted";
export type Arrowhead = "none" | "arrow" | "bar" | "dot";
export type FontFamily = "hand" | "normal" | "code";
export type TextAlign = "left" | "center" | "right";
export type Theme = "light" | "dark";

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  
  roughness: number;
  opacity: number;
  
  roundEdges: boolean;
  seed: number;
  
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  deletedAt?: number;
  groupIds: string[];
  frameId?: string | null;
  link?: string | null;
  locked: boolean;
}

export interface RectangleElement extends BaseElement {
  type: "rectangle";
}
export interface DiamondElement extends BaseElement {
  type: "diamond";
}
export interface EllipseElement extends BaseElement {
  type: "ellipse";
}

export interface PointBinding {
  elementId: string;

  fx: number;
  fy: number;
  gap: number;
}

export interface LinearElement extends BaseElement {
  type: "line" | "arrow";
  points: [number, number][];
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
  startBinding: PointBinding | null;
  endBinding: PointBinding | null;
}

export interface FreedrawElement extends BaseElement {
  type: "freedraw";
  points: [number, number][];
  pressures: number[];
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily: FontFamily;
  textAlign: TextAlign;
  lineHeight: number;
  containerId: string | null;
  originalText?: string;
}

export interface ImageElement extends BaseElement {
  type: "image";
  dataURL: string;
}

export interface FrameElement extends BaseElement {
  type: "frame";
  name: string;
}

export type ContainerElement =
  | RectangleElement
  | DiamondElement
  | EllipseElement;

export type BindableElement =
  | RectangleElement
  | DiamondElement
  | EllipseElement
  | ImageElement
  | TextElement;

export type LakarElement =
  | RectangleElement
  | DiamondElement
  | EllipseElement
  | LinearElement
  | FreedrawElement
  | TextElement
  | ImageElement
  | FrameElement;

export type LinearLike = LinearElement | FreedrawElement;

export const isLinearLike = (el: LakarElement): el is LinearLike =>
  el.type === "line" || el.type === "arrow" || el.type === "freedraw";

export const isTextElement = (el: LakarElement): el is TextElement =>
  el.type === "text";

export const isImageElement = (el: LakarElement): el is ImageElement =>
  el.type === "image";

export const isFrameElement = (el: LakarElement): el is FrameElement =>
  el.type === "frame";

export const isContainerElement = (
  el: LakarElement,
): el is ContainerElement =>
  el.type === "rectangle" || el.type === "diamond" || el.type === "ellipse";

export const isBoundText = (el: LakarElement): el is TextElement =>
  el.type === "text" && el.containerId != null;

export const isArrowElement = (el: LakarElement): el is LinearElement =>
  el.type === "arrow";

export const isBindableElement = (el: LakarElement): el is BindableElement =>
  el.type === "rectangle" ||
  el.type === "diamond" ||
  el.type === "ellipse" ||
  el.type === "image" ||
  (el.type === "text" && el.containerId == null);

export interface ItemDefaults {
  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: number;
  opacity: number;
  roundEdges: boolean;
  fontSize: number;
  fontFamily: FontFamily;
  textAlign: TextAlign;
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
}

export interface Viewport {
  
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export interface SceneMeta {
  id: string;
  title: string;
  folderId: string | null;
  
  updatedAt: number;
  createdAt: number;
  
  remoteVersion: number;
  
  dirty: boolean;
}

export interface FolderMeta {
  id: string;
  name: string;
  color: string | null;
  createdAt: number;
}

export type SyncStatus =
  | "offline-guest"
  | "syncing"
  | "synced"
  | "offline"
  | "conflict"
  | "locked"
  | "error";

export interface LockedAccount {
  email: string;
  hadLegacyKey: boolean;
}

export interface SessionUser {
  email: string;
  token: string;
}

export interface Point {
  x: number;
  y: number;
}

export type RoomMode = "link" | "password";

export type CollabStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "ended";

export interface CollabPeer {
  id: string;
  name: string;
  color: string;
  isSelf: boolean;
  joinedAt: number;
  away: boolean;
}

export interface PeerPointer {
  id: string;
  x: number;
  y: number;
  color: string;
  name: string;
  tool: ToolType;
  selectedIds: string[];
  updatedAt: number;
  away: boolean;
}

export interface RoomResume {
  roomId: string;
  secret: string | null;
  mode: RoomMode;
  ownerToken: string | null;
  title: string;
  leftAt: number;
}

export interface CollabState {
  status: CollabStatus;
  roomId: string | null;
  mode: RoomMode;
  isHost: boolean;
  peers: CollabPeer[];
  shareLink: string | null;
}

export interface SatchelItem {
  id: string;
  name: string;
  category: string;
  keywords: string[];
  elements: LakarElement[];
  mine: boolean;
  createdAt: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
