import { HelpCircle } from "lucide-react";
import { useStore } from "../store";

export const BottomRight = () => {
  const setDialog = useStore((s) => s.setDialog);
  return (
    <div className="bottom-right">
      <button
        className="island icon-btn"
        title="Keyboard shortcuts — ?"
        aria-label="Keyboard shortcuts"
        onClick={() => setDialog("help")}
      >
        <HelpCircle size={17} />
      </button>
    </div>
  );
};
