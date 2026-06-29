const fs = require("node:fs");
const path = require("node:path");

const catalogPath = path.join(__dirname, "..", "electron", "plugin-marketplace.json");

function resolveGitHubManifestUrl(input) {
  const url = new URL(input);
  if (url.hostname === "raw.githubusercontent.com") {
    return url.toString();
  }
  if (url.hostname !== "github.com") {
    return url.toString();
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("GitHub URL must point to a repository or plugin.json file.");
  }
  const [owner, repo] = parts;
  if (parts[2] === "blob" && parts.length >= 5) {
    return `https://raw.githubusercontent.com/${owner}/${repo}/${parts[3]}/${parts.slice(4).join("/")}`;
  }
  const branch = parts[2] === "tree" && parts[3] ? parts[3] : "main";
  const subdir = parts[2] === "tree" && parts.length > 4 ? `${parts.slice(4).join("/")}/` : "";
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${subdir}plugin.json`;
}

async function readManifest(source, publicSourceUrl) {
  if (fs.existsSync(source)) {
    const manifest = JSON.parse(fs.readFileSync(source, "utf8"));
    if (publicSourceUrl) {
      manifest.sourceUrl = publicSourceUrl;
      manifest.manifestUrl = resolveGitHubManifestUrl(publicSourceUrl);
    }
    return manifest;
  }
  const manifestUrl = resolveGitHubManifestUrl(source);
  const response = await fetch(manifestUrl);
  if (!response.ok) {
    throw new Error(`Could not fetch plugin manifest: ${response.status}`);
  }
  const manifest = await response.json();
  manifest.manifestUrl = manifest.manifestUrl || manifestUrl;
  manifest.sourceUrl = manifest.sourceUrl || source;
  return manifest;
}

function normalizeCatalogPlugin(manifest, source, publicSourceUrl) {
  if (!manifest.id || !manifest.name && !manifest.label) {
    throw new Error("Manifest must include id and name/label.");
  }
  const isLocal = fs.existsSync(source);
  const sourceForInstall = publicSourceUrl || manifest.sourceUrl || source;
  return {
    ...manifest,
    publisher: manifest.publisher === "official" ? "official" : "community",
    status: manifest.status || "draft",
    sourceUrl: sourceForInstall,
    manifestUrl: manifest.manifestUrl || (isLocal && !publicSourceUrl ? "" : resolveGitHubManifestUrl(sourceForInstall)),
    verifiedAt: new Date().toISOString().slice(0, 10),
  };
}

async function main() {
  const source = process.argv[2];
  const publicSourceUrl = process.argv[3] || "";
  if (!source) {
    console.error("Usage: node scripts/add-plugin-to-marketplace.cjs <github-url-or-local-plugin.json> [public-github-url]");
    process.exit(1);
  }

  const manifest = await readManifest(source, publicSourceUrl);
  const plugin = normalizeCatalogPlugin(manifest, source, publicSourceUrl);
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const plugins = Array.isArray(catalog.plugins) ? catalog.plugins : [];
  const nextPlugins = plugins.filter((item) => item.id !== plugin.id);
  nextPlugins.push(plugin);
  nextPlugins.sort((a, b) => String(a.label || a.name).localeCompare(String(b.label || b.name)));
  fs.writeFileSync(
    catalogPath,
    JSON.stringify(
      {
        ...catalog,
        updatedAt: new Date().toISOString().slice(0, 10),
        plugins: nextPlugins,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`Added ${plugin.label || plugin.name} to ${catalogPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
