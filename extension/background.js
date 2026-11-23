// QuickLot background worker.
// Opens Marketplace's vehicle form and hands the car to the form filler.
// It enforces the daily cap and spacing. It never posts, never reads Messenger, never sends messages.

importScripts("config.js", "lib/writer.js", "lib/store.js");

const MARKETPLACE_FORM = "https://www.facebook.com/marketplace/create/vehicle";
const MAX_PHOTOS = 20;

// Jobs waiting for their Marketplace tab, keyed by tab id. Kept in session storage so they
// survive the worker going to sleep.
async function saveJob(tabId, job) {
  await chrome.storage.session.set({ ["job_" + tabId]: job });
}
async function takeJob(tabId) {
  const key = "job_" + tabId;
  const v = await chrome.storage.session.get(key);
  return v[key] || null;
}

async function toDataUrl(url) {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error("photo " + res.status);
  const blob = await res.blob();
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { name: url.split("/").pop().split("?")[0] || "photo.jpg", type: blob.type || "image/jpeg", data: btoa(bin) };
}

async function loadPhotos(urls) {
  const out = [];
  for (const url of (urls || []).slice(0, MAX_PHOTOS)) {
    try {
      out.push(await toDataUrl(url));
    } catch (_) {
      // Skip photos that fail to download.
    }
  }
  return out;
}

async function startFill({ car, title, description }) {
  const status = await QuickLotStore.postingStatus();
  if (status.capReached) {
    return { ok: false, error: `You've used today's ${status.cap} posts. This limit helps protect your Facebook account.` };
  }
  if (status.waitUntil) {
    const mins = Math.ceil((status.waitUntil - Date.now()) / 60000);
    return { ok: false, error: `Wait about ${mins} more minute${mins === 1 ? "" : "s"} before the next post. Spacing posts out helps protect your account.` };
  }

  const photos = await loadPhotos(car.photos);
  // Open a blank tab first so the job is saved before Facebook's page finishes loading.
  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  await saveJob(tab.id, { car, title, description, photos, injected: false });
  await chrome.tabs.update(tab.id, { url: MARKETPLACE_FORM });
  await QuickLotStore.recordPost();
  await QuickLotStore.saveCar(car, title, description);
  return { ok: true, photos: photos.length };
}

// When the Marketplace tab finishes loading, inject the form filler once.
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== "complete" || !tab.url || !tab.url.startsWith("https://www.facebook.com/")) return;
  const job = await takeJob(tabId);
  if (!job || job.injected) return;
  if (!tab.url.includes("/marketplace/create/vehicle")) {
    // Facebook sent the user somewhere else, usually the login page. Wait for them.
    return;
  }
  await saveJob(tabId, { ...job, injected: true });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content/marketplace.js"] });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "startFill") {
    startFill(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg && msg.type === "getJob" && sender.tab) {
    takeJob(sender.tab.id).then(sendResponse);
    return true;
  }
  if (msg && msg.type === "jobDone" && sender.tab) {
    chrome.storage.session.remove("job_" + sender.tab.id).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
