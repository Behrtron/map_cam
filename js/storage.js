const DB_NAME = "phone-scene-calibrator";
const DB_VERSION = 1;
const STORE = "captures";

let dbPromise = null;

export function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "json.createdAt", { unique: false });
      }
    };
  });
  return dbPromise;
}

function txStore(db, mode = "readonly") {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function putCapture(record) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = txStore(db, "readwrite").put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
}

export async function getCapture(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = txStore(db).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllCaptures() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = txStore(db).getAll();
    request.onsuccess = () => {
      const items = request.result || [];
      items.sort((a, b) => String(b.json?.createdAt || "").localeCompare(String(a.json?.createdAt || "")));
      resolve(items);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteCapture(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = txStore(db, "readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearCaptures() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = txStore(db, "readwrite").clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function updateCaptureJson(id, updater) {
  const record = await getCapture(id);
  if (!record) throw new Error(`Capture not found: ${id}`);
  const nextJson = await updater(record.json, record);
  record.json = nextJson;
  await putCapture(record);
  return record;
}
