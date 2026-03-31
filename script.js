/* ═══════════════════════════════════════════════
   SoundVault — Main Script
   IndexedDB · Vanilla JS · Mobile PWA
═══════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────
   1. DATABASE (IndexedDB)
───────────────────────────────────────────── */
const DB_NAME    = 'soundvault_db';
const DB_VERSION = 2;
let   db         = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('tracks')) {
        const ts = d.createObjectStore('tracks', { keyPath: 'id' });
        ts.createIndex('artist', 'artist', { unique: false });
        ts.createIndex('dateAdded', 'dateAdded', { unique: false });
      }
      if (!d.objectStoreNames.contains('albums')) {
        d.createObjectStore('albums', { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('playlists')) {
        d.createObjectStore('playlists', { keyPath: 'id' });
      }
    };

    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror   = e => reject(e.target.error);
  });
}

function dbGet(store, key) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function dbGetAll(store) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function dbPut(store, obj) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(obj);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function dbDelete(store, key) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

/* ─────────────────────────────────────────────
   2. GLOBAL STATE
───────────────────────────────────────────── */
const state = {
  tracks:         [],
  albums:         [],
  playlists:      [],

  queue:          [],      // array of track IDs
  queueIndex:     -1,
  isPlaying:      false,
  shuffle:        false,
  repeat:         'none',  // 'none' | 'one' | 'all'
  favorites:      new Set(),

  currentAlbumId:    null,
  currentPlaylistId: null,

  addMusicTarget:  null,   // { type: 'album'|'playlist', id }
};

/* ─────────────────────────────────────────────
   3. HELPERS
───────────────────────────────────────────── */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function formatTime(secs) {
  if (!secs || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function showToast(msg, duration = 2000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  requestAnimationFrame(() => {
    el.classList.add('show');
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.classList.add('hidden'), 300);
    }, duration);
  });
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = e => resolve(e.target.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function fileToArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = e => resolve(e.target.result);
    r.onerror = reject;
    r.readAsArrayBuffer(file);
  });
}

function getAudioDuration(arrayBuffer, mimeType) {
  return new Promise(resolve => {
    try {
      const blob = new Blob([arrayBuffer], { type: mimeType });
      const url  = URL.createObjectURL(blob);
      const a    = new Audio();
      a.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(a.duration); };
      a.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
      a.src = url;
    } catch { resolve(0); }
  });
}

function loadFavorites() {
  try {
    const s = localStorage.getItem('sv_favorites');
    if (s) JSON.parse(s).forEach(id => state.favorites.add(id));
  } catch {}
}
function saveFavorites() {
  localStorage.setItem('sv_favorites', JSON.stringify([...state.favorites]));
}

