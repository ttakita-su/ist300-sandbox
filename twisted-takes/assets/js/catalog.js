/* Twisted Takes: Reviews page search, filters and sorting.
   The page already lists every review as plain HTML; this script only shows,
   hides and reorders those cards. State is kept in the address bar
   (?q=&genre=&type=&sort=) so a filtered view can be bookmarked or shared,
   and it matches what the form would submit on its own. */
(function () {
  'use strict';

  var root = document.querySelector('[data-catalog]');
  if (!root) return;

  var form = root.querySelector('[data-catalog-controls]');
  var list = root.querySelector('[data-catalog-list]');
  if (!form || !list) return;

  var items = Array.prototype.slice.call(list.querySelectorAll('[data-catalog-item]'));
  var searchInput = form.querySelector('#catalog-q');
  var sortSelect = form.querySelector('#catalog-sort');
  var typeRadios = Array.prototype.slice.call(form.querySelectorAll('input[name="type"]'));
  var genreBoxes = Array.prototype.slice.call(form.querySelectorAll('input[name="genre"]'));
  var countEl = root.querySelector('#catalog-count');
  var emptyEl = root.querySelector('[data-catalog-empty]');
  var emptyDetail = root.querySelector('[data-catalog-empty-detail]');
  var tvEmptyEl = root.querySelector('[data-catalog-tv-empty]');
  var articlesEl = root.querySelector('[data-catalog-articles]');
  var articlesList = root.querySelector('[data-catalog-articles-list]');
  var articlesTerm = root.querySelector('[data-catalog-articles-term]');
  var indexUrl = root.getAttribute('data-index-url');
  var tvTotal = parseInt(root.getAttribute('data-tv-total'), 10) || 0;
  var siteSearch = document.querySelector('[data-site-search]');
  var siteSearchInput = siteSearch ? siteSearch.querySelector('input[name="q"]') : null;

  var SORTS = ['title', 'title-desc', 'year-desc', 'year'];
  var TYPES = ['all', 'movie', 'tv'];
  var DEFAULTS = { q: '', genres: [], type: 'all', sort: 'title' };

  var genreNames = {};
  genreBoxes.forEach(function (box) {
    genreNames[box.value] = box.parentNode.textContent.replace(/\s+/g, ' ').trim();
  });

  function normalize(text) {
    var s = String(text || '').toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s.replace(/['’‘]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function sortTitle(title) {
    return normalize(title).replace(/^(the|a|an) /, '');
  }

  items.forEach(function (item, i) {
    item._hay = ' ' + normalize(item.getAttribute('data-search') + ' ' + item.getAttribute('data-title')) + ' ';
    item._title = sortTitle(item.getAttribute('data-title'));
    item._year = parseInt(item.getAttribute('data-year'), 10) || 0;
    item._index = i;
  });

  /* ---------- State <-> controls <-> URL ---------- */

  function readUrl() {
    var params = new URLSearchParams(window.location.search);
    var genres = [];
    params.getAll('genre').forEach(function (value) {
      value.split(',').forEach(function (g) {
        g = g.trim();
        if (genreNames[g] && genres.indexOf(g) === -1) genres.push(g);
      });
    });
    var type = params.get('type');
    var sort = params.get('sort');
    return {
      q: (params.get('q') || '').slice(0, 100),
      genres: genres,
      type: TYPES.indexOf(type) !== -1 ? type : 'all',
      sort: SORTS.indexOf(sort) !== -1 ? sort : 'title'
    };
  }

  function readControls() {
    var type = 'all';
    typeRadios.forEach(function (r) { if (r.checked) type = r.value; });
    return {
      q: searchInput.value.slice(0, 100),
      genres: genreBoxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; }),
      type: type,
      sort: SORTS.indexOf(sortSelect.value) !== -1 ? sortSelect.value : 'title'
    };
  }

  function writeControls(state) {
    searchInput.value = state.q;
    if (siteSearchInput) siteSearchInput.value = state.q;
    typeRadios.forEach(function (r) { r.checked = r.value === state.type; });
    genreBoxes.forEach(function (b) { b.checked = state.genres.indexOf(b.value) !== -1; });
    sortSelect.value = state.sort;
  }

  function writeUrl(state) {
    /* Start from the current address so parameters this script does not own
       (utm_source and other campaign tags) survive for analytics. */
    var params = new URLSearchParams(window.location.search);
    ['q', 'genre', 'type', 'sort'].forEach(function (key) { params.delete(key); });
    if (state.q.trim()) params.set('q', state.q.trim());
    state.genres.forEach(function (g) { params.append('genre', g); });
    if (state.type !== 'all') params.set('type', state.type);
    if (state.sort !== 'title') params.set('sort', state.sort);
    var query = params.toString();
    var next = window.location.pathname + (query ? '?' + query : '') + window.location.hash;
    var current = window.location.pathname + window.location.search + window.location.hash;
    if (next !== current && window.history && window.history.replaceState) {
      window.history.replaceState(window.history.state, '', next);
    }
  }

  /* ---------- Filtering and sorting ---------- */

  function comparator(sort) {
    return function (a, b) {
      var byTitle = a._title.localeCompare(b._title, undefined, { numeric: true });
      if (sort === 'title-desc') return -byTitle || a._index - b._index;
      if (sort === 'year') return (a._year - b._year) || byTitle;
      if (sort === 'year-desc') return (b._year - a._year) || byTitle;
      return byTitle || a._index - b._index;
    };
  }

  function listGenres(keys) {
    var names = keys.map(function (k) { return genreNames[k]; });
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' or ' + names[names.length - 1];
  }

  function describe(state, shown) {
    var total = items.length;
    var noun = total === 1 ? 'review' : 'reviews';
    var filtered = state.q.trim() || state.genres.length || state.type !== 'all';
    if (!filtered) return 'Showing all ' + total + ' ' + noun;
    var parts = [];
    if (state.type === 'movie') parts.push('movies');
    if (state.type === 'tv') parts.push('TV');
    if (state.genres.length) parts.push('in ' + listGenres(state.genres));
    if (state.q.trim()) parts.push('matching “' + state.q.trim() + '”');
    return 'Showing ' + shown + ' of ' + total + ' ' + noun + (parts.length ? ': ' + parts.join(', ') : '');
  }

  var lastState = null;

  function apply(state) {
    var tokens = normalize(state.q).split(' ').filter(Boolean);
    var shown = 0;

    items.forEach(function (item) {
      var ok = true;
      if (state.type !== 'all' && item.getAttribute('data-type') !== state.type) ok = false;
      if (ok && state.genres.length && state.genres.indexOf(item.getAttribute('data-genre')) === -1) ok = false;
      if (ok && tokens.length) {
        ok = tokens.every(function (t) { return item._hay.indexOf(t) !== -1; });
      }
      item.hidden = !ok;
      if (ok) shown += 1;
    });

    if (!lastState || lastState.sort !== state.sort) {
      items.slice().sort(comparator(state.sort)).forEach(function (item) { list.appendChild(item); });
    }

    var tvEmpty = state.type === 'tv' && tvTotal === 0;
    list.hidden = shown === 0;
    tvEmptyEl.hidden = !tvEmpty;
    emptyEl.hidden = shown > 0 || tvEmpty;
    if (shown === 0 && !tvEmpty) {
      var bits = [];
      if (state.q.trim()) bits.push('“' + state.q.trim() + '”');
      if (state.genres.length) bits.push('in ' + listGenres(state.genres));
      emptyDetail.textContent = 'Nothing matches ' + (bits.length ? bits.join(' ') : 'these filters') +
        '. Try a shorter search, another genre, or clear the filters.';
    }

    countEl.textContent = tvEmpty ? 'No TV reviews yet' : describe(state, shown);
    updateArticles(tokens, state.q.trim());
    lastState = state;
    return shown;
  }

  /* ---------- Matching articles from the search index ---------- */

  var indexPromise = null;
  function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetch(indexUrl, { credentials: 'same-origin' })
        .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
        .then(function (data) {
          return data.filter(function (d) { return d.kind !== 'review'; }).map(function (d) {
            d._hay = ' ' + normalize([d.title, d.excerpt, d.text, (d.tags || []).join(' ')].join(' ')) + ' ';
            return d;
          });
        })
        .catch(function () { return []; });
    }
    return indexPromise;
  }

  var articleRequest = 0;
  function updateArticles(tokens, rawQuery) {
    if (!articlesEl || !indexUrl) return;
    var request = ++articleRequest;
    if (!tokens.length) { articlesEl.hidden = true; return; }
    loadIndex().then(function (docs) {
      if (request !== articleRequest) return;
      var matches = docs.filter(function (d) {
        return tokens.every(function (t) { return d._hay.indexOf(t) !== -1; });
      }).slice(0, 6);
      articlesList.textContent = '';
      if (!matches.length) { articlesEl.hidden = true; return; }
      matches.forEach(function (d) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = d.url;
        a.textContent = d.title;
        li.appendChild(a);
        if (d.excerpt) {
          var span = document.createElement('span');
          span.className = 'catalog-articles__excerpt';
          span.textContent = d.excerpt;
          li.appendChild(span);
        }
        articlesList.appendChild(li);
      });
      articlesTerm.textContent = rawQuery;
      articlesEl.hidden = false;
    });
  }

  /* ---------- Analytics (only sent when GA4 is configured) ---------- */

  var searchTimer;
  var lastTracked = '';
  function trackSearch(state, shown) {
    window.clearTimeout(searchTimer);
    var term = normalize(state.q);
    if (term.length < 2 || term === lastTracked) return;
    searchTimer = window.setTimeout(function () {
      lastTracked = term;
      /* Only terms that match catalog content are sent, so nothing personal
         typed by mistake reaches analytics. */
      var safe = shown > 0 && !/@/.test(state.q) && !/\d{5,}/.test(term);
      if (window.TT && window.TT.track) {
        window.TT.track('search', { search_term: safe ? term.slice(0, 60) : '(no match)', results_count: shown });
      }
    }, 1200);
  }

  function track(name, params) {
    if (window.TT && window.TT.track) window.TT.track(name, params);
  }

  /* ---------- Wiring ---------- */

  var inputTimer;
  function update(options) {
    var state = readControls();
    var shown = apply(state);
    writeUrl(state);
    if (siteSearchInput && options && options.syncHeader) siteSearchInput.value = state.q;
    trackSearch(state, shown);
  }

  form.hidden = false;
  var initial = readUrl();
  writeControls(initial);
  var initialShown = apply(initial);
  writeUrl(initial);
  if (initial.q) trackSearch(initial, initialShown);

  searchInput.addEventListener('input', function () {
    window.clearTimeout(inputTimer);
    inputTimer = window.setTimeout(function () { update({ syncHeader: true }); }, 200);
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    window.clearTimeout(inputTimer);
    update({ syncHeader: true });
  });

  sortSelect.addEventListener('change', function () {
    update();
    track('sort_reviews', { sort_order: sortSelect.value });
  });

  typeRadios.forEach(function (radio) {
    radio.addEventListener('change', function () {
      update();
      track('filter_format', { format: radio.value });
    });
  });

  genreBoxes.forEach(function (box) {
    box.addEventListener('change', function () {
      update();
      track('filter_genre', { genre: box.value, filter_action: box.checked ? 'add' : 'remove' });
    });
  });

  Array.prototype.forEach.call(root.querySelectorAll('[data-catalog-clear]'), function (button) {
    button.addEventListener('click', function () {
      var keepSort = readControls().sort;
      writeControls({ q: DEFAULTS.q, genres: [], type: DEFAULTS.type, sort: keepSort });
      update();
      searchInput.focus();
    });
  });

  var showMovies = root.querySelector('[data-catalog-show-movies]');
  if (showMovies) {
    showMovies.addEventListener('click', function () {
      typeRadios.forEach(function (r) { r.checked = r.value === 'movie'; });
      update();
      var movieRadio = typeRadios.filter(function (r) { return r.value === 'movie'; })[0];
      if (movieRadio) movieRadio.focus();
    });
  }

  /* On this page, the header search box drives the catalog instead of reloading. */
  if (siteSearch && siteSearchInput) {
    siteSearch.addEventListener('submit', function (event) {
      event.preventDefault();
      searchInput.value = siteSearchInput.value;
      update();
      searchInput.focus();
    });
  }
})();
