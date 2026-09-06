// Landing overlay: live status + the number to call. Hides itself when the storybook opens.
(function () {
  const $ = (id) => document.getElementById(id);
  const landing = $('landing');
  const statusEl = $('status');
  const statusText = $('status-text');

  function setStatus(kind, text) {
    statusEl.className = 'status ' + kind;
    statusText.textContent = text;
  }

  fetch('/api/info')
    .then((r) => r.json())
    .then((info) => {
      $('phone').textContent = info.phoneFormatted || info.phone || 'number not set';
      $('phone-mini').textContent = info.phoneFormatted || info.phone || '';
      document.title = `Once Upon a Call — ${info.childName}'s storybook`;
    })
    .catch(() => ($('phone').textContent = 'number not set'));

  // Remember the auto-answer preference for little ones
  const auto = $('autoanswer');
  try {
    auto.checked = localStorage.getItem('ouac-autoanswer') === '1';
  } catch (e) {}
  auto.addEventListener('change', () => {
    try {
      localStorage.setItem('ouac-autoanswer', auto.checked ? '1' : '0');
    } catch (e) {}
  });
  window.OUAC = { autoAnswer: () => auto.checked };

  if (typeof io !== 'undefined') {
    const socket = io();
    socket.on('connect', () => setStatus('waiting', 'Ready — waiting for a story call'));
    socket.on('disconnect', () => setStatus('error', 'Server disconnected'));
    socket.on('state', (s) => {
      if (s.inCall) setStatus('live', `Story time — page ${s.page + 1} of ${s.totalPages}`);
      else setStatus('waiting', s.recordings ? `Ready — ${s.recordings} saved stor${s.recordings === 1 ? 'y' : 'ies'}` : 'Ready — waiting for a story call');
    });
    socket.on('recording', () => setStatus('saved', "Tonight's story is saved"));
    // The parent may have picked a different book on their keypad.
    socket.on('story', (st) => {
      loadShelf();
      loadKeyLegend();
      setStatus('live', `Tonight: ${st.title}`);
    });
  }

  // Slim top bar once the scene is live (simulator starts immediately on laptops)
  const toggle = $('toggle-landing');
  function setCompact(on) {
    landing.classList.toggle('compact', on);
    toggle.textContent = on ? '▾ Guide' : '▴ Close';
    toggle.setAttribute('aria-expanded', String(!on));
  }
  toggle.addEventListener('click', () => setCompact(!landing.classList.contains('compact')));
  setCompact(landing.classList.contains('compact'));     // sync the label with the real state on load
  const autoCollapse = setTimeout(() => setCompact(true), 6000); // a look, then get out of the way
  // Someone reading the guide is not someone who wants it yanked away mid-sentence.
  landing.addEventListener('pointerdown', () => clearTimeout(autoCollapse), { once: true });
  window.addEventListener('ouac:ring', () => setCompact(true));

  const preview = $('preview-btn');

  // ---- the shelf ----
  // A caregiver sets this up before the call; the parent can still override it from their
  // keypad once connected, which is why the buttons re-render on the server's 'story' event.
  const GLYPH = { dragon: '🐉', rabbit: '🐰', boat: '⛵' };
  const shelf = $('story-list');
  let shelfBusy = false;

  function renderShelf(data) {
    shelf.innerHTML = '';
    for (const st of data.stories) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'book';
      b.setAttribute('aria-pressed', String(st.id === data.active));
      b.innerHTML = `<span class="glyph" aria-hidden="true">${GLYPH[st.character] || '📖'}</span><span>${st.title}</span>`;
      b.addEventListener('click', () => selectStory(st.id));
      shelf.appendChild(b);
    }
  }

  // Each story names its own 1/2/3 — the dragon roars, the boat sounds its foghorn — so the
  // printed legend has to follow whichever book is on the shelf tonight.
  async function loadKeyLegend() {
    const list = $('keys');
    if (!list) return;
    let story;
    try {
      story = await (await fetch('/api/story')).json();
    } catch (e) {
      return;
    }
    [...list.querySelectorAll('li[data-fx]')].forEach((li) => li.remove());
    for (const [key, fx] of Object.entries(story.effects || {})) {
      const li = document.createElement('li');
      li.dataset.fx = key;
      li.innerHTML = `<kbd>${key}</kbd><span></span>`;
      li.querySelector('span').textContent = fx.label;
      list.appendChild(li);
    }
  }

  async function loadShelf() {
    try {
      renderShelf(await (await fetch('/api/stories')).json());
    } catch (e) {
      shelf.innerHTML = '<span class="try-hint">Could not load the shelf.</span>';
    }
  }

  async function selectStory(id) {
    if (shelfBusy) return;
    shelfBusy = true;
    try {
      const r = await fetch('/api/story/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (r.status === 409) setStatus('live', 'A story is being read — choose the next one after the call');
      await Promise.all([loadShelf(), loadKeyLegend()]);
    } catch (e) {
      /* leave the shelf as it was */
    } finally {
      shelfBusy = false;
    }
  }
  loadShelf();
  loadKeyLegend();

  // XR Blocks injects its own "OPEN THE STORYBOOK" button; hide the landing when it's pressed.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn === preview) return;
    if (btn && /storybook|end/i.test(btn.textContent)) landing.classList.add('hidden');
  });
  window.addEventListener('ouac:ring', () => setStatus('ringing', 'Incoming story call…'));

  // "Watch the story" — the tour for anyone who has no second phone to call from.
  // The scene lives underneath this overlay, so get the overlay out of the way first.
  preview.addEventListener('click', () => {
    setCompact(true);
    window.dispatchEvent(new Event('ouac:preview'));
  });
  window.addEventListener('ouac:preview-start', () => {
    preview.disabled = true;
    preview.textContent = '▶ Playing…';
    setStatus('live', 'Preview — this is what the child sees');
  });
  window.addEventListener('ouac:preview-end', () => {
    preview.disabled = false;
    preview.textContent = '▶ Watch again';
    setStatus('waiting', 'Ready — waiting for a story call');
  });
})();
