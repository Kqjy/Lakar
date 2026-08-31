import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  MoreHorizontal,
  PlusCircle,
  Search,
  Upload,
  X,
} from "lucide-react";
import { useStore } from "../store";
import type { SatchelItem } from "../types";
import { SATCHEL_CATEGORIES } from "../satchel/catalog";
import { getBuiltInItems, satchel } from "../satchel/store";
import {
  dropPreviewCache,
  primePreviewImages,
  renderItemPreview,
  waitForFonts,
} from "../satchel/preview";

export const SATCHEL_DRAG_TYPE = "application/x-lakar-satchel";

export const SatchelPanel = () => {
  const open = useStore((s) => s.satchelOpen);
  const setOpen = useStore((s) => s.setSatchelOpen);
  const theme = useStore((s) => s.theme);
  const mine = useStore((s) => s.satchelItems);
  const toast = useStore((s) => s.toast);
  const selectedIds = useStore((s) => s.selectedIds);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("flow");
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const builtIns = useMemo(() => getBuiltInItems(), []);
  const all = useMemo(() => [...mine, ...builtIns], [mine, builtIns]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all([waitForFonts(), primePreviewImages(mine)]).then(() => {
      if (!cancelled) setFontsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, mine]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const mineCount = useRef(mine.length);
  useEffect(() => {
    if (mine.length > mineCount.current) {
      setQuery("");
      setCategory("mine");
    }
    mineCount.current = mine.length;
  }, [mine.length]);

  const trimmed = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!trimmed) {
      return all.filter((item) => item.category === category);
    }
    return all.filter((item) => {
      const haystack = `${item.name} ${item.category} ${item.keywords.join(" ")}`;
      return haystack.toLowerCase().includes(trimmed);
    });
  }, [all, category, trimmed]);

  if (!open) return null;

  const counts = new Map<string, number>();
  for (const item of all) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }

  const addSelection = async () => {
    const item = await satchel.addFromSelection("My shape");
    if (!item) {
      toast("Select something on the canvas first", "info");
      return;
    }
    setQuery("");
    setCategory("mine");
    toast("Added to your satchel", "success");
  };

  return (
    <aside className="satchel" aria-label="Satchel">
      <div className="satchel-header">
        <div>
          <h2>Satchel</h2>
          <p>Drop-in shapes, icons and layouts</p>
        </div>
        <button
          className="icon-btn"
          onClick={() => setOpen(false)}
          aria-label="Close satchel"
        >
          <X size={17} />
        </button>
      </div>

      <div className="satchel-search">
        <Search size={15} />
        <input
          ref={searchRef}
          value={query}
          placeholder="Search all shapes…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label="Search shapes"
        />
        {query && (
          <button
            className="icon-btn"
            style={{ width: 24, height: 24 }}
            onClick={() => setQuery("")}
            aria-label="Clear search"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {!trimmed && (
        <div className="satchel-cats">
          {SATCHEL_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              className={`satchel-cat ${category === cat.id ? "active" : ""}`}
              onClick={() => setCategory(cat.id)}
              title={cat.blurb}
            >
              {cat.name}
              <span>{counts.get(cat.id) ?? 0}</span>
            </button>
          ))}
        </div>
      )}

      <div className="satchel-grid">
        {results.length === 0 ? (
          <div className="satchel-empty">
            {category === "mine" && !trimmed ? (
              <>
                <span className="hand">Your own shapes live here</span>
                Select anything on the canvas and press “Add selection” to keep
                it for later.
              </>
            ) : (
              <>
                <span className="hand">Nothing matches</span>
                Try a different word — shapes are tagged by what they’re for.
              </>
            )}
          </div>
        ) : (
          results.map((item) => (
            <SatchelTile
              key={item.id}
              item={item}
              theme={theme}
              ready={fontsLoaded}
            />
          ))
        )}
      </div>

      <div className="satchel-footer">
        <button
          className="btn btn-primary"
          style={{ flex: 1 }}
          onClick={addSelection}
          disabled={selectedIds.size === 0}
          title={
            selectedIds.size
              ? "Save the current selection as a reusable shape"
              : "Select something on the canvas first"
          }
        >
          <PlusCircle size={15} /> Add selection
        </button>
        <button
          className="btn btn-outline"
          title="Import shapes from a .lakarsatchel file"
          onClick={async () => {
            const count = await satchel.importFromFile();
            if (count) {
              setCategory("mine");
              setQuery("");
              toast(`Imported ${count} shape${count === 1 ? "" : "s"}`, "success");
            } else {
              toast("Nothing to import from that file", "error");
            }
          }}
        >
          <Upload size={15} />
        </button>
        <button
          className="btn btn-outline"
          title="Export your own shapes"
          disabled={!mine.length}
          onClick={() => {
            satchel.exportAll();
            toast("Exported your shapes", "success");
          }}
        >
          <Download size={15} />
        </button>
      </div>
    </aside>
  );
};

const SatchelTile = ({
  item,
  theme,
  ready,
}: {
  item: SatchelItem;
  theme: string;
  ready: boolean;
}) => {
  const toast = useStore((s) => s.toast);
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(item.name);
  const menuRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(item.name), [item.name]);

  useEffect(() => {
    if (!menuAt) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || popRef.current?.contains(target)) {
        return;
      }
      setMenuAt(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuAt]);

  const preview = ready
    ? renderItemPreview(item, theme === "dark" ? "dark" : "light")
    : "";

  if (renaming) {
    return (
      <div className="satchel-tile renaming">
        <input
          className="drawer-search"
          style={{ margin: 0, width: "100%" }}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setDraft(item.name);
              setRenaming(false);
            }
          }}
          onBlur={() => {
            const next = draft.trim();
            if (next && next !== item.name) void satchel.rename(item.id, next);
            setRenaming(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="satchel-tile-wrap" ref={menuRef}>
      <button
        className="satchel-tile"
        title={`${item.name} — click to place, or drag onto the canvas`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(SATCHEL_DRAG_TYPE, item.id);
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={() => {
          satchel.place(item, null);
          toast(`Placed “${item.name}”`, "success");
        }}
      >
        {preview ? (
          <img src={preview} alt="" draggable={false} />
        ) : (
          <span className="satchel-skeleton" />
        )}
        <span className="satchel-tile-name">{item.name}</span>
      </button>
      {item.mine && (
        <button
          className="icon-btn satchel-kebab"
          data-open={!!menuAt}
          aria-label={`Options for ${item.name}`}
          onClick={(e) => {
            e.stopPropagation();
            if (menuAt) {
              setMenuAt(null);
              return;
            }
            const rect = e.currentTarget.getBoundingClientRect();
            setMenuAt({
              top: Math.min(rect.bottom + 4, window.innerHeight - 110),
              left: Math.min(rect.left - 140, window.innerWidth - 190),
            });
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      )}
      {menuAt && (
        <div
          className="menu-pop"
          ref={popRef}
          style={{ position: "fixed", top: menuAt.top, left: menuAt.left, minWidth: 178 }}
        >
          <button
            className="menu-item"
            onClick={() => {
              setMenuAt(null);
              setRenaming(true);
            }}
          >
            Rename
          </button>
          <button
            className="menu-item danger"
            onClick={() => {
              setMenuAt(null);
              dropPreviewCache(item.id);
              void satchel.remove(item.id);
            }}
          >
            Remove from satchel
          </button>
        </div>
      )}
    </div>
  );
};
