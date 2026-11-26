import { libraryUrl } from "@viewswitcher/shared";
import type { AssetKind } from "@viewswitcher/shared";
import { createFileRoute } from "@tanstack/react-router";
import { type DragEvent, useRef, useState } from "react";
import { PageHead } from "../../../components/PageHead";
import { attempt, Menu, MoreIcon, PlusIcon } from "../../../components/ui";
import { api, copy } from "../../../lib/api";
import { useLibrary } from "../../../lib/library";

const FILTERS: [AssetKind | "all", string][] = [["all", "All"], ["image", "Images"], ["video", "Video"], ["audio", "Audio"]];
const size = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

export const Route = createFileRoute("/_app/$org/assets")({
  component: function Assets() {
    const { org } = Route.useParams();
    const { data } = useLibrary(org);
    const [filter, setFilter] = useState<AssetKind | "all">("all");
    const [menu, setMenu] = useState<string | null>(null);
    const [dragging, setDragging] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    const assets = data?.assets ?? [];

    const upload = (files: FileList | null) => files?.length && attempt(() => api.upload(org, files), `Uploaded ${files.length} file${files.length > 1 ? "s" : ""}`);
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      upload(e.dataTransfer.files);
    };

    return (
      <div className={dragging ? "dropzone" : undefined} style={{ display: "contents" }}
        onDragOver={(e) => (e.preventDefault(), setDragging(true))} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        <PageHead crumb={data?.org.name ?? org} title="Assets" />
        <div className="filters">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" className={`filter${filter === k ? " on" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {label} · {k === "all" ? assets.length : assets.filter((a) => a.kind === k).length}
            </button>
          ))}
        </div>
        <div className="grid" onDragOver={(e) => (e.preventDefault(), setDragging(true))} onDrop={onDrop}>
          <div className="tile">
            <button type="button" className="add-tile" onClick={() => input.current?.click()}>
              <PlusIcon size={26} />
              Upload
            </button>
            <input ref={input} type="file" multiple accept="image/*,video/*,audio/*" hidden onChange={(e) => (upload(e.target.files), (e.target.value = ""))} />
          </div>
          {assets.filter((a) => filter === "all" || a.kind === filter).map((a) => {
            const url = libraryUrl(a.path);
            return (
              <div key={a.path} className="tile">
                <button type="button" className="asset-cover" aria-label={`Options for ${a.name}`} onClick={() => setMenu(a.path)}
                  onContextMenu={(e) => (e.preventDefault(), setMenu(a.path))}>
                  {a.kind === "image" && <img src={url} alt="" loading="lazy" />}
                  {a.kind === "video" && <video src={url} muted preload="metadata" />}
                  {(a.kind === "audio" || a.kind === "other") && <span className="empty">{a.kind === "audio" ? "Audio" : "File"}</span>}
                  <span className="badge quiet">{a.kind.toUpperCase()}</span>
                </button>
                <div className="tile-meta">
                  <div className="names"><span className="label">{a.name}</span><span className="file">{size(a.size)}</span></div>
                  <button type="button" className="more" aria-label={`Options for ${a.name}`} onClick={() => setMenu(a.path)}><MoreIcon /></button>
                </div>
                {menu === a.path && (
                  <Menu label={a.name} onClose={() => setMenu(null)} items={[
                    { label: "Copy path", hint: url, run: () => void copy(url) },
                    { label: "Open the file", run: () => attempt(() => api.open(a.path)) },
                  ]} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  },
});