function loadLastPlayed() {
  try {
    const s = localStorage.getItem('sv_last_played');
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
function saveLastPlayed() {
  const t = getCurrentTrack();
  if (!t) return;
  localStorage.setItem('sv_last_played', JSON.stringify({
    trackId: t.id,
    time: audioEl.currentTime,
  }));
}

function getCurrentTrack() {
  if (state.queueIndex < 0 || state.queueIndex >= state.queue.length) return null;
  const id = state.queue[state.queueIndex];
  return state.tracks.find(t => t.id === id) || null;
}

/* ─────────────────────────────────────────────
   4. AUDIO ENGINE
───────────────────────────────────────────── */
const audioEl = document.getElementById('audio-player');
let   currentBlobUrl = null;

async function loadTrack(track) {
  if (!track) return;
  // Revoke previous blob
  if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);

  try {
    const blob = new Blob([track.audioData], { type: track.audioMime || 'audio/mpeg' });
    currentBlobUrl = URL.createObjectURL(blob);
    audioEl.src = currentBlobUrl;
    audioEl.load();
    updatePlayerUI(track);
    saveLastPlayed();
  } catch (err) {
    console.error('Load track error:', err);
  }
}

async function playTrack(track) {
  await loadTrack(track);
  try {
    await audioEl.play();
    state.isPlaying = true;
    setPlayPauseUI(true);
  } catch (err) {
    console.warn('Playback error:', err);
  }
}

function togglePlayPause() {
  if (!getCurrentTrack()) return;
  if (state.isPlaying) {
    audioEl.pause();
    state.isPlaying = false;
    setPlayPauseUI(false);
  } else {
    audioEl.play().then(() => {
      state.isPlaying = true;
      setPlayPauseUI(true);
    }).catch(console.warn);
  }
}

function playNext() {
  if (!state.queue.length) return;
  if (state.repeat === 'one') {
    audioEl.currentTime = 0;
    audioEl.play();
    return;
  }
  if (state.shuffle) {
    const next = Math.floor(Math.random() * state.queue.length);
    state.queueIndex = next;
  } else {
    state.queueIndex++;
    if (state.queueIndex >= state.queue.length) {
      if (state.repeat === 'all') state.queueIndex = 0;
      else { state.isPlaying = false; setPlayPauseUI(false); return; }
    }
  }
  const t = getCurrentTrack();
  if (t) playTrack(t);
}

function playPrev() {
  if (!state.queue.length) return;
  if (audioEl.currentTime > 3) { audioEl.currentTime = 0; return; }
  if (state.shuffle) {
    state.queueIndex = Math.floor(Math.random() * state.queue.length);
  } else {
    state.queueIndex = Math.max(0, state.queueIndex - 1);
  }
  const t = getCurrentTrack();
  if (t) playTrack(t);
}

audioEl.addEventListener('ended', playNext);
audioEl.addEventListener('timeupdate', onTimeUpdate);
audioEl.addEventListener('loadedmetadata', onMetadataLoaded);

function onTimeUpdate() {
  const t = getCurrentTrack();
  if (!t) return;
  const pct = audioEl.duration ? (audioEl.currentTime / audioEl.duration) * 100 : 0;

  // Mini player
  document.getElementById('mini-progress-bar').style.width = pct + '%';

  // Full player seek
  const fpSeek = document.getElementById('fp-seek');
  fpSeek.value = pct;
  fpSeek.style.setProperty('--progress', pct + '%');

  document.getElementById('fp-current').textContent = formatTime(audioEl.currentTime);
  saveLastPlayed();
}

function onMetadataLoaded() {
  document.getElementById('fp-duration').textContent = formatTime(audioEl.duration);
}

/* ─────────────────────────────────────────────
   5. PLAYER UI
───────────────────────────────────────────── */
function setPlayPauseUI(playing) {
  // Mini player
  document.getElementById('mini-play').querySelector('.icon-play').classList.toggle('hidden', playing);
  document.getElementById('mini-play').querySelector('.icon-pause').classList.toggle('hidden', !playing);
  // Full player
  document.getElementById('fp-play').querySelector('.icon-play').classList.toggle('hidden', playing);
  document.getElementById('fp-play').querySelector('.icon-pause').classList.toggle('hidden', !playing);
  // Cover animation
  document.querySelector('.fp-cover-wrap').classList.toggle('playing', playing);
  // Track list items
  document.querySelectorAll('.track-item.playing').forEach(el => {
    el.querySelectorAll('.track-playing-anim span').forEach(s => {
      s.style.animationPlayState = playing ? 'running' : 'paused';
    });
  });
}

function updatePlayerUI(track) {
  if (!track) return;

  // Mini player
  const miniPlayer = document.getElementById('mini-player');
  miniPlayer.classList.remove('hidden', 'hide');

  document.getElementById('mini-title').textContent  = track.title;
  document.getElementById('mini-artist').textContent = track.artist || 'Inconnu';

  const miniCoverImg = document.getElementById('mini-cover');
  const miniPlaceholder = miniPlayer.querySelector('.mini-cover-placeholder');
  if (track.coverData) {
    miniCoverImg.src = track.coverData;
    miniCoverImg.classList.remove('hidden');
    miniPlaceholder.style.display = 'none';
  } else {
    miniCoverImg.classList.add('hidden');
    miniPlaceholder.style.display = '';
  }

  // Full player
  document.getElementById('fp-title').textContent  = track.title;
  document.getElementById('fp-artist').textContent = track.artist || 'Inconnu';

  const fpCoverImg = document.getElementById('fp-cover');
  const fpCoverPh  = document.getElementById('fp-cover-placeholder');
  if (track.coverData) {
    fpCoverImg.src = track.coverData;
    fpCoverImg.classList.remove('hidden');
    fpCoverPh.classList.add('hidden');
  } else {
    fpCoverImg.classList.add('hidden');
    fpCoverPh.classList.remove('hidden');
  }

  // Full player background tint (subtle)
  const fpBg = document.getElementById('fp-bg');
  fpBg.style.background = track.coverData
    ? `linear-gradient(to bottom, #141414 0%, #0a0a0a 100%)`
    : 'var(--bg)';

  // Favorite state
  const favBtn = document.getElementById('fp-fav-btn');
  favBtn.classList.toggle('active', state.favorites.has(track.id));

  // Update playing state in track lists
  document.querySelectorAll('.track-item').forEach(el => {
    el.classList.toggle('playing', el.dataset.id === track.id);
  });
}

/* ─────────────────────────────────────────────
   6. QUEUE MANAGEMENT
───────────────────────────────────────────── */
function buildQueue(trackIds, startIndex = 0) {
  state.queue = [...trackIds];
  state.queueIndex = startIndex;
}

function playFromQueue(trackIds, startIndex = 0) {
  buildQueue(trackIds, startIndex);
  const t = getCurrentTrack();
  if (t) playTrack(t);
}

/* ─────────────────────────────────────────────
   7. RENDER: HOME
───────────────────────────────────────────── */
function renderHome() {
  renderRecentTracks();
  renderHomeAlbums();
  renderHomePlaylists();
  updateGreeting();
}

function updateGreeting() {
  const h = new Date().getHours();
  const greet = h < 12 ? 'Bonjour ☀️'
              : h < 18 ? 'Bonne journée 👋'
              : h < 22 ? 'Bonsoir 🌙'
              : 'Bonne nuit 🌟';
  document.getElementById('hero-greeting').textContent = greet;
}

function renderRecentTracks() {
  const container = document.getElementById('recent-tracks');
  const sorted = [...state.tracks]
    .sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0))
    .slice(0, 10);

  if (!sorted.length) {
    container.innerHTML = '<div class="empty-hint">Ajoutez vos premières musiques ✦</div>';
    return;
  }

  container.innerHTML = sorted.map(t => `
    <div class="recent-chip" data-id="${t.id}">
      <div class="recent-chip-cover">
        ${t.coverData ? `<img src="${t.coverData}" alt="" />` : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`}
      </div>
      <div class="recent-chip-info">
        <div class="recent-chip-title">${escHtml(t.title)}</div>
        <div class="recent-chip-artist">${escHtml(t.artist || 'Inconnu')}</div>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.recent-chip').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const idx = sorted.findIndex(t => t.id === id);
      playFromQueue(sorted.map(t => t.id), idx);
    });
  });
}

