import { useEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Copy,
  Group,
  Lock,
  Trash2,
  Ungroup,
} from "lucide-react";
import { getSelectedElements, useStore } from "../store";
import type { ItemDefaults, Theme, ToolType, LakarElement } from "../types";
import {
  BACKGROUND_COLORS,
  BACKGROUND_SHADES,
  STROKE_COLORS,
  STROKE_SHADES,
} from "../constants";
import {
  alignSelected,
  applyStyleToSelection,
  deleteSelected,
  distributeSelected,
  duplicateSelected,
  groupSelected,
  reorderSelected,
  toggleLockSelected,
  ungroupSelected,
} from "../interaction/actions";
import { history } from "../history";
import { hexToHsv, hsvToHex, themedColor, type HSV } from "../colors";

type PropKey = keyof ItemDefaults;

const TYPE_FOR_TOOL: Partial<Record<ToolType, string>> = {
  rectangle: "rectangle",
  diamond: "diamond",
  ellipse: "ellipse",
  arrow: "arrow",
  line: "line",
  freedraw: "freedraw",
  text: "text",
};

export const PropertiesPanel = () => {
  const activeTool = useStore((s) => s.activeTool);
  const selectedIds = useStore((s) => s.selectedIds);
  const sceneNonce = useStore((s) => s.sceneNonce);
  const itemDefaults = useStore((s) => s.itemDefaults);
  const setItemDefaults = useStore((s) => s.setItemDefaults);

  const selected = getSelectedElements();
  const hasSelection = selected.length > 0 && activeTool === "selection";
  const toolType = TYPE_FOR_TOOL[activeTool];

  if (!hasSelection && !toolType) return null;

  const types = new Set(
    hasSelection ? selected.map((el) => el.type) : [toolType!],
  );
  const has = (...ts: string[]) => ts.some((t) => types.has(t));

  const value = <K extends PropKey>(key: K): ItemDefaults[K] => {
    if (hasSelection) {
      for (const el of selected) {
        if (key in el) return (el as unknown as ItemDefaults)[key];
      }
    }
    return itemDefaults[key];
  };

  const apply = (updates: Partial<ItemDefaults>) => {
    setItemDefaults(updates);
    if (hasSelection) {
      applyStyleToSelection(updates as Partial<LakarElement>);
      history.commit();
    }
  };

  const applyLive = (updates: Partial<ItemDefaults>) => {
    setItemDefaults(updates);
    if (hasSelection) applyStyleToSelection(updates as Partial<LakarElement>);
  };

  const showStroke = has(
    "rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text",
  );
  const showBackground = has("rectangle", "diamond", "ellipse", "line");
  const showFill =
    showBackground && value("backgroundColor") !== "transparent";
  const showStrokeWidth = has(
    "rectangle", "diamond", "ellipse", "arrow", "line", "freedraw",
  );
  const showStrokeStyle = has("rectangle", "diamond", "ellipse", "arrow", "line");
  const showRoughness = has("rectangle", "diamond", "ellipse", "arrow", "line");
  const showEdges = has("rectangle", "diamond", "line", "arrow");
  const showArrowheads = has("arrow");
  const showText = has("text");

  return (
    <div className="island props-panel" onPointerDown={(e) => e.stopPropagation()}>
      {showStroke && (
        <Section label="Stroke">
          <ColorRow
            colors={STROKE_COLORS}
            shades={STROKE_SHADES}
            current={value("strokeColor")}
            allowTransparent={false}
            onPick={(c) => apply({ strokeColor: c })}
            onLive={(c) => applyLive({ strokeColor: c })}
          />
        </Section>
      )}
      {showBackground && (
        <Section label="Background">
          <ColorRow
            colors={BACKGROUND_COLORS}
            shades={BACKGROUND_SHADES}
            current={value("backgroundColor")}
            allowTransparent
            onPick={(c) => apply({ backgroundColor: c })}
            onLive={(c) => applyLive({ backgroundColor: c })}
          />
        </Section>
      )}
      {showFill && (
        <Section label="Fill">
          <Seg
            options={[
              { key: "hachure", icon: <HachureIcon />, label: "Hachure" },
              { key: "cross-hatch", icon: <CrossHatchIcon />, label: "Cross-hatch" },
              { key: "solid", icon: <SolidIcon />, label: "Solid" },
            ]}
            current={value("fillStyle")}
            onPick={(v) => apply({ fillStyle: v as ItemDefaults["fillStyle"] })}
          />
        </Section>
      )}
      {showStrokeWidth && (
        <Section label="Stroke width">
          <Seg
            options={[
              { key: "1", icon: <WidthIcon w={1.2} />, label: "Thin" },
              { key: "2", icon: <WidthIcon w={2.4} />, label: "Bold" },
              { key: "4", icon: <WidthIcon w={4} />, label: "Extra bold" },
            ]}
            current={String(value("strokeWidth"))}
            onPick={(v) => apply({ strokeWidth: Number(v) })}
          />
        </Section>
      )}
      {showStrokeStyle && (
        <Section label="Stroke style">
          <Seg
            options={[
              { key: "solid", icon: <StrokeSolidIcon />, label: "Solid" },
              { key: "dashed", icon: <StrokeDashedIcon />, label: "Dashed" },
              { key: "dotted", icon: <StrokeDottedIcon />, label: "Dotted" },
            ]}
            current={value("strokeStyle")}
            onPick={(v) => apply({ strokeStyle: v as ItemDefaults["strokeStyle"] })}
          />
        </Section>
      )}
      {showRoughness && (
        <Section label="Sloppiness">
          <Seg
            options={[
              { key: "0", icon: <SloppyIcon level={0} />, label: "Architect" },
              { key: "1", icon: <SloppyIcon level={1} />, label: "Artist" },
              { key: "2", icon: <SloppyIcon level={2} />, label: "Cartoonist" },
            ]}
            current={String(value("roughness"))}
            onPick={(v) => apply({ roughness: Number(v) })}
          />
        </Section>
      )}
      {showEdges && (
        <Section label="Edges">
          <Seg
            options={[
              { key: "sharp", icon: <SharpIcon />, label: "Sharp" },
              { key: "round", icon: <RoundIcon />, label: "Round" },
            ]}
            current={value("roundEdges") ? "round" : "sharp"}
            onPick={(v) => apply({ roundEdges: v === "round" })}
          />
        </Section>
      )}
      {showArrowheads && (
        <Section label="Arrowheads">
          <div style={{ display: "flex", gap: 4 }}>
            <Seg
              options={[
                { key: "none", icon: <StrokeSolidIcon />, label: "Start: none" },
                { key: "arrow", icon: <HeadArrowIcon flip />, label: "Start: arrow" },
                { key: "bar", icon: <HeadBarIcon flip />, label: "Start: bar" },
                { key: "dot", icon: <HeadDotIcon flip />, label: "Start: dot" },
              ]}
              current={value("startArrowhead")}
              onPick={(v) =>
                apply({ startArrowhead: v as ItemDefaults["startArrowhead"] })
              }
            />
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
            <Seg
              options={[
                { key: "none", icon: <StrokeSolidIcon />, label: "End: none" },
                { key: "arrow", icon: <HeadArrowIcon />, label: "End: arrow" },
                { key: "bar", icon: <HeadBarIcon />, label: "End: bar" },
                { key: "dot", icon: <HeadDotIcon />, label: "End: dot" },
              ]}
              current={value("endArrowhead")}
              onPick={(v) =>
                apply({ endArrowhead: v as ItemDefaults["endArrowhead"] })
              }
            />
          </div>
        </Section>
      )}
      {showText && (
        <>
          <Section label="Font family">
            <Seg
              options={[
                { key: "hand", icon: <span style={{ fontFamily: "Kalam", fontSize: 15 }}>A</span>, label: "Hand-drawn" },
                { key: "normal", icon: <span style={{ fontSize: 14 }}>A</span>, label: "Normal" },
                { key: "code", icon: <span style={{ fontFamily: "monospace", fontSize: 13 }}>A</span>, label: "Code" },
              ]}
              current={value("fontFamily")}
              onPick={(v) => apply({ fontFamily: v as ItemDefaults["fontFamily"] })}
            />
          </Section>
          <Section label="Font size">
            <Seg
              options={[
                { key: "16", icon: <span style={{ fontSize: 11 }}>S</span>, label: "Small" },
                { key: "20", icon: <span style={{ fontSize: 13 }}>M</span>, label: "Medium" },
                { key: "28", icon: <span style={{ fontSize: 15 }}>L</span>, label: "Large" },
                { key: "36", icon: <span style={{ fontSize: 17 }}>XL</span>, label: "Extra large" },
              ]}
              current={String(value("fontSize"))}
              onPick={(v) => apply({ fontSize: Number(v) })}
            />
          </Section>
          <Section label="Text align">
            <Seg
              options={[
                { key: "left", icon: <AlignLeft size={15} />, label: "Left" },
                { key: "center", icon: <AlignCenter size={15} />, label: "Center" },
                { key: "right", icon: <AlignRight size={15} />, label: "Right" },
              ]}
              current={value("textAlign")}
              onPick={(v) => apply({ textAlign: v as ItemDefaults["textAlign"] })}
            />
          </Section>
        </>
      )}
      <Section label={`Opacity — ${value("opacity")}%`}>
        <input
          type="range"
          className="opacity-slider"
          min={10}
          max={100}
          step={10}
          value={value("opacity")}
          onChange={(e) => {
            const opacity = Number(e.target.value);
            useStore.getState().setItemDefaults({ opacity });
            if (hasSelection) applyStyleToSelection({ opacity });
          }}
          onPointerUp={() => hasSelection && history.commit()}
          aria-label="Opacity"
        />
      </Section>
      {selected.length > 1 && (
        <Section label="Align">
          <div className="seg-row">
            <button className="seg-btn" title="Align left" onClick={() => alignSelected("left")}>
              <AlignStartVertical size={15} />
            </button>
            <button className="seg-btn" title="Align centres horizontally" onClick={() => alignSelected("center-h")}>
              <AlignCenterVertical size={15} />
            </button>
            <button className="seg-btn" title="Align right" onClick={() => alignSelected("right")}>
              <AlignEndVertical size={15} />
            </button>
            <button
              className="seg-btn"
              title="Distribute horizontally"
              onClick={() => distributeSelected("h")}
              disabled={selected.length < 3}
            >
              <AlignHorizontalDistributeCenter size={15} />
            </button>
          </div>
          <div className="seg-row">
            <button className="seg-btn" title="Align top" onClick={() => alignSelected("top")}>
              <AlignStartHorizontal size={15} />
            </button>
            <button className="seg-btn" title="Align centres vertically" onClick={() => alignSelected("center-v")}>
              <AlignCenterHorizontal size={15} />
            </button>
            <button className="seg-btn" title="Align bottom" onClick={() => alignSelected("bottom")}>
              <AlignEndHorizontal size={15} />
            </button>
            <button
              className="seg-btn"
              title="Distribute vertically"
              onClick={() => distributeSelected("v")}
              disabled={selected.length < 3}
            >
              <AlignVerticalDistributeCenter size={15} />
            </button>
          </div>
        </Section>
      )}
      {hasSelection && (
        <>
          <Section label="Layers">
            <div className="seg-row">
              <button className="seg-btn" title="Send to back" onClick={() => reorderSelected("toBack")}>
                <ArrowDownToLine size={15} />
              </button>
              <button className="seg-btn" title="Send backward" onClick={() => reorderSelected("backward")}>
                <ChevronDown size={15} />
              </button>
              <button className="seg-btn" title="Bring forward" onClick={() => reorderSelected("forward")}>
                <ChevronUp size={15} />
              </button>
              <button className="seg-btn" title="Bring to front" onClick={() => reorderSelected("toFront")}>
                <ArrowUpToLine size={15} />
              </button>
            </div>
          </Section>
          <Section label="Actions">
            <div className="seg-row">
              <button className="seg-btn" title="Duplicate — Ctrl+D" onClick={() => duplicateSelected()}>
                <Copy size={15} />
              </button>
              <button
                className="seg-btn"
                title={selected.length > 1 ? "Group — Ctrl+G" : "Ungroup — Ctrl+Shift+G"}
                onClick={() =>
                  selected.length > 1 ? groupSelected() : ungroupSelected()
                }
                disabled={selected.length < 2 && !selected.some((el) => el.groupIds.length)}
              >
                {selected.length > 1 && !allSameGroup(selected) ? (
                  <Group size={15} />
                ) : (
                  <Ungroup size={15} />
                )}
              </button>
              <button className="seg-btn" title="Lock" onClick={toggleLockSelected}>
                <Lock size={15} />
              </button>
              <button
                className="seg-btn"
                title="Delete — Del"
                onClick={deleteSelected}
                style={{ color: "var(--danger)" }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </Section>
        </>
      )}
    </div>
  );
};

const allSameGroup = (els: LakarElement[]) => {
  if (els.length < 2) return false;
  const g = els[0].groupIds[els[0].groupIds.length - 1];
  if (!g) return false;
  return els.every((el) => el.groupIds.includes(g));
};

const Section = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div className="prop-section">
    <div className="prop-label">{label}</div>
    {children}
  </div>
);

