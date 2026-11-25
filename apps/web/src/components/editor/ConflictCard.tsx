import { describeEdit } from "@viewswitcher/shared";
import type { Box } from "@viewswitcher/shared";
import { Icon } from "../icons";
import { SCENE_H } from "./geometry";
import type { Conflict } from "./mode";

/** A save hit a newer version of the file: what didn't make it, Apply my change again, Keep the new version. */
export function ConflictCard({ conflict, firstMark, onApplyAgain, onKeepNew }: {
  conflict: Conflict;
  /** Where the first thing that changed is, to stay clear of it. */
  firstMark: Box | null;
  onApplyAgain: () => void;
  onKeepNew: () => void;
}) {
  return (
    <div className="conflict" role="alertdialog" aria-label="This scene changed while you were editing"
      // Low on the stage when the change is in the top half.
      style={firstMark && firstMark.y + firstMark.h / 2 < SCENE_H / 2 ? { top: "auto", bottom: "8%" } : undefined}>
      <div className="head">
        {Icon.changed}
        <div>
          <b>This scene changed while you were editing</b>
          <p>A newer version was saved. This change didn't make it:</p>
        </div>
      </div>
      {conflict.edits.map((e, i) => {
        const d = describeEdit(conflict.prev, e);
        return <div key={i} className="lost"><span>{d.what} → </span>{d.value}</div>;
      })}
      <div className="actions">
        <button type="button" className="btn primary" onClick={onApplyAgain}>Apply my change again</button>
        <button type="button" className="btn" onClick={onKeepNew}>Keep the new version</button>
      </div>
    </div>
  );
}

/** The open scene couldn't be read again (or keeps changing while it opens): say so, with Reload. */
export function StuckCard({ message, onReload }: { message: string; onReload: () => void }) {
  return (
    <div className="conflict stuck" role="alert">
      <div className="head"><div><b>{message}</b><p>Nothing you've saved is lost.</p></div></div>
      <div className="actions">
        <button type="button" className="btn primary" onClick={onReload}>Reload</button>
      </div>
    </div>
  );
}