function renderHomeAlbums() {
  const container = document.getElementById('home-albums');
  if (!state.albums.length) {
    container.innerHTML = '<div class="empty-hint">Aucun album pour l\'instant</div>';
    return;
  }
  container.innerHTML = state.albums.slice(0, 8).map(album => buildAlbumCard(album)).join('');
  bindCardClicks(container, 'album');
}

function renderHomePlaylists() {
  const container = document.getElementById('home-playlists');
  if (!state.playlists.length) {
    container.innerHTML = '<div class="empty-hint">Aucune playlist</div>';
    return;
  }
  container.innerHTML = state.playlists.slice(0, 8).map(pl => buildPlaylistCard(pl)).join('');
  bindCardClicks(container, 'playlist');
}

/* ─────────────────────────────────────────────
   8. RENDER: ALBUMS
───────────────────────────────────────────── */
function renderAlbums() {
  const grid = document.getElementById('albums-grid');
  if (!state.albums.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💿</div>
        <p>Aucun album</p>
        <button class="btn-primary" id="create-album-empty-btn">Créer un album</button>
      </div>`;
    document.getElementById('create-album-empty-btn')
      .addEventListener('click', () => openModal('modal-create-album'));
    return;
  }
  grid.innerHTML = state.albums.map(a => buildAlbumCard(a)).join('');
  bindCardClicks(grid, 'album');
}

function buildAlbumCard(album) {
  const count = state.tracks.filter(t => t.albumId === album.id).length;
  return `
    <div class="media-card" data-id="${album.id}" data-type="album">
      <div class="card-cover">
        ${album.coverData
          ? `<img src="${album.coverData}" alt="" />`
          : `<div class="card-cover-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg></div>`}
        <div class="card-play-overlay"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div>
      </div>
      <div class="card-label">
        <div class="card-name">${escHtml(album.name)}</div>
        <div class="card-sub">${count} titre${count !== 1 ? 's' : ''}</div>
      </div>
    </div>`;
}

/* ─────────────────────────────────────────────
   9. RENDER: PLAYLISTS
───────────────────────────────────────────── */
function renderPlaylists() {
  const grid = document.getElementById('playlists-grid');
  if (!state.playlists.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎶</div>
        <p>Aucune playlist</p>
        <button class="btn-primary" id="create-playlist-empty-btn">Créer une playlist</button>
      </div>`;
    document.getElementById('create-playlist-empty-btn')
      .addEventListener('click', () => openModal('modal-create-playlist'));
    return;
  }
  grid.innerHTML = state.playlists.map(pl => buildPlaylistCard(pl)).join('');
  bindCardClicks(grid, 'playlist');
}

function buildPlaylistCard(pl) {
  const count = pl.trackIds ? pl.trackIds.length : 0;
  return `
    <div class="media-card" data-id="${pl.id}" data-type="playlist">
      <div class="card-cover">
        ${pl.coverData
          ? `<img src="${pl.coverData}" alt="" />`
          : `<div class="card-cover-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></div>`}
        <div class="card-play-overlay"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div>
      </div>
      <div class="card-label">
        <div class="card-name">${escHtml(pl.name)}</div>
        <div class="card-sub">${count} titre${count !== 1 ? 's' : ''}</div>
      </div>
    </div>`;
}

function bindCardClicks(container, type) {
  container.querySelectorAll(`.media-card[data-type="${type}"]`).forEach(el => {
    el.addEventListener('click', () => openDetail(type, el.dataset.id));
  });
}

/* ─────────────────────────────────────────────
   10. RENDER: LIBRARY
───────────────────────────────────────────── */
let librarySortMode = 'date';

function renderLibrary() {
  const list   = document.getElementById('library-list');
  const badge  = document.getElementById('lib-count');
  badge.textContent = `${state.tracks.length} titre${state.tracks.length !== 1 ? 's' : ''}`;

  let sorted = [...state.tracks];
  if (librarySortMode === 'title')  sorted.sort((a, b) => a.title.localeCompare(b.title));
  if (librarySortMode === 'artist') sorted.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
  if (librarySortMode === 'date')   sorted.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));

  if (!sorted.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎵</div>
        <p>Bibliothèque vide</p>
        <button class="btn-primary" id="add-first-track-btn">Ajouter une musique</button>
      </div>`;
    document.getElementById('add-first-track-btn')
      .addEventListener('click', () => openAddMusicModal());
    return;
  }

  list.innerHTML = sorted.map(t => buildTrackItem(t)).join('');
  bindTrackItemEvents(list, sorted);
}

