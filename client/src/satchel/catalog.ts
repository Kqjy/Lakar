import type { SatchelDef } from "./builder";
import { DIAGRAM_PACK } from "./packs/diagrams";
import { UI_PACK } from "./packs/ui";
import { INFRA_PACK, PEOPLE_PACK } from "./packs/infra";
import { MARKS_PACK } from "./packs/marks";
import { ICON_PACK } from "./packs/icons";
import { CHART_PACK } from "./packs/charts";

export interface SatchelCategory {
  id: string;
  name: string;
  blurb: string;
}

export const SATCHEL_CATEGORIES: SatchelCategory[] = [
  { id: "mine", name: "Mine", blurb: "Shapes you added yourself" },
  { id: "flow", name: "Flowchart", blurb: "Processes, decisions and data" },
  { id: "layout", name: "Boxes", blurb: "Cards, panels and groupings" },
  { id: "arrows", name: "Arrows", blurb: "Connectors and flow direction" },
  { id: "annotate", name: "Marks", blurb: "Bubbles, braces and emphasis" },
  { id: "ui", name: "Interface", blurb: "Wireframe parts and devices" },
  { id: "infra", name: "Systems", blurb: "Servers, clouds and pipelines" },
  { id: "people", name: "People", blurb: "Actors, teams and places" },
  { id: "icons", name: "Icons", blurb: "Small hand-drawn glyphs" },
  { id: "charts", name: "Charts", blurb: "Numbers, boards and timelines" },
];

export const BUILT_IN_SHAPES: SatchelDef[] = [
  ...DIAGRAM_PACK,
  ...MARKS_PACK,
  ...UI_PACK,
  ...INFRA_PACK,
  ...PEOPLE_PACK,
  ...ICON_PACK,
  ...CHART_PACK,
];
