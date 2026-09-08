/* One consent decision controls both pages and every open game tab. */
(function () {
  'use strict';
  const storage = window.CatSkiStorage;
  const KEY = 'skior_cookies';
  let lastChoice;
  let lastSdk;
  let mounted = false;

  function choice() {
    const value = storage.getItem(KEY);
    return value === 'accepted' || value === 'declined' ? value : null;
  }

  function sync(forceSdk) {
    const current = choice();
    const accepted = current === 'accepted';
    if (current !== lastChoice && typeof window.gtag === 'function') {
      window.gtag('consent', 'update', { analytics_storage: accepted ? 'granted' : 'denied' });
    }
    const sdk = window.mixpanel;
    if (sdk && (forceSdk || sdk !== lastSdk || current !== lastChoice)) {
      try {
        if (accepted) {
          // Restoring permission is not an additional product event.
          sdk.opt_in_tracking({ track: function () {} });
        } else {
          // Explicitly override a previously persisted SDK opt-in.
          sdk.opt_out_tracking({ delete_user: false });
        }
        lastSdk = sdk;
      } catch (_) { lastSdk = null; }
    }
    lastChoice = current;
    const banner = document.getElementById('cookie-banner');
    if (banner) banner.hidden = current !== null;
    if (document.body) document.body.classList.toggle('cookie-banner-active', current === null);
  }

  function choose(value) {
    if (value !== 'accepted' && value !== 'declined') return;
    storage.setItem(KEY, value);
    sync(true);
  }

  function mount() {
    if (!mounted) {
      const accept = document.getElementById('cookie-accept');
      const decline = document.getElementById('cookie-decline');
      if (!accept || !decline) return;
      accept.addEventListener('click', () => choose('accepted'));
      decline.addEventListener('click', () => choose('declined'));
      mounted = true;
    }
    sync();
  }

  window.addEventListener('storage', event => {
    if (event.key === KEY || event.key === null) sync(true);
  });
  window.addEventListener('pageshow', () => sync(true));
  window.addEventListener('focus', () => sync());
  document.addEventListener('DOMContentLoaded', mount, { once: true });
  window.CatSkiConsent = Object.freeze({
    choose, sync, mount,
    // Read the site choice at send-time, even before a storage event arrives.
    allowsAnalytics: () => choice() === 'accepted',
  });
  sync();
})();