function buildTrackItem(track) {
  const isPlaying = getCurrentTrack()?.id === track.id;
  return `
    <div class="track-item${isPlaying ? ' playing' : ''}" data-id="${track.id}">
      <div class="track-cover">
        ${track.coverData ? `<img src="${track.coverData}" alt="" />` : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`}
        <div class="track-playing-anim">
          <span></span><span></span><span></span>
        </div>
      </div>
      <div class="track-info">
        <div class="track-title">${escHtml(track.title)}</div>
        <div class="track-artist">${escHtml(track.artist || 'Inconnu')}</div>
      </div>
      <span class="track-duration">${formatTime(track.duration)}</span>
      <button class="track-more-btn" data-id="${track.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
      </button>
    </div>`;
}

function bindTrackItemEvents(container, tracks) {
  container.querySelectorAll('.track-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.track-more-btn')) return;
      const id  = el.dataset.id;
      const idx = tracks.findIndex(t => t.id === id);
      playFromQueue(tracks.map(t => t.id), idx);
    });
  });
  container.querySelectorAll('.track-more-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openContextMenu(btn.dataset.id);
    });
  });
}

/* ─────────────────────────────────────────────
   11. DETAIL VIEW (Album / Playlist)
───────────────────────────────────────────── */
function openDetail(type, id) {
  state.currentAlbumId    = type === 'album'    ? id : null;
  state.currentPlaylistId = type === 'playlist' ? id : null;

  const item = type === 'album'
    ? state.albums.find(a => a.id === id)
    : state.playlists.find(p => p.id === id);
  if (!item) return;

  const tracks = type === 'album'
    ? state.tracks.filter(t => t.albumId === id)
    : (item.trackIds || []).map(tid => state.tracks.find(t => t.id === tid)).filter(Boolean);

  // Header
  document.getElementById('detail-header-title').textContent = item.name;
  document.getElementById('detail-type-label').textContent   = type === 'album' ? 'ALBUM' : 'PLAYLIST';
  document.getElementById('detail-title').textContent = item.name;
  document.getElementById('detail-sub').textContent   =
    `${tracks.length} titre${tracks.length !== 1 ? 's' : ''}${item.artist ? ' · ' + item.artist : ''}`;

  // Cover
  const coverImg = document.getElementById('detail-cover');
  const coverPh  = document.getElementById('detail-cover-placeholder');
  if (item.coverData) {
    coverImg.src = item.coverData;
    coverImg.classList.remove('hidden');
    coverPh.classList.add('hidden');
  } else {
    coverImg.classList.add('hidden');
    coverPh.classList.remove('hidden');
  }

  // Track list
  const list = document.getElementById('detail-track-list');
  if (!tracks.length) {
    list.innerHTML = '<div class="empty-state"><p>Aucun titre</p></div>';
  } else {
    list.innerHTML = tracks.map(t => buildTrackItem(t)).join('');
    bindTrackItemEvents(list, tracks);
    list.querySelectorAll('.track-more-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        openContextMenu(btn.dataset.id, { type, id });
      });
    });
  }

  // Play all / shuffle
  document.getElementById('detail-play-all').onclick = () => {
    if (tracks.length) playFromQueue(tracks.map(t => t.id), 0);
  };
  document.getElementById('detail-shuffle-all').onclick = () => {
    if (!tracks.length) return;
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    playFromQueue(shuffled.map(t => t.id), 0);
  };

  // Add track button
  document.getElementById('detail-add-track').onclick = () => {
    openAddMusicModal({ type, id });
  };

  // More button
  document.getElementById('detail-more').onclick = () => {
    openItemContextMenu(type, id);
  };

  // Show
  const dv = document.getElementById('detail-view');
  dv.classList.remove('hidden');
  dv.classList.add('slide-in');
  dv.scrollTop = 0;
}

function closeDetail() {
  const dv = document.getElementById('detail-view');
  dv.classList.add('hidden');
  dv.classList.remove('slide-in');
}

/* ─────────────────────────────────────────────
   12. FULL SCREEN PLAYER
───────────────────────────────────────────── */
function openFullPlayer() {
  const fp = document.getElementById('full-player');
  fp.classList.remove('hidden', 'slide-out');
  fp.classList.add('slide-in');
  fp.addEventListener('animationend', () => fp.classList.remove('slide-in'), { once: true });
}

function closeFullPlayer() {
  const fp = document.getElementById('full-player');
  fp.classList.add('slide-out');
  fp.addEventListener('animationend', () => {
    fp.classList.add('hidden');
    fp.classList.remove('slide-out');
  }, { once: true });
}

/* ─────────────────────────────────────────────
   13. MODALS
───────────────────────────────────────────── */
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}
function closeModal(id) {
  const m = document.getElementById(id);
  m.classList.add('hidden');
}

// Close on overlay or cancel button
document.querySelectorAll('[data-close]').forEach(el => {
  el.addEventListener('click', () => closeModal(el.dataset.close));
});

/* ─────────────────────────────────────────────
   14. ADD MUSIC FORM
───────────────────────────────────────────── */
let pendingAudioFile  = null;
let pendingCoverFile  = null;

function openAddMusicModal(target = null) {
  state.addMusicTarget = target;
  pendingAudioFile = null;
  pendingCoverFile = null;

  // Reset form
  document.getElementById('track-title-input').value  = '';
  document.getElementById('track-artist-input').value = '';
  document.getElementById('audio-file-label').textContent = 'Choisir un fichier MP3';
  document.getElementById('audio-drop-zone').classList.remove('has-file');

  const coverPrev = document.getElementById('cover-preview');
  coverPrev.classList.add('hidden');
  document.getElementById('cover-drop-icon').style.display = '';
  document.getElementById('cover-drop-text').textContent = 'Ajouter une cover (optionnel)';
  document.getElementById('cover-drop-zone').classList.remove('has-file');

  // Populate album select
  const sel = document.getElementById('album-select');
  sel.innerHTML = '<option value="">— Aucun album —</option>';
  state.albums.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name;
    sel.appendChild(opt);
  });
  if (target?.type === 'album') sel.value = target.id;

  openModal('modal-add-music');
}

// Audio file input
document.getElementById('audio-drop-zone').addEventListener('click', () => {
  document.getElementById('audio-file-input').click();
});
document.getElementById('audio-file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  pendingAudioFile = file;
  document.getElementById('audio-file-label').textContent = file.name;
  document.getElementById('audio-drop-zone').classList.add('has-file');

  // Auto-fill title
  const titleInput = document.getElementById('track-title-input');
  if (!titleInput.value) {
    titleInput.value = file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  }
});

// Cover file input
document.getElementById('cover-drop-zone').addEventListener('click', () => {
  document.getElementById('cover-file-input').click();
});
document.getElementById('cover-file-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  pendingCoverFile = file;
  const url = await fileToDataURL(file);
  const prev = document.getElementById('cover-preview');
  prev.src = url;
  prev.classList.remove('hidden');
  document.getElementById('cover-drop-icon').style.display = 'none';
  document.getElementById('cover-drop-text').textContent = 'Cover sélectionnée ✓';
  document.getElementById('cover-drop-zone').classList.add('has-file');
});

// Save track
document.getElementById('save-track-btn').addEventListener('click', async () => {
  const title  = document.getElementById('track-title-input').value.trim();
  const artist = document.getElementById('track-artist-input').value.trim();
  const albumId = document.getElementById('album-select').value || null;

  if (!pendingAudioFile) { showToast('Veuillez choisir un fichier audio'); return; }
  if (!title) { showToast('Le titre est requis'); return; }

  const btn = document.getElementById('save-track-btn');
  btn.disabled = true;
  btn.textContent = 'Ajout…';

  try {
    const audioData  = await fileToArrayBuffer(pendingAudioFile);
    const duration   = await getAudioDuration(audioData, pendingAudioFile.type);
    const coverData  = pendingCoverFile ? await fileToDataURL(pendingCoverFile) : null;

    const track = {
      id: uid(), title, artist, albumId,
      audioData, audioMime: pendingAudioFile.type,
      coverData, duration,
      dateAdded: Date.now(),
    };

    await dbPut('tracks', track);
    state.tracks.push(track);

    // If adding to a playlist via target
    if (state.addMusicTarget?.type === 'playlist') {
      const pl = state.playlists.find(p => p.id === state.addMusicTarget.id);
      if (pl) {
        pl.trackIds = pl.trackIds || [];
        if (!pl.trackIds.includes(track.id)) pl.trackIds.push(track.id);
        await dbPut('playlists', pl);
      }
    }

    closeModal('modal-add-music');
    showToast('Musique ajoutée ✓');
    refreshAll();

    // Re-open detail if we were inside one
    if (state.addMusicTarget) {
      openDetail(state.addMusicTarget.type, state.addMusicTarget.id);
    }
  } catch (err) {
    console.error(err);
    showToast('Erreur lors de l\'ajout');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ajouter';
  }
});

/* ─────────────────────────────────────────────
   15. CREATE ALBUM
───────────────────────────────────────────── */
let pendingAlbumCoverFile = null;

document.getElementById('album-cover-zone').addEventListener('click', () => {
  document.getElementById('album-cover-input').click();
});
document.getElementById('album-cover-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  pendingAlbumCoverFile = file;
  const url = await fileToDataURL(file);
  const prev = document.getElementById('album-cover-preview');
  prev.src = url;
  prev.classList.remove('hidden');
  document.getElementById('album-cover-drop-icon').style.display = 'none';
  document.getElementById('album-cover-drop-text').textContent = 'Pochette sélectionnée ✓';
  document.getElementById('album-cover-zone').classList.add('has-file');
});

function openCreateAlbumModal() {
  pendingAlbumCoverFile = null;
  document.getElementById('album-name-input').value   = '';
  document.getElementById('album-artist-input').value = '';
  const prev = document.getElementById('album-cover-preview');
  prev.classList.add('hidden');
  document.getElementById('album-cover-drop-icon').style.display = '';
  document.getElementById('album-cover-drop-text').textContent = 'Ajouter une pochette';
  document.getElementById('album-cover-zone').classList.remove('has-file');
  openModal('modal-create-album');
}

document.getElementById('create-album-btn').addEventListener('click', openCreateAlbumModal);

document.getElementById('save-album-btn').addEventListener('click', async () => {
  const name   = document.getElementById('album-name-input').value.trim();
  const artist = document.getElementById('album-artist-input').value.trim();
  if (!name) { showToast('Nom requis'); return; }

  const coverData = pendingAlbumCoverFile ? await fileToDataURL(pendingAlbumCoverFile) : null;
  const album = { id: uid(), name, artist, coverData, dateCreated: Date.now() };
  await dbPut('albums', album);
  state.albums.push(album);

  closeModal('modal-create-album');
  showToast('Album créé ✓');
  refreshAll();
});

/* ─────────────────────────────────────────────
   16. CREATE PLAYLIST
───────────────────────────────────────────── */
document.getElementById('create-playlist-btn').addEventListener('click', () => {
  document.getElementById('playlist-name-input').value = '';
  openModal('modal-create-playlist');
});

document.getElementById('save-playlist-btn').addEventListener('click', async () => {
  const name = document.getElementById('playlist-name-input').value.trim();
  if (!name) { showToast('Nom requis'); return; }

  const pl = { id: uid(), name, trackIds: [], dateCreated: Date.now() };
  await dbPut('playlists', pl);
  state.playlists.push(pl);

  closeModal('modal-create-playlist');
  showToast('Playlist créée ✓');
  refreshAll();
});

/* ─────────────────────────────────────────────
   17. CONTEXT MENU (Track)
───────────────────────────────────────────── */
let contextTrackId = null;
let contextParent  = null; // { type, id }

function openContextMenu(trackId, parent = null) {
  contextTrackId = trackId;
  contextParent  = parent;
  const track = state.tracks.find(t => t.id === trackId);
  if (!track) return;

  // Track info header
  document.getElementById('ctx-title').textContent  = track.title;
  document.getElementById('ctx-artist').textContent = track.artist || 'Inconnu';
  const ctxCover  = document.getElementById('ctx-cover');
  const ctxCoverPh = document.getElementById('ctx-cover-ph');
  if (track.coverData) {
    ctxCover.src = track.coverData;
    ctxCover.classList.remove('hidden');
    ctxCoverPh.style.display = 'none';
  } else {
    ctxCover.classList.add('hidden');
    ctxCoverPh.style.display = '';
  }

  // Menu items
  const isFav = state.favorites.has(trackId);
  const menuList = document.getElementById('context-menu-list');
  menuList.innerHTML = `
    <div class="ctx-menu-item" data-action="play">
      <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
      Écouter
    </div>
    <div class="ctx-menu-item" data-action="favorite">
      <svg viewBox="0 0 24 24" fill="${isFav ? 'var(--accent)' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      ${isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
    </div>
    <div class="ctx-menu-item" data-action="playlist">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      Ajouter à une playlist
    </div>
    ${parent?.type === 'playlist' ? `
    <div class="ctx-menu-item danger" data-action="remove-from-playlist">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      Retirer de la playlist
    </div>` : ''}
    <div class="ctx-menu-item danger" data-action="delete">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a1,1,0,0,1,1-1h4a1,1,0,0,1,1,1v2"/></svg>
      Supprimer
    </div>
  `;

  menuList.querySelectorAll('.ctx-menu-item').forEach(item => {
    item.addEventListener('click', () => handleContextAction(item.dataset.action));
  });

  openModal('modal-context');
}

async function handleContextAction(action) {
  closeModal('modal-context');
  const track = state.tracks.find(t => t.id === contextTrackId);
  if (!track) return;

  switch (action) {
    case 'play': {
      const idx = state.tracks.findIndex(t => t.id === contextTrackId);
      playFromQueue(state.tracks.map(t => t.id), idx);
      break;
    }
    case 'favorite': {
      if (state.favorites.has(contextTrackId)) {
        state.favorites.delete(contextTrackId);
        showToast('Retiré des favoris');
      } else {
        state.favorites.add(contextTrackId);
        showToast('Ajouté aux favoris ♥');
      }
      saveFavorites();
      if (getCurrentTrack()?.id === contextTrackId) {
        document.getElementById('fp-fav-btn').classList.toggle('active', state.favorites.has(contextTrackId));
      }
      break;
    }
    case 'playlist': {
      openAddToPlaylistPicker(contextTrackId);
      break;
    }
    case 'remove-from-playlist': {
      const pl = state.playlists.find(p => p.id === contextParent.id);
      if (pl) {
        pl.trackIds = (pl.trackIds || []).filter(id => id !== contextTrackId);
        await dbPut('playlists', pl);
        showToast('Retiré de la playlist');
        openDetail('playlist', pl.id);
        refreshAll();
      }
      break;
    }
    case 'delete': {
      await dbDelete('tracks', contextTrackId);
      state.tracks = state.tracks.filter(t => t.id !== contextTrackId);
      // Remove from playlists
      for (const pl of state.playlists) {
        if (pl.trackIds?.includes(contextTrackId)) {
          pl.trackIds = pl.trackIds.filter(id => id !== contextTrackId);
          await dbPut('playlists', pl);
        }
      }
      // If currently playing, skip
      if (getCurrentTrack()?.id === contextTrackId) playNext();
      showToast('Musique supprimée');
      refreshAll();
      if (contextParent) openDetail(contextParent.type, contextParent.id);
      break;
    }
  }
}

function openAddToPlaylistPicker(trackId) {
  const list = document.getElementById('playlist-picker-list');
  if (!state.playlists.length) {
    list.innerHTML = '<p style="padding:16px;color:var(--text3)">Aucune playlist. Créez-en une d\'abord.</p>';
  } else {
    list.innerHTML = state.playlists.map(pl => `
      <div class="picker-item" data-id="${pl.id}">
        <div class="picker-item-cover">
          ${pl.coverData ? `<img src="${pl.coverData}" alt="" />` : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/></svg>`}
        </div>
        <div>
          <div class="picker-item-name">${escHtml(pl.name)}</div>
          <div class="picker-item-count">${(pl.trackIds || []).length} titres</div>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.picker-item').forEach(el => {
      el.addEventListener('click', async () => {
        const pl = state.playlists.find(p => p.id === el.dataset.id);
        if (!pl) return;
        pl.trackIds = pl.trackIds || [];
        if (pl.trackIds.includes(trackId)) {
          showToast('Déjà dans cette playlist');
        } else {
          pl.trackIds.push(trackId);
          await dbPut('playlists', pl);
          showToast(`Ajouté à "${pl.name}" ✓`);
        }
        closeModal('modal-add-to-playlist');
        refreshAll();
      });
    });
  }
  openModal('modal-add-to-playlist');
}

/* ─────────────────────────────────────────────
   18. ITEM CONTEXT MENU (Album / Playlist)
───────────────────────────────────────────── */
function openItemContextMenu(type, id) {
  const item = type === 'album'
    ? state.albums.find(a => a.id === id)
    : state.playlists.find(p => p.id === id);
  if (!item) return;

  document.getElementById('ctx-title').textContent   = item.name;
  document.getElementById('ctx-artist').textContent  = type === 'album' ? 'Album' : 'Playlist';
  document.getElementById('ctx-cover').classList.add('hidden');
  document.getElementById('ctx-cover-ph').style.display = '';

  const menuList = document.getElementById('context-menu-list');
  menuList.innerHTML = `
    <div class="ctx-menu-item danger" data-action="delete-item">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a1,1,0,0,1,1-1h4a1,1,0,0,1,1,1v2"/></svg>
      Supprimer ${type === 'album' ? 'l\'album' : 'la playlist'}
    </div>
  `;

  menuList.querySelector('[data-action="delete-item"]').addEventListener('click', async () => {
    closeModal('modal-context');
    if (type === 'album') {
      await dbDelete('albums', id);
      state.albums = state.albums.filter(a => a.id !== id);
      showToast('Album supprimé');
    } else {
      await dbDelete('playlists', id);
      state.playlists = state.playlists.filter(p => p.id !== id);
      showToast('Playlist supprimée');
    }
    closeDetail();
    refreshAll();
  });

  openModal('modal-context');
}

/* ─────────────────────────────────────────────
   19. SEARCH
───────────────────────────────────────────── */
let searchToggled = false;

document.getElementById('search-toggle-btn').addEventListener('click', () => {
  searchToggled = !searchToggled;
  const wrapper = document.getElementById('search-bar-wrapper');
  wrapper.classList.toggle('hidden', !searchToggled);
  if (searchToggled) {
    document.getElementById('search-input').focus();
    // Push content down
    document.getElementById('main-content').style.paddingTop =
      `calc(var(--header-h) + 60px)`;
  } else {
    document.getElementById('main-content').style.paddingTop = '';
    document.getElementById('search-results').classList.add('hidden');
    document.getElementById('search-input').value = '';
  }
});

document.getElementById('search-input').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  const clear = document.getElementById('search-clear');
  clear.classList.toggle('hidden', !q);
  performSearch(q);
});

document.getElementById('search-clear').addEventListener('click', () => {
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').classList.add('hidden');
  document.getElementById('search-results').classList.add('hidden');
});

function performSearch(query) {
  const results = document.getElementById('search-results');
  if (!query) { results.classList.add('hidden'); return; }

  const matches = state.tracks.filter(t =>
    t.title.toLowerCase().includes(query) ||
    (t.artist || '').toLowerCase().includes(query)
  );

  results.classList.remove('hidden');

  if (!matches.length) {
    results.innerHTML = '<div class="empty-hint" style="padding:16px">Aucun résultat</div>';
    return;
  }

  results.innerHTML = `<div class="track-list">${matches.map(t => buildTrackItem(t)).join('')}</div>`;
  bindTrackItemEvents(results, matches);
}

/* ─────────────────────────────────────────────
   20. NAVIGATION TABS
───────────────────────────────────────────── */
let activeTab = 'tab-home';

function switchTab(tabId) {
  if (activeTab === tabId) return;
  activeTab = tabId;

  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.getElementById(tabId)?.classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });

  if (tabId === 'tab-albums')    renderAlbums();
  if (tabId === 'tab-playlists') renderPlaylists();
  if (tabId === 'tab-library')   renderLibrary();
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
document.querySelectorAll('.see-all-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

/* ─────────────────────────────────────────────
   21. PLAYER CONTROLS WIRING
───────────────────────────────────────────── */
// Mini player expand
document.getElementById('mini-player-expand').addEventListener('click', openFullPlayer);

// Mini controls
document.getElementById('mini-play').addEventListener('click', e => {
  e.stopPropagation(); togglePlayPause();
});
document.getElementById('mini-prev').addEventListener('click', e => {
  e.stopPropagation(); playPrev();
});
document.getElementById('mini-next').addEventListener('click', e => {
  e.stopPropagation(); playNext();
});

// Full player close
document.getElementById('fp-close').addEventListener('click', closeFullPlayer);

// Full player play/pause
document.getElementById('fp-play').addEventListener('click', togglePlayPause);
document.getElementById('fp-prev').addEventListener('click', playPrev);
document.getElementById('fp-next').addEventListener('click', playNext);

// Seek
const fpSeek = document.getElementById('fp-seek');
let seekDragging = false;
fpSeek.addEventListener('mousedown',  () => seekDragging = true);
fpSeek.addEventListener('touchstart', () => seekDragging = true, { passive: true });
fpSeek.addEventListener('mouseup',  applySeeked);
fpSeek.addEventListener('touchend', applySeeked);
fpSeek.addEventListener('input', e => {
  fpSeek.style.setProperty('--progress', e.target.value + '%');
});
function applySeeked() {
  seekDragging = false;
  if (audioEl.duration) audioEl.currentTime = (fpSeek.value / 100) * audioEl.duration;
}

// Volume
document.getElementById('fp-volume').addEventListener('input', e => {
  audioEl.volume = e.target.value;
});

// Shuffle
document.getElementById('fp-shuffle').addEventListener('click', () => {
  state.shuffle = !state.shuffle;
  document.getElementById('fp-shuffle').classList.toggle('active', state.shuffle);
  showToast(state.shuffle ? 'Lecture aléatoire activée' : 'Lecture aléatoire désactivée');
});

// Repeat
document.getElementById('fp-repeat').addEventListener('click', () => {
  const modes = ['none', 'all', 'one'];
  const idx = modes.indexOf(state.repeat);
  state.repeat = modes[(idx + 1) % modes.length];
  const btn = document.getElementById('fp-repeat');
  btn.classList.toggle('active', state.repeat !== 'none');
  btn.title = state.repeat === 'one' ? 'Répéter ce titre' : state.repeat === 'all' ? 'Répéter la file' : 'Pas de répétition';
  showToast(
    state.repeat === 'one'  ? 'Répéter ce titre' :
    state.repeat === 'all'  ? 'Répéter la file'  :
    'Répétition désactivée'
  );
});

// Favorite from full player
document.getElementById('fp-fav-btn').addEventListener('click', () => {
  const t = getCurrentTrack();
  if (!t) return;
  if (state.favorites.has(t.id)) {
    state.favorites.delete(t.id);
    document.getElementById('fp-fav-btn').classList.remove('active');
    showToast('Retiré des favoris');
  } else {
    state.favorites.add(t.id);
    document.getElementById('fp-fav-btn').classList.add('active');
    showToast('Ajouté aux favoris ♥');
  }
  saveFavorites();
});

// More from full player → context menu
document.getElementById('fp-more-btn').addEventListener('click', () => {
  const t = getCurrentTrack();
  if (t) openContextMenu(t.id);
});

// Detail back button
document.getElementById('detail-back').addEventListener('click', closeDetail);

// Header add button
document.getElementById('add-music-header-btn').addEventListener('click', () => openAddMusicModal());

/* ─────────────────────────────────────────────
   22. SCROLL HEADER EFFECT
───────────────────────────────────────────── */
let lastScrollY = 0;
document.getElementById('main-content').addEventListener('scroll', e => {
  const y = e.target.scrollTop;
  document.getElementById('app-header').classList.toggle('scrolled', y > 10);
  lastScrollY = y;
}, { passive: true });

/* ─────────────────────────────────────────────
   23. SORT BAR
───────────────────────────────────────────── */
document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    librarySortMode = btn.dataset.sort;
    renderLibrary();
  });
});

/* ─────────────────────────────────────────────
   24. HELPER: escHtml
───────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ─────────────────────────────────────────────
   25. REFRESH ALL VIEWS
───────────────────────────────────────────── */
function refreshAll() {
  renderHome();
  if (activeTab === 'tab-albums')    renderAlbums();
  if (activeTab === 'tab-playlists') renderPlaylists();
  if (activeTab === 'tab-library')   renderLibrary();
}

/* ─────────────────────────────────────────────
   26. MEDIA SESSION API (background playback)
───────────────────────────────────────────── */
function updateMediaSession(track) {
  if (!('mediaSession' in navigator) || !track) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title:  track.title,
    artist: track.artist || 'Inconnu',
    album:  '',
    artwork: track.coverData
      ? [{ src: track.coverData, type: 'image/jpeg' }]
      : [],
  });
  navigator.mediaSession.setActionHandler('play',         () => { audioEl.play(); state.isPlaying = true; setPlayPauseUI(true); });
  navigator.mediaSession.setActionHandler('pause',        () => { audioEl.pause(); state.isPlaying = false; setPlayPauseUI(false); });
  navigator.mediaSession.setActionHandler('previoustrack', playPrev);
  navigator.mediaSession.setActionHandler('nexttrack',     playNext);
}

audioEl.addEventListener('play',  () => {
  const t = getCurrentTrack();
  if (t) updateMediaSession(t);
});

/* ─────────────────────────────────────────────
   27. LAST PLAYED RESTORATION
───────────────────────────────────────────── */
async function restoreLastPlayed() {
  const last = loadLastPlayed();
  if (!last) return;
  const track = state.tracks.find(t => t.id === last.trackId);
  if (!track) return;

  buildQueue(state.tracks.map(t => t.id), state.tracks.findIndex(t => t.id === last.trackId));
  await loadTrack(track);
  if (last.time > 0 && isFinite(last.time)) {
    audioEl.currentTime = last.time;
  }
  updatePlayerUI(track);
  document.getElementById('mini-player').classList.remove('hidden', 'hide');
}

/* ─────────────────────────────────────────────
   28. SERVICE WORKER
───────────────────────────────────────────── */
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

/* ─────────────────────────────────────────────
   29. INIT
───────────────────────────────────────────── */
async function init() {
  try {
    await openDB();
    state.tracks    = await dbGetAll('tracks');
    state.albums    = await dbGetAll('albums');
    state.playlists = await dbGetAll('playlists');
    loadFavorites();
  } catch (err) {
    console.error('DB init error:', err);
  }

  // Render initial view
  renderHome();

  // Restore last played (load only, don't auto-play)
  await restoreLastPlayed();

  // Hide splash
  setTimeout(() => {
    document.getElementById('splash').classList.add('fade-out');
  }, 900);

  registerSW();
}

document.addEventListener('DOMContentLoaded', init);

/* ─────────────────────────────────────────────
   30. KEYBOARD SHORTCUTS (desktop bonus)
───────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  // Don't intercept when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlayPause(); }
  if (e.code === 'ArrowRight') playNext();
  if (e.code === 'ArrowLeft')  playPrev();
  if (e.code === 'Escape') {
    const fp = document.getElementById('full-player');
    if (!fp.classList.contains('hidden')) closeFullPlayer();
    const dv = document.getElementById('detail-view');
    if (!dv.classList.contains('hidden')) closeDetail();
  }
});
