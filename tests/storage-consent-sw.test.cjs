const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = source('index.html');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Each VM is a separate browser tab; storage events are delivered explicitly
// so tests can also exercise the interval before the other tab receives one.
function storageHub(initial = {}) {
  const values = new Map(Object.entries(initial));
  const tabs = [];
  const events = [];
  function tab(options = {}) {
    const listeners = new Map();
    const elements = new Map(['cookie-banner', 'cookie-accept', 'cookie-decline'].map(id => [id, {
      hidden: true, handlers: {},
      addEventListener(type, callback) { this.handlers[type] = callback; },
    }]));
    const ga = [];
    const sdk = {
      optedIn: true, events: [], automaticOptIns: 0,
      opt_in_tracking(options) { this.optedIn = true; if (!options.track) this.automaticOptIns++; },
      opt_out_tracking() { this.optedIn = false; },
      track(name, props) { if (this.optedIn) this.events.push({ name, props }); },
    };
    const context = vm.createContext({
      console, Map, Set, navigator: { locks: options.locks }, crypto: { randomUUID },
      addEventListener(type, callback) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(callback);
      },
      document: {
        getElementById: id => elements.get(id),
        body: { classList: { toggle() {} } },
        addEventListener() {},
      },
      gtag: (...args) => ga.push(args),
      mixpanel: options.noSdk ? undefined : sdk,
    });
    context.window = context;
    const store = {
      getItem(key) { if (options.readThrows) throw new Error('SecurityError'); return values.get(key) ?? null; },
      setItem(key, value) {
        if (options.writeThrows) throw new Error('QuotaExceededError');
        const oldValue = values.get(key) ?? null;
        values.set(key, String(value));
        if (oldValue !== String(value)) {
          for (const other of tabs) if (other.context !== context) events.push([other, { key, oldValue, newValue: String(value) }]);
        }
      },
      removeItem(key) {
        if (options.writeThrows) throw new Error('QuotaExceededError');
        values.delete(key);
        for (const other of tabs) if (other.context !== context) events.push([other, { key, newValue: null }]);
      },
    };
    Object.defineProperty(context, 'localStorage', {
      get() { if (options.getterThrows) throw new Error('SecurityError'); return store; },
    });
    vm.runInContext(source('storage.js'), context);
    const result = {
      context, sdk, ga, elements,
      run: code => vm.runInContext(code, context),
      fire: (type, event) => { for (const callback of listeners.get(type) || []) callback(event); },
    };
    tabs.push(result);
    return result;
  }
  return { values, tab, flush() { for (const [tab, event] of events.splice(0)) tab.fire('storage', event); } };
}

function functionSource(name) {
  const found = html.match(new RegExp('^  (?:async )?function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^  \\}', 'm'));
  assert.ok(found, 'Missing source function ' + name);
  return found[0];
}
function installScores(tab) {
  const names = ['sanitizeBests', 'readBestState', 'loadBests', 'mergePendingBests', 'flushBestChanges', 'saveBest', 'sanitizeBoard',
    'loadLeaderboardCache', 'saveLeaderboardCache', 'mergeLeaderboardCaches', 'insertLeaderboardEntry'];
  tab.run(`
    let livesMode = true;
    function gameplayConfig() { return { livesMode }; }
    function bestKey() { return '1.0_3_9'; }
    function currentBest() { return bests[bestKey()] || 0; }
    function refreshBestForCombo() { best = currentBest(); }
    function modeSlot(lives = livesMode) { return lives ? 'lives9' : 'lives1'; }
    function renderLeaderboard() {}
    const LB_LIMIT = 3;
    const LB_CACHE_KEY = 'skior_leaderboard_v3';
    ${names.map(functionSource).join('\n')}
    let bests = loadBests();
    const pendingBestChanges = new Map();
    const initialBestState = readBestState();
    for (const [key, score] of Object.entries(bests)) {
      if (score > (initialBestState.scores[key] || 0)) {
        pendingBestChanges.set(key, { score, base: undefined, hadMap: initialBestState.available && initialBestState.hasMap });
      }
    }
    let best = currentBest();
    let leaderboardCache = loadLeaderboardCache();
    let leaderboard = leaderboardCache[modeSlot()];
  `);
  const events = html.match(/  window\.addEventListener\('storage', event => \{[\s\S]*?\n  \}\);/);
  assert.ok(events, 'Score storage listener exists');
  tab.run(events[0]);
}

