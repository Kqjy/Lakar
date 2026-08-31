import { useMemo, useState } from "react";
import { Workflow } from "lucide-react";
import { useStore } from "../store";
import {
  buildFlowElements,
  MermaidError,
  parseMermaid,
  SAMPLE_MERMAID,
} from "../mermaid";
import { viewportCenter } from "../interaction/actions";
import { getCommonBounds } from "../elements";
import { history } from "../history";
import { zoomToFit } from "../interaction/view";

export const MermaidDialog = () => {
  const setDialog = useStore((s) => s.setDialog);
  const [source, setSource] = useState(SAMPLE_MERMAID);

  const parsed = useMemo(() => {
    try {
      const flow = parseMermaid(source);
      return { flow, error: null as string | null };
    } catch (err) {
      return {
        flow: null,
        error:
          err instanceof MermaidError
            ? err.message
            : "Could not read that diagram",
      };
    }
  }, [source]);

  const insert = () => {
    if (!parsed.flow) return;
    const s = useStore.getState();
    const elements = buildFlowElements(parsed.flow, s.itemDefaults, {
      x: 0,
      y: 0,
    });
    if (!elements.length) return;
    const bounds = getCommonBounds(elements);
    const centre = viewportCenter();
    const dx = centre.x - (bounds.minX + bounds.maxX) / 2;
    const dy = centre.y - (bounds.minY + bounds.maxY) / 2;
    for (const el of elements) {
      el.x += dx;
      el.y += dy;
    }
    s.replaceElements([...s.elements, ...elements]);
    s.setSelectedIds(
      elements.filter((el) => el.type !== "text" || !el.containerId).map((el) => el.id),
    );
    history.commit();
    setDialog(null);
    zoomToFit(true);
    s.toast(
      `Inserted ${parsed.flow.nodes.length} nodes and ${parsed.flow.edges.length} arrows`,
      "success",
    );
  };

  return (
    <>
      <h2 className="dialog-title">Diagram from text</h2>
      <p className="dialog-sub">
        Paste Mermaid flowchart syntax. Everything it draws is ordinary
        hand-drawn shapes you can edit, and the arrows stay attached when you
        move things.
      </p>

      <textarea
        className="mermaid-input"
        value={source}
        spellCheck={false}
        onChange={(e) => setSource(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label="Mermaid source"
        rows={10}
      />

      {parsed.error ? (
        <p className="mermaid-status error">{parsed.error}</p>
      ) : (
        <p className="mermaid-status">
          {parsed.flow!.nodes.length} nodes · {parsed.flow!.edges.length} arrows
          · {parsed.flow!.direction === "TD" ? "top to bottom" : "left to right"}
        </p>
      )}

      <details className="mermaid-help">
        <summary>What is supported</summary>
        <ul>
          <li>
            <code>flowchart TD</code> / <code>LR</code> (also <code>graph</code>,
            and <code>TB</code>/<code>RL</code>/<code>BT</code> folded onto those
            two)
          </li>
          <li>
            Shapes: <code>A[box]</code>, <code>A(rounded)</code>,{" "}
            <code>A{"{"}diamond{"}"}</code>, <code>A((circle))</code>,{" "}
            <code>A[(store)]</code>
          </li>
          <li>
            Links: <code>--&gt;</code>, <code>---</code>, <code>-.-&gt;</code>,{" "}
            <code>==&gt;</code>, with <code>|labels|</code> or{" "}
            <code>-- label --&gt;</code>
          </li>
          <li>
            Ignored for now: subgraphs, <code>class</code>/<code>style</code>,
            and diagram types other than flowcharts
          </li>
        </ul>
      </details>

      <div className="dialog-actions">
        <button
          className="btn btn-primary"
          onClick={insert}
          disabled={!parsed.flow}
        >
          <Workflow size={15} />
          Insert
        </button>
        <button className="btn btn-ghost" onClick={() => setDialog(null)}>
          Cancel
        </button>
      </div>
    </>
  );
};
