// Storybook.js — an AR picture book drawn on a canvas texture.
// Left page: a living illustration (procedural, no assets to load).
// Right page: the story text, with words lighting up as the parent reads them.
//
// Public API (used by VonageAudioCall.js):
//   book.setPage(i)              -> show page i (0-based)
//   book.highlightUpTo(n)        -> first n words of the page glow
//   book.trigger(effectName)     -> run an illustration effect ('dragon-fly', 'stars-twinkle', ...)
//   book.setBanner(text)         -> small caption under the book ("Dad is reading...")
//   book.update(dt)              -> call every frame
import * as THREE from 'three';

const W = 1600;   // canvas px (two pages side by side)
const H = 1000;
const PAGE_W = 1.3; // metres
const PAGE_H = PAGE_W * (H / W);

// Scene name -> backdrop. Stories name a scene per page; the art lives here rather than in the
// story files, so writing a new story stays a writing job instead of a drawing job.
const SCENES = {
  cave:    { top: '#1b2a5a', bottom: '#3b2a1a', stars: 12, moon: false, ground: 'cave',   groundColor: '#4a3524' },
  stars:   { top: '#1b2a5a', bottom: '#2c3e7a', stars: 40, moon: true,  ground: 'hill',   groundColor: '#22335f' },
  moon:    { top: '#1b2a5a', bottom: '#2c3e7a', stars: 40, moon: true,  ground: 'hill',   groundColor: '#22335f' },
  sleep:   { top: '#0b1030', bottom: '#2c3e7a', stars: 40, moon: true,  ground: 'hill',   groundColor: '#1a2749', sleepy: true },
  meadow:  { top: '#1b2a5a', bottom: '#24406a', stars: 30, moon: true,  ground: 'meadow', groundColor: '#2f5f3c' },
  burrow:  { top: '#1b2a5a', bottom: '#2e2418', stars: 10, moon: false, ground: 'burrow', groundColor: '#4a3524' },
  sea:     { top: '#16264f', bottom: '#0e3a5a', stars: 35, moon: true,  ground: 'water',  groundColor: '#123048' },
  storm:   { top: '#0d1430', bottom: '#123048', stars: 0,  moon: false, ground: 'water',  groundColor: '#0e2438', storm: true },
  harbour: { top: '#1b2a5a', bottom: '#2c3e7a', stars: 30, moon: true,  ground: 'water',  groundColor: '#123048', harbourLights: true },
};