function queuedLocks() {
  const queue = [];
  return { queue, locks: { request(_name, callback) {
    return new Promise((resolve, reject) => queue.push(async () => {
      try { resolve(await callback()); } catch (error) { reject(error); }
    }));
  } }, async drain(hub) {
    while (queue.length) { await queue.shift()(); hub.flush(); }
  } };
}

test('blocked reads, storage getter, and full quota retain usable session preferences', async () => {
  for (const options of [{ getterThrows: true }, { readThrows: true, writeThrows: true }, { writeThrows: true }]) {
    const tab = storageHub().tab(options);
    const storage = tab.context.CatSkiStorage;
    assert.equal(storage.getItem('skior_controls'), null);
    assert.equal(storage.setItem('skior_controls', 'wasd'), false);
    assert.equal(storage.getItem('skior_controls'), 'wasd');
    assert.equal(storage.removeItem('skior_controls'), false);
    assert.equal(storage.getItem('skior_controls'), null);
    installScores(tab);
    await tab.run('insertLeaderboardEntry("CAT", 200, true)');
    assert.equal(tab.run('leaderboardCache.lives9[0].score'), 200);
    await tab.run('saveBest(bestKey(), 400)');
    assert.equal(tab.run('currentBest()'), 400);
  }
  assert.doesNotMatch(html, /\blocalStorage\.(?:getItem|setItem|removeItem)\(/, 'all game accesses use safe storage');
});

test('unavailable or rejected Web Locks fall back once; update failures are not duplicated', async () => {
  const tab = storageHub().tab({ locks: { request: async () => { throw new Error('unavailable'); } } });
  let calls = 0;
  assert.equal(await tab.context.CatSkiStorage.withLock('test', () => ++calls), 1);
  assert.equal(calls, 1);
  const locked = storageHub().tab({ locks: { request: async (_name, fn) => fn() } });
  await assert.rejects(locked.context.CatSkiStorage.withLock('test', () => { calls++; throw new Error('update failed'); }), /update failed/);
  assert.equal(calls, 2);
});

test('best maps reject null, arrays, malformed JSON and non-finite/non-numeric scores', () => {
  for (const value of ['null', '[]', '"corrupt"', '{broken', '42']) {
    const tab = storageHub({ skior_bests: value }).tab();
    installScores(tab);
    assert.deepEqual(plain(tab.run('bests')), {});
    assert.equal(tab.run('currentBest()'), 0);
  }
  const tab = storageHub({ skior_bests: '{"valid":300,"zero":0,"negative":-1,"text":"900","huge":1e999,"nested":{}}' }).tab();
  installScores(tab);
  assert.deepEqual(plain(tab.run('bests')), { valid: 300, zero: 0 });
  const legacy = storageHub({ skior_best: '700' }).tab();
  installScores(legacy);
  assert.equal(legacy.run('currentBest()'), 700);
});

test('best saves merge latest valid maxima and explicit reset removes only its key', async () => {
  const hub = storageHub({ skior_bests: '{"first":100,"second":200}' });
  const a = hub.tab(), b = hub.tab();
  installScores(a); installScores(b);
  await a.run('saveBest("first", 700)');
  await b.run('saveBest("second", 800)');
  assert.deepEqual(JSON.parse(hub.values.get('skior_bests')), { first: 700, second: 800 });
  await b.run('saveBest("first", null)');
  assert.deepEqual(JSON.parse(hub.values.get('skior_bests')), { second: 800 });
});

test('a queued different-combo save cannot restore a reset best', async () => {
  const pending = queuedLocks();
  const hub = storageHub({ skior_bests: '{"first":900,"second":800}' });
  const a = hub.tab({ locks: pending.locks }), b = hub.tab({ locks: pending.locks });
  installScores(a); installScores(b);
  const reset = a.run('saveBest("first", null)');
  const save = b.run('saveBest("second", 1000)');
  await pending.drain(hub);
  await Promise.all([reset, save]);
  assert.deepEqual(JSON.parse(hub.values.get('skior_bests')), { second: 1000 });
});

test('a delayed reset event preserves a genuinely newer same-key save', async () => {
  const pending = queuedLocks();
  const hub = storageHub({ skior_bests: '{"first":900}' });
  const a = hub.tab(), b = hub.tab({ locks: pending.locks });
  installScores(a); installScores(b);
  await a.run('saveBest("first", null)');
  const newer = b.run('saveBest("first", 1000)');
  hub.flush(); // The reset event arrives after the newer save was created.
  assert.equal(b.run('bests.first'), 1000);
  await pending.drain(hub); await newer;
  assert.deepEqual(JSON.parse(hub.values.get('skior_bests')), { first: 1000 });
});

test('a reset or storage removal cancels an older queued improvement', async () => {
  for (const action of ['saveBest("first", null)', 'CatSkiStorage.removeItem("skior_bests")']) {
    const pending = queuedLocks();
    const hub = storageHub({ skior_bests: '{"first":900}' });
    const a = hub.tab(), b = hub.tab({ locks: pending.locks });
    installScores(a); installScores(b);
    const older = b.run('saveBest("first", 1000)');
    await a.run(action);
    hub.flush();
    await pending.drain(hub); await older;
    assert.equal(b.run('bests.first'), undefined);
    assert.deepEqual(JSON.parse(hub.values.get('skior_bests') || '{}'), {});
  }
});

test('a new run queued after this tab resets starts a fresh best', async () => {
  const pending = queuedLocks();
  const hub = storageHub({ skior_bests: '{"first":900}' });
  const tab = hub.tab({ locks: pending.locks });
  installScores(tab);
  const reset = tab.run('saveBest("first", null)');
  const newer = tab.run('saveBest("first", 100)');
  await pending.drain(hub); await Promise.all([reset, newer]);
  assert.deepEqual(JSON.parse(hub.values.get('skior_bests')), { first: 100 });
});

test('quota-fallback improvements survive another tab update and persist after recovery', async () => {
  const hub = storageHub({ skior_bests: '{"first":900}' });
  const options = { writeThrows: true };
  const a = hub.tab(options), b = hub.tab();
  installScores(a); installScores(b);
  await a.run('saveBest("first", 1000)');
  await b.run('saveBest("second", 1200)');
  hub.flush();
  assert.equal(a.run('bests.first'), 1000);
  assert.equal(a.run('bests.second'), 1200);
  options.writeThrows = false;
  await a.run('flushBestChanges()');
  assert.deepEqual(JSON.parse(hub.values.get('skior_bests')), { first: 1000, second: 1200 });
  assert.equal(a.run('pendingBestChanges.size'), 0);
});

test('unavailable reads are not treated as durable reset baselines', async () => {
  const options = { getterThrows: true };
  const hub = storageHub({ skior_bests: '{"first":900}' });
  const tab = hub.tab(options);
  installScores(tab);
  await tab.run('saveBest("first", 1000)');
  options.getterThrows = false;
  await tab.run('flushBestChanges()');
  assert.deepEqual(JSON.parse(hub.values.get('skior_bests')), { first: 1000 });
});

test('legacy single best survives the first save of a different combination', async () => {
  const hub = storageHub({ skior_best: '900' });
  const tab = hub.tab();
  installScores(tab);
  await tab.run('saveBest("second", 1200)');
  assert.deepEqual(JSON.parse(hub.values.get('skior_bests')), { '1.0_3_9': 900, second: 1200 });
});

test('stale leaderboard tabs preserve both boards and migrate old rows without duplicates', async () => {
  const hub = storageHub({ skior_leaderboard_v3: JSON.stringify({
    lives9: [{ name: 'OLD', score: 100 }, { name: 'SEED', score: 9000, starter: true }],
    lives1: [{ name: 'ONE', score: 90 }],
  }) });
  const a = hub.tab(), b = hub.tab();
  installScores(a); installScores(b);
  assert.equal(await a.run('insertLeaderboardEntry("HIGH", 900, true)'), 1);
  await b.run('insertLeaderboardEntry("LOW", 200, true)');
  await a.run('insertLeaderboardEntry("OTHER", 600, false)');
  const saved = JSON.parse(hub.values.get('skior_leaderboard_v3'));
  assert.deepEqual(saved.lives9.map(row => row.score), [900, 200, 100]);
  assert.deepEqual(saved.lives1.map(row => row.score), [600, 90]);
  assert.equal(new Set(saved.lives9.map(row => row.id)).size, 3);
  assert.equal(a.run('leaderboard[0].score'), 900, 'saving an earlier one-life run must not change visible mode');
});

test('concurrent locked submissions keep distinct equal scores and serialize latest reads', async () => {
  let tail = Promise.resolve();
  const locks = { request(_name, callback) {
    const result = tail.then(callback);
    tail = result.catch(() => {});
    return result;
  } };
  const hub = storageHub();
  const a = hub.tab({ locks }), b = hub.tab({ locks });
  installScores(a); installScores(b);
  await Promise.all([a.run('insertLeaderboardEntry("CAT", 500, true)'), b.run('insertLeaderboardEntry("CAT", 500, true)')]);
  const rows = JSON.parse(hub.values.get('skior_leaderboard_v3')).lives9;
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].id, rows[1].id);
});

