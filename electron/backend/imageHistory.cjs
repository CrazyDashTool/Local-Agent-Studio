const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function imageHistoryPath(userDataDir) {
  return path.join(userDataDir, "image-history.json");
}

function readImageHistory(userDataDir) {
  const filePath = imageHistoryPath(userDataDir);
  if (!fs.existsSync(filePath)) {
    return { items: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return { items: [] };
  }
}

function writeImageHistory(userDataDir, store) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const items = Array.isArray(store?.items) ? store.items.slice(0, 240) : [];
  const data = { items };
  fs.writeFileSync(imageHistoryPath(userDataDir), JSON.stringify(data, null, 2), "utf8");
  return data;
}

function addImageHistoryJob(userDataDir, request, result) {
  const store = readImageHistory(userDataDir);
  const jobs = result?.jobs || [];
  const promptIds = jobs.map((job) => job.promptId).filter(Boolean);
  const item = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    prompt: request.prompt,
    negativePrompt: request.negativePrompt,
    model: result?.model || request.imageModel || "z-image-turbo",
    ideogramEffort: request.ideogramEffort,
    count: result?.count || request.count || jobs.length || 1,
    status: "queued",
    promptIds,
    images: [],
  };
  return writeImageHistory(userDataDir, {
    items: [item, ...store.items],
  }).items[0];
}

function updateImageHistoryImages(userDataDir, promptId, images) {
  const store = readImageHistory(userDataDir);
  const next = store.items.map((item) => {
    if (!(item.promptIds || []).includes(promptId)) {
      return item;
    }
    const known = new Map((item.images || []).map((image) => [`${image.type || ""}/${image.subfolder || ""}/${image.filename || image.url}`, image]));
    for (const image of images || []) {
      known.set(`${image.type || ""}/${image.subfolder || ""}/${image.filename || image.url}`, image);
    }
    return {
      ...item,
      status: known.size ? "ready" : item.status,
      images: Array.from(known.values()),
    };
  });
  return writeImageHistory(userDataDir, { items: next });
}

module.exports = {
  addImageHistoryJob,
  imageHistoryPath,
  readImageHistory,
  updateImageHistoryImages,
  writeImageHistory,
};
