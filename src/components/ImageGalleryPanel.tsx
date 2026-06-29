import { useCallback, useEffect, useState } from "react";
import { Download, ExternalLink, Image, RefreshCw, X } from "lucide-react";
import type { ComfyImage, ImageHistoryItem, Settings } from "../types";

interface ImageGalleryPanelProps {
  settings: Settings | null;
}

function imageSrc(pathOrUrl?: string) {
  if (!pathOrUrl) {
    return "";
  }
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  return `file:///${pathOrUrl.replace(/\\/g, "/")}`;
}

function imageKey(image: ComfyImage, index: number) {
  return `${image.type || "output"}/${image.subfolder || ""}/${image.filename || image.url || index}`;
}

export function ImageGalleryPanel({ settings }: ImageGalleryPanelProps) {
  const [items, setItems] = useState<ImageHistoryItem[]>([]);
  const [selected, setSelected] = useState<{ item: ImageHistoryItem; image?: ComfyImage } | null>(null);
  const [status, setStatus] = useState("");

  const refresh = useCallback(async () => {
    const history = await window.localAgent.getImageHistory();
    setItems(history.items || []);
  }, []);

  useEffect(() => {
    refresh().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, [refresh]);

  async function refreshJob(item: ImageHistoryItem) {
    setStatus(`Refreshing ${item.promptIds.length} prompt id(s)...`);
    for (const promptId of item.promptIds || []) {
      await window.localAgent.getComfyImages({ promptId });
    }
    await refresh();
    setStatus("Gallery refreshed.");
  }

  async function download(image: ComfyImage) {
    setStatus("Saving image to workspace...");
    const result = await window.localAgent.saveComfyImage({ image });
    setStatus(`Saved to ${result.relativePath}`);
  }

  return (
    <section className="gallery-view">
      <header className="workspace-header">
        <div>
          <h1>Image Gallery</h1>
          <button className="link-button" type="button" onClick={() => settings?.workspacePath && window.localAgent.openPath(settings.workspacePath)}>
            Generated ComfyUI jobs and downloadable outputs
          </button>
        </div>
        <button className="quiet-button icon-text" type="button" onClick={refresh}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </header>

      <div className="gallery-grid">
        {items.length ? (
          items.map((item) => (
            <article className="gallery-card" key={item.id}>
              <div className="gallery-card-media">
                {item.images?.length ? (
                  item.images.slice(0, 4).map((image, index) => (
                    <button type="button" key={imageKey(image, index)} onClick={() => setSelected({ item, image })}>
                      <img src={imageSrc(image.url)} alt={image.filename || `Generated ${index + 1}`} />
                    </button>
                  ))
                ) : (
                  <button className="gallery-empty" type="button" onClick={() => refreshJob(item)}>
                    <Image size={24} />
                    <span>Load finished images</span>
                  </button>
                )}
              </div>
              <div className="gallery-card-body">
                <strong>{item.model}</strong>
                <p>{item.prompt}</p>
                <div className="gallery-meta">
                  <span>{item.status}</span>
                  <span>{new Date(item.createdAt).toLocaleString()}</span>
                  {item.ideogramEffort ? <span>{item.ideogramEffort}</span> : null}
                </div>
                <div className="gallery-actions">
                  <button className="tiny-button" type="button" onClick={() => refreshJob(item)}>
                    <RefreshCw size={13} />
                    Load
                  </button>
                  <button className="tiny-button" type="button" onClick={() => setSelected({ item })}>
                    <ExternalLink size={13} />
                    Details
                  </button>
                </div>
              </div>
            </article>
          ))
        ) : (
          <div className="empty-panel">
            <Image size={30} />
            <strong>No images yet</strong>
            <span>Generated ComfyUI jobs will appear here after the agent queues them.</span>
          </div>
        )}
      </div>

      {status ? <div className="floating-status">{status}</div> : null}

      {selected ? (
        <div className="lightbox-backdrop" onClick={() => setSelected(null)}>
          <div className="lightbox-panel" onClick={(event) => event.stopPropagation()}>
            <button className="icon-button lightbox-close" type="button" onClick={() => setSelected(null)} aria-label="Close image details">
              <X size={18} />
            </button>
            {selected.image ? <img src={imageSrc(selected.image.url)} alt={selected.image.filename || "Generated image"} /> : null}
            <aside>
              <h2>{selected.item.model}</h2>
              <p>{selected.item.prompt}</p>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>{selected.item.status}</dd>
                </div>
                <div>
                  <dt>Prompt IDs</dt>
                  <dd>{selected.item.promptIds.join(", ") || "none"}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{new Date(selected.item.createdAt).toLocaleString()}</dd>
                </div>
              </dl>
              {selected.image ? (
                <button className="primary-button" type="button" onClick={() => download(selected.image!)}>
                  <Download size={15} />
                  Download to workspace
                </button>
              ) : null}
            </aside>
          </div>
        </div>
      ) : null}
    </section>
  );
}