function installConsent(tab) {
  tab.run(source('consent.js'));
  tab.run(functionSource('analytics'));
  tab.context.CatSkiConsent.mount();
}
test('site decline explicitly overrides stale SDK opt-in on boot', () => {
  for (const choice of [undefined, 'declined', 'invalid']) {
    const tab = storageHub(choice ? { skior_cookies: choice } : {}).tab();
    installConsent(tab);
    assert.equal(tab.sdk.optedIn, false);
    tab.run('analytics("game_started")');
    assert.equal(tab.sdk.events.length, 0);
    assert.equal(tab.ga.at(-1)[2].analytics_storage, 'denied');
  }
});

test('game and guide reconcile accept, cross-tab decline, and storage clearing', () => {
  const hub = storageHub();
  const game = hub.tab(), guide = hub.tab({ noSdk: true });
  installConsent(game); installConsent(guide);
  game.elements.get('cookie-accept').handlers.click();
  assert.equal(game.sdk.optedIn, true);
  assert.equal(game.sdk.automaticOptIns, 0);
  hub.flush();
  assert.equal(guide.ga.at(-1)[2].analytics_storage, 'granted');
  assert.equal(guide.elements.get('cookie-banner').hidden, true);
  game.run('analytics("game_started")');
  assert.equal(game.sdk.events.length, 1);
  guide.context.CatSkiConsent.choose('declined');
  // No storage event delivered yet: wrapper must already see latest site choice.
  game.run('analytics("run_completed")');
  assert.equal(game.sdk.events.length, 1);
  hub.flush();
  assert.equal(game.sdk.optedIn, false);
  assert.equal(game.ga.at(-1)[2].analytics_storage, 'denied');
  guide.context.CatSkiStorage.removeItem('skior_cookies');
  hub.flush();
  assert.equal(game.elements.get('cookie-banner').hidden, false);
  assert.equal(game.context.CatSkiConsent.allowsAnalytics(), false);
});