export class Storybook extends THREE.Group {
  constructor(story) {
    super();
    this.story = story;
    this.pageIndex = 0;
    this.spoken = 0;
    this.banner = '';
    this.effects = {};        // name -> remaining seconds
    this.time = 0;
    this.flip = 0;            // page-turn animation 0..1

    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PAGE_W, PAGE_H), mat);
    this.add(this.mesh);

    // A soft "cover" behind the pages so it reads as a book in AR
    const cover = new THREE.Mesh(
      new THREE.PlaneGeometry(PAGE_W + 0.04, PAGE_H + 0.04),
      new THREE.MeshBasicMaterial({ color: 0x7a3e2f })
    );
    cover.position.z = -0.005;
    this.add(cover);

    // Floating star the child can "send" (decorative — the button does the sending)
    this.star = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.035, 0),
      new THREE.MeshBasicMaterial({ color: 0xffd54a })
    );
    this.star.position.set(PAGE_W / 2 + 0.12, PAGE_H / 2, 0.02);
    this.add(this.star);

    this.draw();
  }

  get page() {
    return this.story.pages[this.pageIndex];
  }

  get words() {
    return this.page.text.split(/\s+/);
  }

  setPage(i) {
    const next = Math.max(0, Math.min(i, this.story.pages.length - 1));
    if (next !== this.pageIndex) this.flip = 1;
    this.pageIndex = next;
    this.spoken = 0;
    this.effects = {};
    this.draw();
  }

  highlightUpTo(n) {
    this.spoken = Math.max(0, Math.min(n, this.words.length));
    this.draw();
  }

  trigger(name, seconds = 2.5) {
    this.effects[name] = seconds;
  }

  setBanner(text) {
    this.banner = text;
    this.draw();
  }

  // Live caption of what the parent just said (accessibility for hard-of-hearing children)
  setCaption(text) {
    const next = String(text || '').slice(-90);
    if (next === this.caption) return;
    this.caption = next;
    // No draw() here on purpose: interim speech results arrive several times a second and
    // update() already repaints at ~12fps, which is smooth enough to read.
  }

  update(dt) {
    this.time += dt;
    let dirty = false;
    for (const k of Object.keys(this.effects)) {
      this.effects[k] -= dt;
      if (this.effects[k] <= 0) delete this.effects[k];
      dirty = true;
    }
    if (this.flip > 0) {
      this.flip = Math.max(0, this.flip - dt * 3);
      this.mesh.scale.x = 0.2 + 0.8 * (1 - this.flip);
      dirty = true;
    }
    // Always-on gentle motion (stars twinkle, dragon breathes) at low cost: redraw ~12 fps
    this._acc = (this._acc || 0) + dt;
    if (this._acc > 1 / 12) {
      this._acc = 0;
      dirty = true;
    }
    this.star.rotation.y += dt * 1.5;
    this.star.position.y = PAGE_H / 2 + Math.sin(this.time * 2) * 0.01;
    if (dirty) this.draw();
  }

  // ---------------- drawing ----------------
  draw() {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);

    // paper
    c.fillStyle = '#fbf5e6';
    this.roundRect(c, 0, 0, W, H, 28);
    c.fill();
    // spine shadow
    const g = c.createLinearGradient(W / 2 - 40, 0, W / 2 + 40, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(W / 2 - 40, 0, 80, H);

    this.drawIllustration(c, 60, 60, W / 2 - 120, H - 200);
    this.drawText(c, W / 2 + 70, 110, W / 2 - 150);

    // page number + banner
    c.fillStyle = '#8a7b63';
    c.font = '32px Georgia, serif';
    c.textAlign = 'right';
    c.fillText(`${this.pageIndex + 1} / ${this.story.pages.length}`, W - 60, H - 50);
    c.textAlign = 'left';
    c.font = 'italic 34px Georgia, serif';
    c.fillStyle = '#6b5b45';
    c.fillText(this.banner, 70, H - 50);

    // caption strip (what the parent just said), right page bottom
    if (this.caption) {
      c.fillStyle = 'rgba(26,26,46,0.85)';
      this.roundRect(c, W / 2 + 60, H - 150, W / 2 - 120, 70, 14);
      c.fill();
      c.fillStyle = '#fff7e6';
      c.font = '30px system-ui, sans-serif';
      c.textBaseline = 'middle';
      c.fillText('“' + this.caption + '”', W / 2 + 80, H - 115);
      c.textBaseline = 'top';
    }

    this.texture.needsUpdate = true;
  }

  drawText(c, x, y, maxW) {
    const words = this.words;
    c.font = '54px Georgia, serif';
    c.textAlign = 'left';
    c.textBaseline = 'top';
    const lineH = 78;
    let cx = x, cy = y;
    words.forEach((w, i) => {
      const width = c.measureText(w + ' ').width;
      if (cx + width > x + maxW) {
        cx = x;
        cy += lineH;
      }
      if (i < this.spoken) {
        // glow behind spoken words
        c.fillStyle = i === this.spoken - 1 ? 'rgba(255,196,0,0.55)' : 'rgba(255,226,120,0.45)';
        this.roundRect(c, cx - 6, cy - 6, width - 4, lineH - 14, 12);
        c.fill();
        c.fillStyle = '#2b1d0e';
      } else {
        c.fillStyle = '#5c4a33';
      }
      c.fillText(w, cx, cy);
      cx += width;
    });
    // title on page 1
    if (this.pageIndex === 0) {
      c.font = 'bold 40px Georgia, serif';
      c.fillStyle = '#a0522d';
      c.fillText(this.story.title, x, y - 70);
    }
  }

  // Effects are named per story ("hero-wiggle", "hero-hop", "hero-rock"); the older
  // dragon-specific names still work so nothing that shipped earlier breaks.
  fx(...names) {
    return names.some((n) => this.effects[n]);
  }

  drawIllustration(c, x, y, w, h) {
    const t = this.time;
    const S = SCENES[this.page.scene] || SCENES.stars;
    const dim = this.fx('lights-dim') ? 0.5 : 1;

    // sky
    const sky = c.createLinearGradient(0, y, 0, y + h);
    sky.addColorStop(0, S.top);
    sky.addColorStop(1, S.bottom);
    c.fillStyle = sky;
    this.roundRect(c, x, y, w, h, 24);
    c.fill();
    c.save();
    this.roundRect(c, x, y, w, h, 24);
    c.clip();
    c.globalAlpha = dim;

    // stars
    const twinkling = this.fx('stars-twinkle');
    for (let i = 0; i < S.stars; i++) {
      const sx = x + ((i * 97) % (w - 40)) + 20;
      const sy = y + ((i * 57) % (h / 2)) + 20;
      const tw = twinkling ? 0.5 + 0.5 * Math.sin(t * 12 + i) : 0.6 + 0.4 * Math.sin(t * 2 + i);
      c.fillStyle = `rgba(255,255,220,${tw})`;
      c.beginPath();
      c.arc(sx, sy, 3 + (i % 3), 0, Math.PI * 2);
      c.fill();
    }

    if (S.moon) this.drawMoon(c, x + w * 0.75, y + h * 0.22, S);
    this.drawGround(c, x, y, w, h, S);

    // the story's own character, in the spot the dragon used to sit
    const flying = this.fx('hero-fly', 'dragon-fly');
    const wiggle = this.fx('hero-wiggle', 'hero-hop', 'hero-rock', 'dragon-wiggle') ? Math.sin(t * 20) * 8 : 0;
    const hx = x + w * 0.45 + (flying ? Math.sin(t * 3) * 60 : 0) + wiggle;
    const hy = y + h * (flying ? 0.35 + 0.1 * Math.sin(t * 4) : 0.72) + Math.sin(t * 2) * 4;
    const asleep = this.fx('eyes-close') || S.sleepy;
    const loud = this.fx('roar');
    const character = this.story.character || 'dragon';
    if (character === 'rabbit') this.drawRabbit(c, hx, hy, flying, asleep, loud);
    else if (character === 'boat') this.drawBoat(c, hx, hy, flying, asleep, loud, S);
    else this.drawDragon(c, hx, hy, flying, asleep, loud);

    c.restore();
    c.globalAlpha = 1;
  }

  drawMoon(c, mx, my, S) {
    c.fillStyle = '#fff3b0';
    c.beginPath();
    c.arc(mx, my, 70, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = S.top;
    c.beginPath();
    c.arc(mx - 28, my - 12, 58, 0, Math.PI * 2);
    c.fill();
    if (this.fx('moon-smile') || S.sleepy) {
      c.strokeStyle = '#a58a3c';
      c.lineWidth = 5;
      c.beginPath();
      c.arc(mx + 20, my + 10, 22, 0.15 * Math.PI, 0.85 * Math.PI);
      c.stroke();
    }
  }

  drawGround(c, x, y, w, h, S) {
    const t = this.time;
    if (S.ground === 'water') {
      // rolling sea: three offset sine bands, taller and faster in a storm
      const tops = [0.66, 0.74, 0.84];
      const cols = ['#1d4e6e', '#17415e', '#102f47'];
      if (S.harbourLights) this.drawHarbour(c, x, y, w, h);
      tops.forEach((frac, band) => {
        c.fillStyle = cols[band];
        c.beginPath();
        c.moveTo(x, y + h);
        const amp = (S.storm ? 26 : 10) + band * 4;
        for (let px = 0; px <= w; px += 12) {
          const py = y + h * frac + Math.sin(px / 70 + t * (1.4 + band * 0.5)) * amp;
          c.lineTo(x + px, py);
        }
        c.lineTo(x + w, y + h);
        c.closePath();
        c.fill();
      });
      return;
    }

    // hill / meadow / cave / burrow all share one soft mound
    c.fillStyle = S.groundColor;
    c.beginPath();
    c.ellipse(x + w / 2, y + h + 40, w * 0.7, h * 0.35, 0, Math.PI, 0);
    c.fill();

    if (S.ground === 'meadow') {
      c.strokeStyle = '#3f7a4a';
      c.lineWidth = 3;
      for (let i = 0; i < 26; i++) {
        const gx = x + ((i * 83) % (w - 30)) + 15;
        const gy = y + h * 0.86 + ((i * 29) % 40);
        const lean = Math.sin(t * 1.5 + i) * 5;
        c.beginPath();
        c.moveTo(gx, gy);
        c.quadraticCurveTo(gx + lean, gy - 18, gx + lean * 2, gy - 30);
        c.stroke();
      }
    }
    if (S.ground === 'cave' || S.ground === 'burrow') {
      c.fillStyle = this.fx('cave-glow') ? '#ffb347' : '#1a120b';
      c.beginPath();
      c.ellipse(x + w * 0.5, y + h * 0.78, S.ground === 'burrow' ? 80 : 110, 80, 0, Math.PI, 0);
      c.fill();
    }
  }

  drawHarbour(c, x, y, w, h) {
    // a low shoreline of warm windows — the thing you steer towards
    const base = y + h * 0.7;
    for (let i = 0; i < 14; i++) {
      const bx = x + 20 + i * ((w - 40) / 14);
      const bh = 26 + ((i * 37) % 44);
      c.fillStyle = '#101731';
      c.fillRect(bx, base - bh, 24, bh + 30);
      c.fillStyle = `rgba(255,213,74,${0.55 + 0.45 * Math.sin(this.time * 2 + i)})`;
      c.fillRect(bx + 7, base - bh + 8, 10, 10);
    }
  }

  drawRabbit(c, x, y, hopping, eyesClosed, thumping) {
    c.save();
    c.translate(x, y + (hopping ? -Math.abs(Math.sin(this.time * 6)) * 40 : 0));
    const fur = '#b98b6a';
    const inner = '#e8c4ad';
    // ears
    const twitch = thumping ? Math.sin(this.time * 22) * 10 : Math.sin(this.time * 1.5) * 3;
    [-1, 1].forEach((side) => {
      c.fillStyle = fur;
      c.beginPath();
      c.ellipse(side * 16 + twitch * side * 0.4, -74, 11, 38, side * 0.18, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = inner;
      c.beginPath();
      c.ellipse(side * 16 + twitch * side * 0.4, -74, 5, 26, side * 0.18, 0, Math.PI * 2);
      c.fill();
    });
    // tail, body, belly, head
    c.fillStyle = '#f3e6da';
    c.beginPath(); c.arc(-46, 22, 13, 0, Math.PI * 2); c.fill();
    c.fillStyle = fur;
    c.beginPath(); c.ellipse(0, 14, 46, 38, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#e8d5c4';
    c.beginPath(); c.ellipse(0, 24, 26, 22, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = fur;
    c.beginPath(); c.arc(0, -30, 30, 0, Math.PI * 2); c.fill();
    // eyes
    c.strokeStyle = '#1b1b1b';
    c.fillStyle = '#1b1b1b';
    if (eyesClosed) {
      c.lineWidth = 4;
      c.beginPath(); c.moveTo(-17, -34); c.lineTo(-6, -34); c.stroke();
      c.beginPath(); c.moveTo(6, -34); c.lineTo(17, -34); c.stroke();
    } else {
      c.beginPath(); c.arc(-11, -34, 4.5, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(11, -34, 4.5, 0, Math.PI * 2); c.fill();
    }
    // nose + whiskers
    c.fillStyle = '#d98b8b';
    c.beginPath(); c.ellipse(0, -22, 6, 4.5, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(40,30,25,0.6)';
    c.lineWidth = 2;
    [-1, 1].forEach((side) => {
      [-4, 2].forEach((dy) => {
        c.beginPath();
        c.moveTo(side * 6, -21 + dy);
        c.lineTo(side * 34, -26 + dy * 2);
        c.stroke();
      });
    });
    c.restore();
  }

  drawBoat(c, x, y, sailing, lampLit, horn, S) {
    c.save();
    const roll = Math.sin(this.time * (S.storm ? 3.2 : 1.6)) * (S.storm ? 0.18 : 0.07);
    c.translate(x, y + Math.sin(this.time * 2.2) * (S.storm ? 14 : 5));
    c.rotate(roll);
    // mast + sails
    c.strokeStyle = '#8d6e4f';
    c.lineWidth = 6;
    c.beginPath(); c.moveTo(0, -18); c.lineTo(0, -108); c.stroke();
    c.fillStyle = '#f4ead6';
    c.beginPath();
    c.moveTo(6, -104);
    c.quadraticCurveTo(78 + (sailing ? 14 : 0), -62, 6, -22);
    c.closePath();
    c.fill();
    c.fillStyle = '#e2d3ba';
    c.beginPath();
    c.moveTo(-6, -96);
    c.quadraticCurveTo(-52, -60, -6, -26);
    c.closePath();
    c.fill();
    // hull
    c.fillStyle = '#2f6fa8';
    c.beginPath();
    c.moveTo(-66, -16);
    c.lineTo(66, -16);
    c.quadraticCurveTo(46, 28, 0, 30);
    c.quadraticCurveTo(-46, 28, -66, -16);
    c.closePath();
    c.fill();
    c.fillStyle = '#1f4e77';
    c.fillRect(-66, -16, 132, 8);
    // bow lamp — steady when the story says so, pulsing otherwise
    const glow = lampLit || horn ? 1 : 0.45 + 0.25 * Math.sin(this.time * 3);
    c.fillStyle = `rgba(255,213,74,${glow})`;
    c.beginPath(); c.arc(52, -26, horn ? 12 : 8, 0, Math.PI * 2); c.fill();
    if (horn) {
      c.strokeStyle = 'rgba(255,213,74,0.5)';
      c.lineWidth = 3;
      [22, 34, 46].forEach((r, i) => {
        c.beginPath();
        c.arc(52, -26, r + Math.sin(this.time * 12 + i) * 4, -0.7, 0.7);
        c.stroke();
      });
    }
    c.restore();
  }

  drawDragon(c, x, y, flying, eyesClosed, roaring) {
    c.save();
    c.translate(x, y);
    // wings
    c.fillStyle = '#6fbf73';
    const flap = flying ? Math.sin(this.time * 14) * 30 : Math.sin(this.time * 2) * 5;
    c.beginPath();
    c.moveTo(-10, -20);
    c.quadraticCurveTo(-90, -80 - flap, -110, -10 + flap / 2);
    c.quadraticCurveTo(-60, -20, -10, 0);
    c.fill();
    c.beginPath();
    c.moveTo(10, -20);
    c.quadraticCurveTo(90, -80 - flap, 110, -10 + flap / 2);
    c.quadraticCurveTo(60, -20, 10, 0);
    c.fill();
    // body
    c.fillStyle = '#4caf50';
    c.beginPath();
    c.ellipse(0, 10, 55, 42, 0, 0, Math.PI * 2);
    c.fill();
    // belly
    c.fillStyle = '#c8e6c9';
    c.beginPath();
    c.ellipse(0, 22, 30, 22, 0, 0, Math.PI * 2);
    c.fill();
    // head
    c.fillStyle = '#4caf50';
    c.beginPath();
    c.arc(0, -40, 34, 0, Math.PI * 2);
    c.fill();
    // eyes
    c.fillStyle = '#1b1b1b';
    if (eyesClosed) {
      c.lineWidth = 4;
      c.strokeStyle = '#1b1b1b';
      c.beginPath(); c.moveTo(-18, -44); c.lineTo(-6, -44); c.stroke();
      c.beginPath(); c.moveTo(6, -44); c.lineTo(18, -44); c.stroke();
    } else {
      c.beginPath(); c.arc(-12, -44, 5, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(12, -44, 5, 0, Math.PI * 2); c.fill();
    }
    // mouth / roar
    if (roaring) {
      c.fillStyle = '#ff7043';
      c.beginPath();
      c.ellipse(0, -24, 14, 10, 0, 0, Math.PI * 2);
      c.fill();
      // little flame
      c.fillStyle = 'rgba(255,152,0,0.9)';
      c.beginPath();
      c.moveTo(14, -24);
      c.lineTo(70 + Math.sin(this.time * 30) * 10, -34);
      c.lineTo(60, -20);
      c.lineTo(75, -12);
      c.lineTo(14, -18);
      c.fill();
    } else {
      c.strokeStyle = '#1b1b1b';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(0, -30, 10, 0.1 * Math.PI, 0.9 * Math.PI);
      c.stroke();
    }
    // tiny horns
    c.fillStyle = '#ffd54a';
    c.beginPath(); c.moveTo(-22, -62); c.lineTo(-14, -80); c.lineTo(-8, -60); c.fill();
    c.beginPath(); c.moveTo(22, -62); c.lineTo(14, -80); c.lineTo(8, -60); c.fill();
    c.restore();
  }

  roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
}
