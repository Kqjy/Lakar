import { arrow, ellipse, label, rect, TINT_BLUE, TINT_GREEN, TINT_SAND } from "./satchel/builder";
import { getBindableAtPoint, makeBinding, updateBoundArrows } from "./binding";
import { history } from "./history";
import { zoomToFit } from "./interaction/view";
import { useStore } from "./store";
import type { LakarElement } from "./types";

export type Starter = "flowchart" | "system" | "brainstorm";

export function insertStarter(kind: Starter) {
  const s = useStore.getState();
  if (s.viewerMode || s.elements.some((el) => !el.isDeleted)) return;
  const elements: LakarElement[] = [];
  const box = (x: number, y: number, title: string, fill: string, round = false) => {
    const shape = (round ? ellipse : rect)(x, y, 160, 80, { fill, round: true });
    elements.push(shape, label(shape, title, { size: 20 }));
  };
  if (kind === "brainstorm") {
    box(220, 140, "Your big idea", TINT_SAND, true);
    box(0, 0, "Who is it for?", TINT_BLUE);
    box(440, 0, "What if…?", TINT_GREEN);
    box(0, 280, "What matters?", TINT_GREEN);
    box(440, 280, "Try next", TINT_BLUE);
    elements.push(...[[160, 80, 230, 150], [440, 80, 370, 150], [160, 280, 230, 210], [440, 280, 370, 210]].map(
      ([x, y, ex, ey]) => arrow([[x, y], [ex, ey]], { end: "none" }),
    ));
  } else {
    const titles = kind === "flowchart" ? ["Start", "Take a step", "Done"] : ["Client", "API", "Database"];
    titles.forEach((title, i) => box(i * 240, 0, title, [TINT_BLUE, TINT_SAND, TINT_GREEN][i], kind === "flowchart" && i !== 1));
    elements.push(arrow([[165, 40], [230, 40]]), arrow([[405, 40], [470, 40]]));
  }
  for (const el of elements) {
    if (el.type !== "arrow") continue;
    for (const [end, point] of [["start", el.points[0]], ["end", el.points[el.points.length - 1]]] as const) {
      const at = { x: el.x + point[0], y: el.y + point[1] };
      const target = getBindableAtPoint(elements, at, 1);
      if (target) el[end === "start" ? "startBinding" : "endBinding"] = makeBinding(target, at);
    }
  }
  updateBoundArrows(elements, new Set(elements.map((el) => el.id)));
  s.replaceElements([...s.elements, ...elements]);
  s.setTool("selection");
  s.clearSelection();
  history.commit();
  zoomToFit();
  s.toast("Double-click any label to make it yours. Undo to start over.");
}

