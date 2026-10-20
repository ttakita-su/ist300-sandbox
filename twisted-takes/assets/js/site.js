/* Twisted Takes: site-wide enhancements.
   Everything here is optional: menus, links and articles work without it.
   - TT.track(): sends a Google Analytics 4 event when (and only when) the GA4
     tag is loaded. Never pass names, emails or free text typed by readers.
   - Mobile menu toggle.
   - Copy-link and native share buttons. */
(function () {
  'use strict';

  var TT = window.TT = window.TT || {};

  TT.track = function (eventName, params) {
    if (typeof window.gtag !== 'function') return;
    try {
      window.gtag('event', eventName, params || {});
    } catch (err) {
      /* Analytics must never break the page. */
    }
  };

  /* ---------- Mobile menu ---------- */
  function initMenu() {
    var toggle = document.querySelector('[data-menu-toggle]');
    var nav = document.getElementById('site-nav');
    if (!toggle || !nav) return;

    function setOpen(open) {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      nav.classList.toggle('is-open', open);
    }

    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });

    var wide = window.matchMedia('(min-width: 761px)');
    var onChange = function () { if (wide.matches) setOpen(false); };
    if (wide.addEventListener) wide.addEventListener('change', onChange);
    else if (wide.addListener) wide.addListener(onChange);
  }

  /* ---------- Copy link and native share ---------- */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return legacyCopy(text); }
      );
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    document.body.removeChild(area);
    return ok;
  }

  function initShare() {
    var boxes = document.querySelectorAll('[data-share]');
    Array.prototype.forEach.call(boxes, function (box) {
      var url = box.getAttribute('data-share-url') || window.location.href;
      var title = box.getAttribute('data-share-title') || document.title;
      var type = box.getAttribute('data-share-type') || 'page';
      var id = box.getAttribute('data-share-id') || window.location.pathname;
      var actions = box.querySelector('[data-share-actions]');
      var copyButton = box.querySelector('[data-share-copy]');
      var nativeButton = box.querySelector('[data-share-native]');
      var fallback = box.querySelector('[data-share-fallback]');
      var input = fallback ? fallback.querySelector('input') : null;
      var status = box.querySelector('[data-share-status]');
      if (!actions || !copyButton || !status) return;

      actions.hidden = false;
      if (fallback) fallback.hidden = true;
      if (nativeButton && typeof navigator.share === 'function') nativeButton.hidden = false;

      var clearTimer;
      function announce(message) {
        status.textContent = message;
        window.clearTimeout(clearTimer);
        clearTimer = window.setTimeout(function () { status.textContent = ''; }, 8000);
      }

      function showFallback(message) {
        if (fallback && input) {
          fallback.hidden = false;
          input.focus();
          input.select();
        }
        announce(message);
      }

      copyButton.addEventListener('click', function () {
        copyText(url).then(function (ok) {
          if (ok) {
            announce('Link copied. Paste it anywhere to share this page.');
            copyButton.textContent = 'Link copied';
            window.setTimeout(function () { copyButton.textContent = 'Copy link'; }, 3000);
            TT.track('share', { method: 'copy_link', content_type: type, item_id: id });
          } else {
            showFallback('Your browser blocked copying. The link is selected below: press Ctrl+C, or Command+C on a Mac.');
          }
        });
      });

      if (nativeButton) {
        nativeButton.addEventListener('click', function () {
          navigator.share({ title: title, url: url }).then(function () {
            TT.track('share', { method: 'native_share', content_type: type, item_id: id });
          }).catch(function (err) {
            if (err && err.name === 'AbortError') return; /* the reader closed the share sheet */
            showFallback('Sharing is not available here. Copy the link below instead.');
          });
        });
      }
    });
  }

  function init() {
    initMenu();
    initShare();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
