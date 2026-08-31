import { useStore } from "../store";
import { openSceneFile } from "../export/json";
import { history } from "../history";
import { clearShapeCache } from "../renderer/shapes";
import { syncManager } from "../sync/manager";
import { zoomToFit } from "./view";

export const openFromFile = async () => {
  const result = await openSceneFile();
  const s = useStore.getState();
  if (!result) {
    s.toast("Could not open that file", "error");
    return;
  }
  clearShapeCache();
  s.replaceElements(result.elements);
  s.setCanvasBg(result.canvasBg);
  s.clearSelection();
  if (!s.sceneId) s.setSceneTitle(result.filename);
  history.commit();
  syncManager.onSceneMutated();
  zoomToFit();
  s.toast(`Opened “${result.filename}”`, "success");
};
