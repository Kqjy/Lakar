import { useEffect, useState } from "react";
import { Check, Copy, Globe } from "lucide-react";
import { useStore } from "../store";
import {
  getPublishRecord,
  publishCurrentScene,
  publishLinkFor,
  unpublishCurrentScene,
} from "../publish";

export const PublishDialog = () => {
  const sceneId = useStore((s) => s.sceneId);
  const user = useStore((s) => s.user);
  const setDialog = useStore((s) => s.setDialog);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLink(sceneId ? publishLinkFor(sceneId) : null);
  }, [sceneId]);

  const record = sceneId ? getPublishRecord(sceneId) : null;

  const publish = async () => {
    setBusy(true);
    const next = await publishCurrentScene();
    setBusy(false);
    if (next) setLink(next);
  };

  const unpublish = async () => {
    setBusy(true);
    const ok = await unpublishCurrentScene();
    setBusy(false);
    if (ok) {
      setLink(null);
      useStore.getState().toast("Page taken down");
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      useStore.getState().toast("Could not copy — select the link instead", "error");
    }
  };

  return (
    <>
      <h2 className="dialog-title">Publish a read-only page</h2>
      <p className="dialog-sub">
        A snapshot of this canvas that anyone with the link can view but nobody
        can edit. It is encrypted in your browser first — the key lives in the
        part of the link after the <code>#</code>, which browsers never send to
        a server.
      </p>

      {!user && (
        <p className="dialog-note">Sign in to publish a page.</p>
      )}

      {user && !sceneId && (
        <p className="dialog-note">
          This is the local scratchpad. Save it as a scene first.
        </p>
      )}

      {link && (
        <div className="publish-link-row">
          <input
            className="publish-link"
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Published link"
          />
          <button className="publish-copy" onClick={copy}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}

      {link && (
        <p className="dialog-note">
          The key in this link is stored on this device only, so the server can
          never reconstruct it. Publishing from another device produces a
          different link.
        </p>
      )}

      <div className="dialog-actions">
        {user && sceneId && (
          <button className="btn btn-primary" onClick={publish} disabled={busy}>
            <Globe size={15} />
            {record ? "Update the page" : "Publish"}
          </button>
        )}
        {record && (
          <button className="btn btn-ghost danger" onClick={unpublish} disabled={busy}>
            Take it down
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => setDialog(null)}>
          Close
        </button>
      </div>
    </>
  );
};
