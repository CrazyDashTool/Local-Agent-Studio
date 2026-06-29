import { useCallback, useEffect, useState } from "react";
import { FileText, FolderOpen, Plus, RefreshCw, Save } from "lucide-react";
import type { ArtifactItem, Settings } from "../types";

interface ArtifactsPanelProps {
  settings: Settings | null;
}

export function ArtifactsPanel({ settings }: ArtifactsPanelProps) {
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [selected, setSelected] = useState<ArtifactItem | null>(null);
  const [name, setName] = useState("draft.md");
  const [kind, setKind] = useState<ArtifactItem["kind"]>("markdown");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("");

  const refresh = useCallback(async () => {
    const result = await window.localAgent.listArtifacts();
    setArtifacts(result.artifacts || []);
  }, []);

  useEffect(() => {
    refresh().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, [refresh]);

  async function openArtifact(artifact: ArtifactItem) {
    const result = await window.localAgent.readArtifact({ id: artifact.id });
    setSelected(result);
    setName(result.name);
    setKind(result.kind);
    setContent(result.content || "");
  }

  async function saveArtifact() {
    const result = await window.localAgent.writeArtifact({
      id: selected?.id,
      name,
      kind,
      content,
    });
    setSelected(result.artifact);
    setStatus(`Saved ${result.artifact.relativePath}`);
    await refresh();
  }

  function newArtifact() {
    setSelected(null);
    setName("draft.md");
    setKind("markdown");
    setContent("");
  }

  return (
    <section className="artifacts-view">
      <header className="workspace-header">
        <div>
          <h1>Artifacts</h1>
          <button className="link-button" type="button" onClick={() => settings?.workspacePath && window.localAgent.openPath(settings.workspacePath)}>
            Reusable outputs stored in the workspace Artifacts folder
          </button>
        </div>
        <div className="workspace-header-actions">
          <button className="quiet-button icon-text" type="button" onClick={refresh}>
            <RefreshCw size={15} />
            Refresh
          </button>
          <button className="quiet-button icon-text" type="button" onClick={newArtifact}>
            <Plus size={15} />
            New
          </button>
        </div>
      </header>

      <div className="artifacts-grid">
        <aside className="artifact-list">
          {artifacts.length ? (
            artifacts.map((artifact) => (
              <button className={selected?.id === artifact.id ? "artifact-row active" : "artifact-row"} type="button" key={artifact.id} onClick={() => openArtifact(artifact)}>
                <FileText size={16} />
                <span>{artifact.name}</span>
                <small>{artifact.kind}</small>
              </button>
            ))
          ) : (
            <div className="empty-panel compact">
              <FileText size={24} />
              <strong>No artifacts yet</strong>
              <span>Ask the agent to create an artifact or make one here.</span>
            </div>
          )}
        </aside>

        <main className="artifact-editor">
          <div className="artifact-editor-toolbar">
            <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Artifact name" />
            <select value={kind} onChange={(event) => setKind(event.target.value as ArtifactItem["kind"])}>
              <option value="markdown">markdown</option>
              <option value="code">code</option>
              <option value="json">json</option>
              <option value="design">design</option>
              <option value="text">text</option>
              <option value="other">other</option>
            </select>
            {selected ? (
              <button className="quiet-button icon-text" type="button" onClick={() => window.localAgent.showPath(selected.absolutePath)}>
                <FolderOpen size={15} />
                Show
              </button>
            ) : null}
            <button className="primary-button" type="button" onClick={saveArtifact}>
              <Save size={15} />
              Save artifact
            </button>
          </div>
          <textarea className="artifact-textarea" value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} />
          {status ? <div className="workspace-status">{status}</div> : null}
        </main>
      </div>
    </section>
  );
}
