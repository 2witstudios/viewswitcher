import { libraryUrl } from "@viewswitcher/shared";
import type { OrgContent } from "@viewswitcher/shared";
import { useRef, useState } from "react";
import { api } from "../../lib/api";
import { inApp } from "../../lib/live";
import { attempt } from "../ui";

/** The org's images to choose from, and Upload. */
export function AssetPicker({ org, library, replacing, onPick, onClose }: {
  org: string;
  library: OrgContent | undefined;
  replacing: boolean;
  onPick: (asset: { path: string }) => void;
  onClose: () => void;
}) {
  const images = library?.assets.filter((a) => a.kind === "image") ?? [];
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const upload = (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    void attempt(async () => {
      try {
        const { saved } = await api.upload(org, [files[0]!]);
        if (saved[0]) onPick(saved[0]);
      } finally {
        setUploading(false);
      }
    });
  };
  return (
    <div className="modal-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal picker" role="dialog" aria-label={replacing ? "Replace image" : "Add an image"}>
        <h2>{replacing ? "Replace image" : "Add an image"}</h2>
        <div className="picker-grid">
          {images.map((a) => (
            <button key={a.path} type="button" className="picker-item" onClick={() => onPick(a)} aria-label={a.name}>
              <img src={libraryUrl(a.path)} alt="" loading="lazy" />
              <span>{a.name}</span>
            </button>
          ))}
          {images.length === 0 && <p className="empty">No images yet.</p>}
        </div>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files)} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={uploading} onClick={() => file.current?.click()}>{uploading ? "Uploading…" : inApp ? "Photos or Files…" : "Upload an image"}</button>
        </div>
      </div>
    </div>
  );
}
