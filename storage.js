/* Optional persistence must never prevent a game from starting. */
(function () {
  'use strict';
  const memory = new Map();
  const pending = new Set();

  function getItem(key) {
    if (pending.has(key)) return memory.get(key) ?? null;
    try {
      const value = window.localStorage.getItem(key);
      memory.set(key, value);
      return value;
    } catch (_) {
      return memory.get(key) ?? null;
    }
  }

  // Score merges need the latest durable snapshot as well as unsaved memory.
  function getStoredItem(key) {
    try { return window.localStorage.getItem(key); }
    catch (_) { return memory.get(key) ?? null; }
  }

  function setItem(key, value) {
    value = String(value);
    memory.set(key, value);
    try {
      window.localStorage.setItem(key, value);
      pending.delete(key);
      return true;
    } catch (_) {
      pending.add(key);
      return false;
    }
  }

  function removeItem(key) {
    memory.set(key, null);
    try {
      window.localStorage.removeItem(key);
      pending.delete(key);
      return true;
    } catch (_) {
      pending.add(key);
      return false;
    }
  }

  async function withLock(name, update) {
    let started = false;
    try {
      if (navigator.locks && typeof navigator.locks.request === 'function') {
        return await navigator.locks.request(name, () => {
          started = true;
          return update();
        });
      }
    } catch (error) {
      if (started) throw error;
      // A blocked/unsupported lock API must not disable local score saving.
    }
    return update();
  }

  window.addEventListener('storage', event => {
    if (event.key === null) {
      memory.clear();
      pending.clear();
    } else {
      memory.set(event.key, event.newValue);
      pending.delete(event.key);
    }
  });
  window.CatSkiStorage = Object.freeze({ getItem, getStoredItem, setItem, removeItem, withLock });
})();