test('consent works with blocked storage and forces SDK state after asynchronous load', () => {
  const tab = storageHub().tab({ getterThrows: true });
  installConsent(tab);
  tab.context.CatSkiConsent.choose('accepted');
  assert.equal(tab.context.CatSkiConsent.allowsAnalytics(), true);
  assert.equal(tab.sdk.optedIn, true);
  tab.sdk.optedIn = false;
  tab.context.CatSkiConsent.sync(true);
  assert.equal(tab.sdk.optedIn, true);
  tab.context.CatSkiConsent.choose('declined');
  assert.equal(tab.sdk.optedIn, false);
  assert.equal(tab.elements.get('cookie-banner').hidden, true);
});

function serviceWorker() {
  const origin = 'https://cat-ski.test';
  const handlers = {};
  const entries = new Map();
  const deleted = [];
  const puts = [];
  let network = async () => { throw new Error('offline'); };
  let putGate;
  const key = request => new URL(typeof request === 'string' ? request : request.url, origin).href;
  const cache = {
    async match(request) { const response = entries.get(key(request)); return response ? response.clone() : undefined; },
    async put(request, response) { if (putGate) await putGate; puts.push(key(request)); entries.set(key(request), response.clone()); },
    async addAll(requests) { for (const request of requests) entries.set(key(request), new Response('shell')); },
  };
  const context = vm.createContext({
    URL, Response,
    self: { location: { origin }, addEventListener: (name, fn) => { handlers[name] = fn; },
      skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async () => cache, keys: async () => ['cat-ski-v23', 'cat-ski-v24', 'unrelated'],
      delete: async name => { deleted.push(name); } },
    fetch: request => network(request),
  });
  vm.runInContext(source('sw.js'), context);
  function dispatch(pathname, navigation = true) {
    const waits = [];
    let response;
    handlers.fetch({
      request: { method: 'GET', url: new URL(pathname, origin).href, mode: navigation ? 'navigate' : 'cors',
        headers: { get: () => navigation ? 'text/html' : '' } },
      respondWith: promise => { response = promise; },
      waitUntil: promise => waits.push(promise),
    });
    return { response, waits, lifetime: Promise.all(waits) };
  }
  return { context, handlers, deleted, puts, dispatch,
    network(fn) { network = fn; },
    delayWrites(promise) { putGate = promise; },
    seed(pathname, text, status = 200) { entries.set(key(pathname), new Response(text, { status })); },
    async cached(pathname) { const response = await cache.match(pathname); return response && { status: response.status, text: await response.text() }; },
  };
}

