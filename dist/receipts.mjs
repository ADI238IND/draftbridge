// This IndexedDB store acts as the receiving side of the demo.
// add/check happen in the same read-write transaction, including across tabs.
let connection;

function database() {
  if (!connection) {
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open("draftbridge-demo-service", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("receipts");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(error => {
      connection = undefined;
      throw error;
    });
  }
  return connection;
}

export const receiptStore = {
  async receive(id, reason) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(reason));
    const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    const db = await database();
    return new Promise((resolve, reject) => {
      const write = db.transaction("receipts", "readwrite");
      const receipts = write.objectStore("receipts");
      const existing = receipts.get(id);
      let receipt;
      existing.onsuccess = () => {
        receipt = existing.result;
        if (receipt && receipt.fingerprint !== fingerprint) {
          write.abort();
          return;
        }
        if (!receipt) {
          receipt = { number: `DB-${id.replaceAll("-", "").toUpperCase()}`, at: Date.now(), fingerprint };
          receipts.add(receipt, id);
        }
      };
      write.oncomplete = () => resolve({ number: receipt.number, at: receipt.at });
      write.onabort = () => reject(write.error ?? new Error("Receipt payload mismatch"));
    });
  },
};
