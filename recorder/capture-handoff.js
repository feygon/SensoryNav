// recorder/capture-handoff.js — one-shot IndexedDB stash that hands a just-recorded capture
// (WAV blob + sidecar manifest) from the capture page to the analyze page across a navigation.
// A ~50 MB WAV is far too big for sessionStorage, so IndexedDB stores the blob directly.
// takeHandoff() reads AND clears in one transaction, so a stale capture never re-loads on refresh.
// Attaches to self.SensoryNavHandoff (self === window in a page).
"use strict";
(function () {
  var DB = "sensorynav-handoff", STORE = "capture", KEY = "latest";

  function open() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB unavailable")); return; }
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  // rec = { wavBlob, wavName, manifest, jsonName, savedAt }
  function putHandoff(rec) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(rec, KEY);
        tx.oncomplete = function () { db.close(); resolve(true); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  // Reads the stashed capture and deletes it in the same transaction. Resolves null if none (or on
  // any error) so callers can fall back to the manual drop flow.
  function takeHandoff() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        var store = tx.objectStore(STORE);
        var getReq = store.get(KEY);
        getReq.onsuccess = function () { store.delete(KEY); };
        getReq.onerror = function () { reject(getReq.error); };
        tx.oncomplete = function () { db.close(); resolve(getReq.result || null); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    }).catch(function () { return null; });
  }

  var api = { putHandoff: putHandoff, takeHandoff: takeHandoff };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  if (typeof self !== "undefined") { self.SensoryNavHandoff = Object.assign(self.SensoryNavHandoff || {}, api); }
}());