test('service worker keeps healthy HTML across HTTP 503 followed by offline navigation', async () => {
  const sw = serviceWorker();
  sw.seed('/', 'working game');
  sw.network(async () => new Response('outage', { status: 503 }));
  const failed = sw.dispatch('/');
  assert.equal(await (await failed.response).text(), 'working game');
  await failed.lifetime;
  assert.deepEqual(await sw.cached('/'), { status: 200, text: 'working game' });
  assert.equal(sw.puts.length, 0);
  sw.network(async () => { throw new Error('offline'); });
  const offline = sw.dispatch('/');
  assert.equal(await (await offline.response).text(), 'working game');
  await offline.lifetime;
});

test('navigation refresh caches success and waitUntil covers the write', async () => {
  const sw = serviceWorker();
  const write = deferred();
  sw.seed('/', 'old game');
  sw.network(async () => new Response('new game'));
  sw.delayWrites(write.promise);
  const request = sw.dispatch('/');
  assert.equal(request.waits.length, 1);
  let finished = false;
  request.lifetime.then(() => { finished = true; });
  await tick();
  assert.equal(finished, false);
  write.resolve();
  assert.equal(await (await request.response).text(), 'new game');
  await request.lifetime;
  assert.deepEqual(await sw.cached('/'), { status: 200, text: 'new game' });
});

test('cached scripts return promptly while waitUntil protects background refresh and cache writes', async () => {
  const sw = serviceWorker();
  const network = deferred(), write = deferred();
  sw.seed('/storage.js?v=24', 'old script');
  sw.network(() => network.promise);
  sw.delayWrites(write.promise);
  const request = sw.dispatch('/storage.js?v=24', false);
  assert.equal(await (await request.response).text(), 'old script');
  assert.equal(request.waits.length, 1);
  let finished = false;
  request.lifetime.then(() => { finished = true; });
  network.resolve(new Response('new script'));
  await tick();
  assert.equal(finished, false, 'lifetime includes delayed cache.put');
  write.resolve();
  await request.lifetime;
  assert.deepEqual(await sw.cached('/storage.js?v=24'), { status: 200, text: 'new script' });
});

test('static failures never poison cache; no-cache offline returns a Response and unrelated caches survive', async () => {
  const sw = serviceWorker();
  sw.seed('/icon.png', 'good image');
  sw.network(async () => new Response('outage', { status: 503 }));
  const failed = sw.dispatch('/icon.png', false);
  assert.equal(await (await failed.response).text(), 'good image');
  await failed.lifetime;
  assert.equal(sw.puts.length, 0);
  sw.network(async () => { throw new Error('offline'); });
  const missing = sw.dispatch('/missing.png', false);
  assert.equal((await missing.response).type, 'error');
  await missing.lifetime;
  let activation;
  sw.handlers.activate({ waitUntil: promise => { activation = promise; } });
  await activation;
  assert.deepEqual(sw.deleted, ['cat-ski-v23']);
  const shell = plain(vm.runInContext('APP_SHELL', sw.context));
  assert.ok(shell.includes('/storage.js?v=24'));
  assert.ok(shell.includes('/consent.js?v=24'));
  assert.equal(vm.runInContext('CACHE_NAME', sw.context), 'cat-ski-v24');
});
