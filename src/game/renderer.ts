import { LEAD_IN, type Game, type LiveNote } from './game';
import { JUDGE_STYLE, LANE_COLORS, type Effects } from './effects';
import { computeLayout, laneX, readSafeBottom, scaleAt, yAt, type Layout } from './layout';
import { LANES } from './types';

const FONT = '"Segoe UI", "Apple SD Gothic Neo", system-ui, -apple-system, sans-serif';

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export interface Energy { bass: number; mid: number; high: number; bins: Uint8Array }

export class Renderer {
  layout: Layout;
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private readonly laneGlow = [0, 0, 0, 0];
  private bass = 0;
  private shownScore = 0;
  private drawStart = 0;
  private lastTime = performance.now();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.layout = computeLayout(canvas.clientWidth, canvas.clientHeight, 0);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 150));
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.layout = computeLayout(w, h, readSafeBottom());
  }

  /** 새 곡을 시작할 때 호출 */
  reset(): void {
    this.drawStart = 0;
    this.shownScore = 0;
    this.laneGlow.fill(0);
  }

  draw(game: Game | null, fx: Effects, energy: Energy): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    const c = this.ctx;
    const L = this.layout;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.bass += (energy.bass - this.bass) * 0.3;
    this.drawBackground(c, L, energy);

    const t = game ? game.songTime() : 0;
    this.drawTrack(c, L, game, t);
    if (game) {
      for (let i = 0; i < LANES; i++) {
        const target = game.laneDown[i] ? 1 : 0;
        this.laneGlow[i] += (target - this.laneGlow[i]) * Math.min(1, dt * (target ? 40 : 12));
      }
      this.drawBeams(c, L);
      this.drawNotes(c, L, game, t);
    }
    this.drawJudgeLine(c, L);
    this.drawPads(c, L);
    this.drawEffects(c, L, fx);
    if (game) this.drawHud(c, L, game, fx, t, dt);
  }

  // ─── 배경 ──────────────────────────────────────────────────────────
  private drawBackground(c: CanvasRenderingContext2D, L: Layout, e: Energy): void {
    const g = c.createLinearGradient(0, 0, 0, L.h);
    g.addColorStop(0, '#05050f');
    g.addColorStop(0.6, '#0d0824');
    g.addColorStop(1, '#14082e');
    c.fillStyle = g;
    c.fillRect(0, 0, L.w, L.h);

    // 저음에 맞춰 맥동하는 후광
    const cx = L.w / 2;
    const cy = L.topY;
    const r = L.sw * (0.7 + 0.5 * this.bass);
    const rg = c.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, `rgba(160,80,255,${0.12 + 0.35 * this.bass})`);
    rg.addColorStop(1, 'rgba(160,80,255,0)');
    c.fillStyle = rg;
    c.fillRect(0, 0, L.w, L.h);

    // 스펙트럼 막대 (트랙 위쪽 빈 공간)
    if (e.bins.length) {
      const bars = 28;
      const bw = L.w / bars;
      const baseY = L.topY - 6;
      const maxH = L.topY * 0.8;
      for (let i = 0; i < bars; i++) {
        const v = e.bins[Math.min(e.bins.length - 1, Math.floor(i * 0.9 + 1))] / 255;
        const bh = Math.max(2, v * v * maxH);
        c.fillStyle = i % 2 ? 'rgba(79,232,255,0.22)' : 'rgba(255,79,216,0.22)';
        c.fillRect(i * bw + 1, baseY - bh, bw - 2, bh);
      }
    }
  }

  // ─── 트랙 ──────────────────────────────────────────────────────────
  private drawTrack(c: CanvasRenderingContext2D, L: Layout, game: Game | null, t: number): void {
    const x0t = laneX(L, 0, L.s0, 0);
    const x1t = laneX(L, 3, L.s0, 1);
    const x0b = laneX(L, 0, 1, 0);
    const x1b = laneX(L, 3, 1, 1);

    c.fillStyle = 'rgba(8,6,24,0.72)';
    c.beginPath();
    c.moveTo(x0t, L.topY); c.lineTo(x1t, L.topY); c.lineTo(x1b, L.jy); c.lineTo(x0b, L.jy);
    c.closePath();
    c.fill();

    // 박자선: 낙하 속도감을 준다
    if (game && game.map.bpm > 0) {
      const beat = 60 / game.map.bpm;
      const off = game.map.offset ?? 0;
      const first = Math.ceil((t - off) / beat);
      c.lineWidth = 1;
      for (let k = first; off + k * beat - t < game.approach; k++) {
        const p = 1 - (off + k * beat - t) / game.approach;
        if (p < 0 || p > 1) continue;
        const s = scaleAt(L, p);
        const y = yAt(L, s);
        c.strokeStyle = `rgba(255,255,255,${k % 4 === 0 ? 0.16 : 0.07})`;
        c.beginPath();
        c.moveTo(laneX(L, 0, s, 0), y);
        c.lineTo(laneX(L, 3, s, 1), y);
        c.stroke();
      }
    }

    // 레인 구분선
    for (let i = 0; i <= LANES; i++) {
      const edge = i === 0 || i === LANES;
      const lane = Math.min(i, 3);
      const frac = i === LANES ? 1 : 0;
      c.strokeStyle = edge ? rgba('#b99bff', 0.55) : 'rgba(255,255,255,0.14)';
      c.lineWidth = edge ? 2 : 1;
      c.beginPath();
      c.moveTo(laneX(L, lane, L.s0, frac), L.topY);
      c.lineTo(laneX(L, lane, 1, frac), L.jy);
      c.stroke();
    }
  }

  private drawBeams(c: CanvasRenderingContext2D, L: Layout): void {
    c.globalCompositeOperation = 'lighter';
    const sTop = scaleAt(L, 0.45);
    const yTop = yAt(L, sTop);
    for (let lane = 0; lane < LANES; lane++) {
      const g = this.laneGlow[lane];
      if (g < 0.02) continue;
      const grad = c.createLinearGradient(0, L.jy, 0, yTop);
      grad.addColorStop(0, rgba(LANE_COLORS[lane], 0.5 * g));
      grad.addColorStop(1, rgba(LANE_COLORS[lane], 0));
      c.fillStyle = grad;
      c.beginPath();
      c.moveTo(laneX(L, lane, sTop, 0), yTop);
      c.lineTo(laneX(L, lane, sTop, 1), yTop);
      c.lineTo(laneX(L, lane, 1, 1), L.jy);
      c.lineTo(laneX(L, lane, 1, 0), L.jy);
      c.closePath();
      c.fill();
    }
    c.globalCompositeOperation = 'source-over';
  }

  // ─── 노트 ──────────────────────────────────────────────────────────
  private drawNotes(c: CanvasRenderingContext2D, L: Layout, game: Game, t: number): void {
    const notes = game.notes;
    while (this.drawStart < notes.length && notes[this.drawStart].t + notes[this.drawStart].dur < t - 0.4) this.drawStart++;
    let end = this.drawStart;
    while (end < notes.length && notes[end].t - t < game.approach) end++;
    // 판정선을 지나간 노트가 하단 패드 위로 커지며 번지지 않도록 판정선 바로 아래에서 자른다
    c.save();
    c.beginPath();
    c.rect(0, 0, L.w, L.jy + L.noteH * 0.6);
    c.clip();
    // 먼 노트부터 그려서 가까운 노트가 위에 오도록
    for (let i = end - 1; i >= this.drawStart; i--) this.drawNote(c, L, notes[i], t, game.approach);
    c.restore();
  }

  private drawNote(c: CanvasRenderingContext2D, L: Layout, n: LiveNote, t: number, approach: number): void {
    if (n.status === 'hit') return;
    const pHead = 1 - (n.t - t) / approach;
    if (pHead < 0) return;
    const dead = n.status === 'missed' || n.status === 'broken';
    const color = dead ? '#6a6a80' : LANE_COLORS[n.lane];
    const fade = Math.min(1, pHead / 0.1) * (dead ? 0.45 : 1);

    if (n.dur > 0) {
      const holding = n.status === 'holding';
      const pTail = Math.max(0, 1 - (n.t + n.dur - t) / approach);
      const pBottom = holding ? 1 : pHead;
      const sT = scaleAt(L, pTail);
      const sB = scaleAt(L, pBottom);
      const yT = yAt(L, sT);
      const yB = yAt(L, sB);
      c.beginPath();
      c.moveTo(laneX(L, n.lane, sT, 0.14), yT);
      c.lineTo(laneX(L, n.lane, sT, 0.86), yT);
      c.lineTo(laneX(L, n.lane, sB, 0.86), yB);
      c.lineTo(laneX(L, n.lane, sB, 0.14), yB);
      c.closePath();
      c.fillStyle = rgba(color, (holding ? 0.6 : 0.32) * fade);
      c.fill();
      c.strokeStyle = rgba(color, 0.9 * fade);
      c.lineWidth = 2;
      c.stroke();
    }

    const pDraw = n.status === 'holding' ? 1 : pHead;
    const s = scaleAt(L, pDraw);
    const y = yAt(L, s);
    if (y - L.noteH * s > L.h) return;
    const half = ((L.sw * s) / 4) * 0.45;
    const h = L.noteH * s;
    const cx = laneX(L, n.lane, s);

    c.globalAlpha = fade;
    c.fillStyle = rgba(color, 0.28);
    rr(c, cx - half - 5 * s, y - h / 2 - 5 * s, half * 2 + 10 * s, h + 10 * s, h * 0.6);
    c.fill();
    c.fillStyle = color;
    rr(c, cx - half, y - h / 2, half * 2, h, h * 0.4);
    c.fill();
    c.fillStyle = dead ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.92)';
    rr(c, cx - half + 4 * s, y - h * 0.18, half * 2 - 8 * s, h * 0.36, h * 0.18);
    c.fill();
    c.globalAlpha = 1;
  }

  // ─── 판정선 / 패드 ──────────────────────────────────────────────────
  private drawJudgeLine(c: CanvasRenderingContext2D, L: Layout): void {
    const x0 = laneX(L, 0, 1, 0);
    const x1 = laneX(L, 3, 1, 1);
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(150,120,255,0.3)';
    c.lineWidth = 10;
    c.beginPath(); c.moveTo(x0, L.jy); c.lineTo(x1, L.jy); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.95)';
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(x0, L.jy); c.lineTo(x1, L.jy); c.stroke();
    c.lineCap = 'butt';
  }

  private drawPads(c: CanvasRenderingContext2D, L: Layout): void {
    const laneW = L.sw / 4;
    const gap = 5;
    for (let i = 0; i < LANES; i++) {
      const g = this.laneGlow[i];
      const x = L.sx + i * laneW + gap / 2;
      const y = L.padTop;
      const w = laneW - gap;
      const h = L.padBottom - y;
      rr(c, x, y, w, h, 14);
      const grad = c.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, rgba(LANE_COLORS[i], 0.16 + 0.5 * g));
      grad.addColorStop(1, rgba(LANE_COLORS[i], 0.04 + 0.15 * g));
      c.fillStyle = grad;
      c.fill();
      c.strokeStyle = rgba(LANE_COLORS[i], 0.45 + 0.5 * g);
      c.lineWidth = 2;
      c.stroke();
    }
  }

  // ─── 이펙트 ────────────────────────────────────────────────────────
  private drawEffects(c: CanvasRenderingContext2D, _L: Layout, fx: Effects): void {
    c.globalCompositeOperation = 'lighter';
    for (const r of fx.rings) {
      const k = r.age / r.life;
      c.strokeStyle = rgba(r.color, 0.9 * (1 - k));
      c.lineWidth = 4 * (1 - k) + 1;
      c.beginPath();
      c.ellipse(r.x, r.y, r.r * (0.5 + 1.3 * k), r.r * (0.5 + 1.3 * k) * 0.45, 0, 0, Math.PI * 2);
      c.stroke();
    }
    for (const p of fx.particles) {
      const k = 1 - p.life / p.max;
      c.fillStyle = rgba(p.color, k);
      c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    c.globalCompositeOperation = 'source-over';
  }

  // ─── HUD ───────────────────────────────────────────────────────────
  private drawHud(c: CanvasRenderingContext2D, L: Layout, game: Game, fx: Effects, t: number, dt: number): void {
    const pad = Math.max(14, L.sw * 0.04);
    const left = L.sx + pad;
    const right = L.sx + L.sw - pad;
    const top = Math.max(18, L.h * 0.03) + 8;

    // 점수 (숫자가 올라가는 애니메이션)
    this.shownScore += (game.score.score - this.shownScore) * Math.min(1, dt * 12);
    c.textBaseline = 'top';
    c.textAlign = 'right';
    c.fillStyle = '#ffffff';
    c.font = `800 ${Math.round(L.sw * 0.075)}px ${FONT}`;
    c.fillText(String(Math.round(this.shownScore)).padStart(7, '0'), right, top);

    c.textAlign = 'left';
    c.font = `700 ${Math.round(L.sw * 0.045)}px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.fillText(`${game.score.accuracy.toFixed(2)}%`, left, top + 2);
    c.font = `600 ${Math.round(L.sw * 0.032)}px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillText(game.map.title, left, top + L.sw * 0.065);

    // 진행 바
    const prog = Math.max(0, Math.min(1, t / game.duration));
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(L.sx, 0, L.sw, 4);
    c.fillStyle = '#b99bff';
    c.fillRect(L.sx, 0, L.sw * prog, 4);

    // 콤보
    const combo = game.score.combo;
    if (combo >= 2) {
      const scale = 1 + 0.28 * fx.comboPop;
      const cy = L.topY + (L.jy - L.topY) * 0.38;
      c.save();
      c.translate(L.w / 2, cy);
      c.scale(scale, scale);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `900 ${Math.round(L.sw * 0.17)}px ${FONT}`;
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.strokeStyle = 'rgba(185,155,255,0.55)';
      c.lineWidth = 6;
      c.strokeText(String(combo), 0, 0);
      c.fillText(String(combo), 0, 0);
      c.font = `700 ${Math.round(L.sw * 0.04)}px ${FONT}`;
      c.fillStyle = 'rgba(255,255,255,0.7)';
      c.fillText('COMBO', 0, L.sw * 0.115);
      c.restore();
    }

    // 판정 텍스트
    if (fx.popup) {
      const st = JUDGE_STYLE[fx.popup.j];
      const k = fx.popup.age / 0.7;
      const pop = 1 + 0.35 * Math.max(0, 1 - fx.popup.age * 10);
      c.save();
      c.globalAlpha = Math.min(1, (1 - k) * 2);
      c.translate(L.w / 2, L.jy - L.h * 0.07);
      c.scale(pop, pop);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `900 ${Math.round(L.sw * 0.07)}px ${FONT}`;
      c.fillStyle = st.color;
      c.strokeStyle = 'rgba(0,0,0,0.5)';
      c.lineWidth = 4;
      c.strokeText(st.text, 0, 0);
      c.fillText(st.text, 0, 0);
      if (fx.popup.j !== 'miss' && fx.popup.j !== 'perfect') {
        c.font = `700 ${Math.round(L.sw * 0.034)}px ${FONT}`;
        c.fillStyle = fx.popup.early < 0 ? '#7fd6ff' : '#ffb27f';
        c.fillText(fx.popup.early < 0 ? 'FAST' : 'SLOW', 0, L.sw * 0.075);
      }
      c.restore();
    }

    // 카운트다운
    if (t < 0 && game.state === 'running') {
      const n = Math.ceil((-t) / (LEAD_IN / 3));
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `900 ${Math.round(L.sw * 0.3)}px ${FONT}`;
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.fillText(String(Math.min(3, n)), L.w / 2, L.topY + (L.jy - L.topY) * 0.45);
    }
  }
}
