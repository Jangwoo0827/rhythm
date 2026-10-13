import type { Judgement } from './types';
import { laneX, type Layout } from './layout';

export const LANE_COLORS = ['#ff4fd8', '#4fe8ff', '#4fe8ff', '#ff4fd8'] as const;

export const JUDGE_STYLE: Record<Judgement, { text: string; color: string }> = {
  perfect: { text: 'PERFECT', color: '#fff36b' },
  great: { text: 'GREAT', color: '#6bffb0' },
  good: { text: 'GOOD', color: '#6bb8ff' },
  miss: { text: 'MISS', color: '#ff5a7a' },
};

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }
interface Ring { x: number; y: number; age: number; life: number; color: string; r: number }

/** 판정 시 터지는 파티클/링, 판정 텍스트, 콤보 팝 애니메이션 */
export class Effects {
  readonly particles: Particle[] = [];
  readonly rings: Ring[] = [];
  popup: { j: Judgement; age: number; early: number } | null = null;
  comboPop = 0;

  hit(L: Layout, lane: number, j: Judgement, diff = 0): void {
    this.popup = { j, age: 0, early: j === 'miss' ? 0 : diff };
    if (j === 'miss') return;
    this.comboPop = 1;
    this.burst(L, lane, JUDGE_STYLE[j].color, j === 'perfect' ? 12 : 8);
  }

  holdComplete(L: Layout, lane: number): void {
    this.burst(L, lane, '#ffffff', 10);
  }

  private burst(L: Layout, lane: number, color: string, count: number): void {
    const x = laneX(L, lane, 1);
    const y = L.jy;
    this.rings.push({ x, y, age: 0, life: 0.35, color, r: (L.sw / 4) * 0.6 });
    for (let i = 0; i < count; i++) {
      const a = -Math.PI * (0.1 + 0.8 * Math.random());
      const v = (L.sw / 4) * (1.2 + 2.2 * Math.random());
      this.particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0, max: 0.35 + 0.25 * Math.random(), color, size: 2 + 3 * Math.random(),
      });
    }
    if (this.particles.length > 160) this.particles.splice(0, this.particles.length - 160);
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 900 * dt;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      if (r.age >= r.life) this.rings.splice(i, 1);
    }
    if (this.popup) {
      this.popup.age += dt;
      if (this.popup.age > 0.7) this.popup = null;
    }
    this.comboPop = Math.max(0, this.comboPop - dt * 6);
  }
}
