import { useEffect, useMemo, useRef, useState } from "react";
import { Link2, Trash2 } from "lucide-react";
import { useStore } from "../store";
import { getRotatedBounds, mutateElement } from "../elements";
import { history } from "../history";
import { isSceneLink, makeSceneLink, normalizeLink, sceneIdFromLink } from "../links";

export const LinkEditor = () => {
  const id = useStore((s) => s.linkEditorId);
  const setLinkEditorId = useStore((s) => s.setLinkEditorId);
  const viewport = useStore((s) => s.viewport);
  const elements = useStore((s) => s.elements);
  const scenes = useStore((s) => s.scenes);
  const currentSceneId = useStore((s) => s.sceneId);

  const el = useMemo(
    () => elements.find((e) => e.id === id && !e.isDeleted) ?? null,
    [elements, id],
  );

  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!el) return;
    const existing = el.link ?? "";
    setValue(isSceneLink(existing) ? "" : existing);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [el?.id]);

  if (!el || !id) return null;

  const close = () => setLinkEditorId(null);

  const apply = (next: string | null) => {
    mutateElement(el, { link: next });
    useStore.getState().bumpScene();
    history.commit();
    close();
  };

  const commit = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      apply(null);
      return;
    }
    const normalized = normalizeLink(trimmed);
    if (!normalized) {
      useStore
        .getState()
        .toast("That does not look like a web address", "error");
      return;
    }
    apply(normalized);
  };

  const bounds = getRotatedBounds(el);
  const left = (bounds.minX - viewport.scrollX) * viewport.zoom;
  const top = (bounds.minY - viewport.scrollY) * viewport.zoom - 52;
  const otherScenes = scenes.filter((s) => s.id !== currentSceneId);
  const linkedSceneId =
    el.link && isSceneLink(el.link) ? sceneIdFromLink(el.link) : "";

  return (
    <div
      className="link-editor"
      style={{ left: Math.max(8, left), top: Math.max(8, top) }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Link2 size={15} />
      <input
        ref={inputRef}
        className="link-editor-input"
        value={value}
        placeholder="example.com/page"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit();
          if (e.key === "Escape") close();
        }}
        aria-label="Link address"
      />
      {otherScenes.length > 0 && (
        <select
          className="link-editor-scene"
          value={linkedSceneId}
          onChange={(e) => {
            if (!e.target.value) return;
            apply(makeSceneLink(e.target.value));
          }}
          aria-label="Link to a scene"
        >
          <option value="">or a scene…</option>
          {otherScenes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      )}
      <button className="link-editor-go" onClick={commit}>
        Save
      </button>
      {el.link && (
        <button
          className="link-editor-clear"
          title="Remove link"
          onClick={() => apply(null)}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
};
