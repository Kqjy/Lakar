import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Command as CommandIcon } from "lucide-react";
import { useStore } from "../store";
import { buildCommands, fuzzyScore, type Command } from "../commands";
import { isFrameElement, isTextElement } from "../types";
import { revealElement } from "../interaction/view";

interface SearchHit {
  id: string;
  text: string;
  matchAt: number;
  matchLength: number;
  kind: string;
}

const MAX_COMMANDS = 40;
const MAX_HITS = 60;

export const Palette = () => {
  const mode = useStore((s) => s.palette);
  const setPalette = useStore((s) => s.setPalette);
  const elements = useStore((s) => s.elements);
  const sceneNonce = useStore((s) => s.sceneNonce);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery("");
    setActive(0);
  }, [mode]);

  const commands = useMemo(
    () => (mode === "command" ? buildCommands() : []),
    [mode],
  );

  const commandHits = useMemo(() => {
    if (mode !== "command") return [];
    const scored: { cmd: Command; score: number }[] = [];
    for (const cmd of commands) {
      const score = fuzzyScore(query.trim(), `${cmd.group} ${cmd.label}`);
      if (score === null) continue;
      scored.push({ cmd, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, MAX_COMMANDS).map((x) => x.cmd);
  }, [mode, commands, query]);

  const searchHits = useMemo(() => {
    if (mode !== "search") return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: SearchHit[] = [];
    for (const el of elements) {
      if (el.isDeleted) continue;
      let text: string;
      let kind: string;
      if (isTextElement(el)) {
        text = el.originalText ?? el.text;
        kind = el.containerId ? "Label" : "Text";
      } else if (isFrameElement(el)) {
        text = el.name;
        kind = "Frame";
      } else {
        continue;
      }
      const at = text.toLowerCase().indexOf(q);
      if (at < 0) continue;
      out.push({ id: el.id, text, matchAt: at, matchLength: q.length, kind });
      if (out.length >= MAX_HITS) break;
    }
    return out;
  }, [mode, query, elements, sceneNonce]);

  const count = mode === "command" ? commandHits.length : searchHits.length;

  useEffect(() => {
    if (active >= count) setActive(0);
  }, [count, active]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${active}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!mode) return null;

  const close = () => setPalette(null);

  const choose = (index: number) => {
    if (mode === "command") {
      const cmd = commandHits[index];
      if (!cmd) return;
      close();
      cmd.run();
      return;
    }
    const hit = searchHits[index];
    if (!hit) return;
    revealElement(hit.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      setActive((i) => (count ? (i + 1) % count : 0));
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      setActive((i) => (count ? (i - 1 + count) % count : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <div className="palette-backdrop" onPointerDown={close}>
      <div
        className="palette"
        role="dialog"
        aria-label={mode === "command" ? "Command palette" : "Find on canvas"}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="palette-input-row">
          {mode === "command" ? <CommandIcon size={16} /> : <Search size={16} />}
          <input
            autoFocus
            className="palette-input"
            value={query}
            placeholder={
              mode === "command"
                ? "Type a command…"
                : "Find text on this canvas…"
            }
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            aria-label={mode === "command" ? "Command" : "Search"}
          />
          <button className="palette-mode" onClick={() =>
            setPalette(mode === "command" ? "search" : "command")
          }>
            {mode === "command" ? "Find text" : "Commands"}
          </button>
        </div>

        <div className="palette-list" ref={listRef}>
          {count === 0 && (
            <div className="palette-empty">
              {mode === "search" && !query.trim()
                ? "Start typing to find text, labels and frame names."
                : "Nothing matches that."}
            </div>
          )}

          {mode === "command" &&
            commandHits.map((cmd, i) => (
              <button
                key={cmd.id}
                data-index={i}
                className={`palette-row ${i === active ? "active" : ""}`}
                onPointerEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
              >
                <span className="palette-group">{cmd.group}</span>
                <span className="palette-label">{cmd.label}</span>
                {cmd.hint && <span className="palette-hint">{cmd.hint}</span>}
              </button>
            ))}

          {mode === "search" &&
            searchHits.map((hit, i) => (
              <button
                key={`${hit.id}-${i}`}
                data-index={i}
                className={`palette-row ${i === active ? "active" : ""}`}
                onPointerEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
              >
                <span className="palette-group">{hit.kind}</span>
                <span className="palette-label">
                  {hit.text.slice(Math.max(0, hit.matchAt - 24), hit.matchAt)}
                  <mark>
                    {hit.text.slice(hit.matchAt, hit.matchAt + hit.matchLength)}
                  </mark>
                  {hit.text.slice(
                    hit.matchAt + hit.matchLength,
                    hit.matchAt + hit.matchLength + 48,
                  )}
                </span>
              </button>
            ))}
        </div>

        <div className="palette-foot">
          <span>↑↓ navigate</span>
          <span>↵ {mode === "command" ? "run" : "go to"}</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
};