const Seg = ({
  options,
  current,
  onPick,
}: {
  options: { key: string; icon: React.ReactNode; label: string }[];
  current: string;
  onPick: (key: string) => void;
}) => (
  <div className="seg-row" style={{ flex: 1 }}>
    {options.map((o) => (
      <button
        key={o.key}
        className={`seg-btn ${current === o.key ? "active" : ""}`}
        title={o.label}
        aria-pressed={current === o.key}
        onClick={() => onPick(o.key)}
      >
        {o.icon}
      </button>
    ))}
  </div>
);

const ColorRow = ({
  colors,
  shades,
  current,
  allowTransparent,
  onPick,
  onLive,
}: {
  colors: readonly string[];
  shades: readonly string[];
  current: string;
  allowTransparent: boolean;
  onPick: (c: string) => void;
  onLive: (c: string) => void;
}) => {
  const theme = useStore((s) => s.theme);
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(current);
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(current) ?? { h: 174, s: 0.8, v: 0.5 });
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    setHex(current);
    if (!draggingRef.current) {
      const parsed = hexToHsv(current);
      if (parsed) setHsv(parsed);
    }
  }, [current]);

  const toggleOpen = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) {
      setPopPos({
        left: Math.min(rect.right + 14, window.innerWidth - 216),
        top: Math.max(8, Math.min(rect.top - 4, window.innerHeight - 430)),
      });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const commitHex = () => {
    let v = hex.trim();
    if (v === "" && allowTransparent) {
      onPick("transparent");
      return;
    }
    if (!v.startsWith("#")) v = `#${v}`;
    if (/^#[0-9a-fA-F]{3}$/.test(v) || /^#[0-9a-fA-F]{6}$/.test(v)) {
      onPick(v.toLowerCase());
    } else {
      setHex(current);
    }
  };

  const dragPicker = (
    e: React.PointerEvent,
    update: (nx: number, ny: number) => HSV,
  ) => {
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    draggingRef.current = true;
    const applyAt = (clientX: number, clientY: number, final: boolean) => {
      const nx = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const ny = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
      const next = update(nx, ny);
      setHsv(next);
      const c = hsvToHex(next);
      setHex(c);
      if (final) onPick(c);
      else onLive(c);
    };
    target.setPointerCapture(e.pointerId);
    applyAt(e.clientX, e.clientY, false);
    const onMove = (ev: PointerEvent) => applyAt(ev.clientX, ev.clientY, false);
    const onUp = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      draggingRef.current = false;
      applyAt(ev.clientX, ev.clientY, true);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  const shown = colors.includes(current);

  return (
    <div className="color-pop-anchor" ref={anchorRef}>
      <div className="swatch-row">
        {colors.map((c) => (
          <Swatch
            key={c}
            color={c}
            theme={theme}
            selected={current === c}
            onPick={onPick}
          />
        ))}
        <button
          className={`swatch ${shown ? "" : "selected"}`}
          style={{
            background:
              current === "transparent"
                ? undefined
                : shown
                  ? "conic-gradient(#c94040, #c77b1e, #3a7d44, #3563c9, #c94040)"
                  : themedColor(current, theme),
          }}
          title="More colors"
          onClick={toggleOpen}
          aria-label="More colors"
        />
      </div>
      {open && (
        <div
          className="color-pop"
          ref={popRef}
          style={popPos ? { position: "fixed", left: popPos.left, top: popPos.top } : undefined}
        >
          <div
            className="sv-area"
            ref={svRef}
            style={{
              background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))`,
            }}
            onPointerDown={(e) =>
              dragPicker(e, (nx, ny) => ({ ...hsv, s: nx, v: 1 - ny }))
            }
          >
            <div
              className="sv-handle"
              style={{
                left: `${hsv.s * 100}%`,
                top: `${(1 - hsv.v) * 100}%`,
                background: themedColor(hsvToHex(hsv), theme),
              }}
            />
          </div>
          <div
            className="hue-bar"
            ref={hueRef}
            onPointerDown={(e) =>
              dragPicker(e, (nx) => ({ ...hsv, h: Math.min(359.9, nx * 360) }))
            }
          >
            <div className="hue-handle" style={{ left: `${(hsv.h / 360) * 100}%` }} />
          </div>
          <div className="color-grid">
            {shades.map(
              (c) =>
                (c !== "transparent" || allowTransparent) && (
                  <Swatch
                    key={c}
                    color={c}
                    theme={theme}
                    selected={current === c}
                    onPick={onPick}
                  />
                ),
            )}
          </div>
          <div className="hex-row">
            <span
              className={`swatch ${current === "transparent" ? "transparent" : ""}`}
              style={{
                background:
                  current === "transparent"
                    ? undefined
                    : themedColor(current, theme),
                width: 30,
                height: 30,
              }}
            />
            <input
              className="hex-input"
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              onBlur={commitHex}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commitHex();
              }}
              placeholder="#1a1a1a"
              aria-label="Custom color hex"
            />
          </div>
        </div>
      )}
    </div>
  );
};

const Swatch = ({
  color,
  theme,
  selected,
  onPick,
}: {
  color: string;
  theme: Theme;
  selected: boolean;
  onPick: (c: string) => void;
}) => (
  <button
    className={`swatch ${color === "transparent" ? "transparent" : ""} ${selected ? "selected" : ""}`}
    style={
      color === "transparent"
        ? undefined
        : { background: themedColor(color, theme) }
    }
    title={color === "transparent" ? "Transparent" : color}
    onClick={() => onPick(color)}
    aria-label={color}
  />
);

const HachureIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
    <rect x="1.5" y="1.5" width="13" height="13" rx="2" opacity="0.5" />
    <path d="M3 10 L10 3 M3 14 L14 3 M7 14 L14 7" />
  </svg>
);
const CrossHatchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
    <rect x="1.5" y="1.5" width="13" height="13" rx="2" opacity="0.5" />
    <path d="M3 10 L10 3 M3 14 L14 3 M7 14 L14 7 M6 3 L13 10 M3 6 L10 13" />
  </svg>
);
const SolidIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16">
    <rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="currentColor" />
  </svg>
);
const WidthIcon = ({ w }: { w: number }) => (
  <svg width="18" height="16" viewBox="0 0 18 16" stroke="currentColor" strokeLinecap="round">
    <line x1="2" y1="8" x2="16" y2="8" strokeWidth={w} />
  </svg>
);
const StrokeSolidIcon = () => (
  <svg width="18" height="16" viewBox="0 0 18 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <line x1="2" y1="8" x2="16" y2="8" />
  </svg>
);
const StrokeDashedIcon = () => (
  <svg width="18" height="16" viewBox="0 0 18 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <line x1="2" y1="8" x2="16" y2="8" strokeDasharray="3.5 2.5" />
  </svg>
);
const StrokeDottedIcon = () => (
  <svg width="18" height="16" viewBox="0 0 18 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <line x1="2" y1="8" x2="16" y2="8" strokeDasharray="0.5 3.4" />
  </svg>
);
const SloppyIcon = ({ level }: { level: number }) => (
  <svg width="18" height="16" viewBox="0 0 18 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    {level === 0 && <path d="M2 9 C6 8.6, 12 8.6, 16 9" />}
    {level === 1 && <path d="M2 9 C5 7, 8 10.5, 11 8.5 C13 7.2, 15 9.2, 16 8.6" />}
    {level === 2 && <path d="M2 10 C4 5.5, 7 12, 9.5 7.5 C11.5 4.5, 13.5 12, 16 8" />}
  </svg>
);
const SharpIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M14 14 L14 5 Q14 2 11 2 L2 2" />
  </svg>
);
const RoundIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M14 14 L14 9 Q14 2 7 2 L2 2" />
  </svg>
);
const HeadArrowIcon = ({ flip }: { flip?: boolean }) => (
  <svg width="18" height="16" viewBox="0 0 18 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={flip ? { transform: "scaleX(-1)" } : undefined}>
    <line x1="2" y1="8" x2="14" y2="8" />
    <path d="M10 4 L15 8 L10 12" />
  </svg>
);
const HeadBarIcon = ({ flip }: { flip?: boolean }) => (
  <svg width="18" height="16" viewBox="0 0 18 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={flip ? { transform: "scaleX(-1)" } : undefined}>
    <line x1="2" y1="8" x2="14" y2="8" />
    <line x1="14.5" y1="3.5" x2="14.5" y2="12.5" />
  </svg>
);
const HeadDotIcon = ({ flip }: { flip?: boolean }) => (
  <svg width="18" height="16" viewBox="0 0 18 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={flip ? { transform: "scaleX(-1)" } : undefined}>
    <line x1="2" y1="8" x2="12" y2="8" strokeLinecap="round" />
    <circle cx="14" cy="8" r="2.4" fill="currentColor" stroke="none" />
  </svg>
);
