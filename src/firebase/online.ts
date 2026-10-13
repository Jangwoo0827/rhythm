import { SAMPLE_HASH, loadAnalysis, type CachedAnalysis } from '../game/library';
import { getSettings, onSettingsChange, updateSettings } from '../game/settings';
import type { Difficulty, Result } from '../game/types';
import { readJSON, writeJSON } from '../storage';
import { readConfig, type OnlineConfig } from './config';
import { friendlyAuthError } from './errors';
import { mapId } from './mapCodec';
import { Outbox, type OutboxBackend } from './outbox';
import { getNickname, lastSyncedUid, sanitizeNickname, setLastSyncedUid, setNickname } from './profile';
import type { LeaderboardRow, LinkResult, Service } from './service';
import type { SongInfo } from './songCodec';

export type { LeaderboardRow, LinkResult, SongInfo };

/** 공개 목록에 올릴 때 필요한 정보 (오디오가 아니라 제목·길이만) */
export interface PublishInfo { title: string; duration: number }
interface PendingMap { hash: string; title: string; duration: number }

export interface OnlineStatus {
  /** Firebase 설정(.env)이 있는가. false 면 온라인 기능 전체가 꺼진다. */
  configured: boolean;
  signedIn: boolean;
  anonymous: boolean;
  email: string | null;
  nickname: string;
  /** 아직 올라가지 않은 점수 수 */
  pending: number;
}

const PENDING_MAPS_KEY = 'rhythm.pendingmaps.v1';
const TRANSIENT = new Set(['unavailable', 'deadline-exceeded', 'cancelled', 'aborted', 'unauthenticated', 'resource-exhausted', 'auth/network-request-failed']);

const codeOf = (e: unknown): string =>
  typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* 비보안 컨텍스트 */ }
  return Array.from({ length: 4 }, () => Math.random().toString(16).slice(2, 10)).join('');
}

/**
 * 온라인 기능 퍼사드. Firebase SDK 는 처음 필요할 때 동적으로 불러오며,
 * 설정이 없거나 오프라인이어도 모든 메서드가 안전하게 실패/무시되어 게임은 그대로 동작한다.
 */
class Online {
  readonly configured: boolean;
  private readonly cfg: OnlineConfig | null;
  private servicePromise: Promise<Service | null> | null = null;
  private service: Service | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly outbox: Outbox;
  private pendingMaps: PendingMap[];
  private mapsFlushing: Promise<void> | null = null;
  private profileUid: string | null = null;
  private profileReady = false;
  private profileDirty = false;
  private pushTimer: number | undefined;

  constructor() {
    this.cfg = readConfig();
    this.configured = !!this.cfg;
    const backend: OutboxBackend = {
      ready: () => this.readyUid(),
      exists: (id) => this.scoreBackend().exists(id),
      create: (item, uid) => this.scoreBackend().create(item, uid),
    };
    this.outbox = new Outbox(backend);
    this.outbox.subscribe(() => this.emit());
    const saved = readJSON<Array<PendingMap | string>>(PENDING_MAPS_KEY);
    this.pendingMaps = (Array.isArray(saved) ? saved : [])
      .map((e) => (typeof e === 'string' ? { hash: e, title: '', duration: 0 } : e)) // 이전 형식(곡 지문만) 호환
      .filter((e) => e && typeof e.hash === 'string');
  }

  // ─── 수명주기 ─────────────────────────────────────────────────────────────
  /** 앱 시작 시 한 번 호출: 익명 로그인과 대기 중인 업로드 재개 */
  init(): void {
    if (!this.configured) return;
    window.addEventListener('online', () => void this.retry());
    onSettingsChange(() => {
      this.profileDirty = true;
      clearTimeout(this.pushTimer);
      this.pushTimer = window.setTimeout(() => void this.pushProfile(), 1500);
    });
    void this.load().then(() => this.retry());
  }

  private load(): Promise<Service | null> {
    if (!this.cfg) return Promise.resolve(null);
    const cfg = this.cfg;
    this.servicePromise ??= import('./service')
      .then(async (m) => {
        const svc = new m.Service(cfg);
        this.service = svc;
        svc.onAuth((u) => { this.emit(); if (u) void this.onSignedIn(u.uid); });
        await svc.ensureSignedIn();
        return svc;
      })
      .catch(() => {
        this.servicePromise = null; // 오프라인에서 청크를 못 받았다면 다음에 재시도
        this.service = null;
        return null;
      });
    return this.servicePromise;
  }

  /** 온라인이고 로그인된 상태면 uid, 아니면 null (필요하면 익명 로그인 재시도) */
  private async readyUid(): Promise<string | null> {
    if (!this.configured || !navigator.onLine) return null;
    const svc = await this.load();
    if (!svc) return null;
    const u = svc.user ?? (await svc.ensureSignedIn());
    return u?.uid ?? null;
  }

  private scoreBackend(): OutboxBackend {
    if (!this.service) throw { code: 'unavailable' };
    return this.service.outboxBackend(() => this.readyUid());
  }

  /** 온라인 복귀/앱 시작 시: 로그인 재시도, 맵과 점수 업로드, 프로필 저장 */
  async retry(): Promise<void> {
    if (!this.configured) return;
    await this.readyUid();
    await this.flushMaps();
    await this.outbox.flush();
    if (this.profileDirty) await this.pushProfile();
    this.emit();
  }

  // ─── 상태 ─────────────────────────────────────────────────────────────────
  status(): OnlineStatus {
    const u = this.service?.user ?? null;
    return {
      configured: this.configured,
      signedIn: !!u,
      anonymous: u ? u.isAnonymous : true,
      email: u?.email ?? null,
      nickname: getNickname(),
      pending: this.outbox.pending,
    };
  }

  myUid(): string | null {
    return this.service?.user?.uid ?? null;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  // ─── 계정 ─────────────────────────────────────────────────────────────────
  async linkGoogle(): Promise<LinkResult> {
    const svc = await this.load();
    if (!svc) throw new Error('온라인에 연결할 수 없어요.');
    try {
      const r = await svc.linkGoogle();
      this.emit();
      return r;
    } catch (e) {
      throw new Error(friendlyAuthError(e));
    }
  }

  /** 개발/테스트 전용: 팝업 없이 구글 ID 토큰으로 연결 (에뮬레이터는 JSON 문자열 토큰을 받는다) */
  async devLinkWithIdToken(idToken: string): Promise<LinkResult> {
    if (!import.meta.env.DEV) throw new Error('개발 모드에서만 사용할 수 있어요.');
    const svc = await this.load();
    if (!svc) throw new Error('온라인에 연결할 수 없어요.');
    const r = await svc.linkWithGoogleIdToken(idToken);
    this.emit();
    return r;
  }

  async signOut(): Promise<void> {
    const svc = await this.load();
    if (!svc) return;
    this.profileUid = null;
    this.profileReady = false;
    await svc.signOut();
    this.emit();
  }

  /** 닉네임을 저장(로컬 + 로그인 시 클라우드). 정리된 닉네임을 반환 */
  updateNickname(raw: string): string {
    const n = sanitizeNickname(raw) ? setNickname(raw) : getNickname();
    this.profileDirty = true;
    void this.pushProfile();
    this.emit();
    return n;
  }

  /** 로그인 직후: 클라우드 프로필을 받아 닉네임/설정을 반영하거나, 없으면 현재 값으로 만든다. */
  private async onSignedIn(uid: string): Promise<void> {
    if (this.profileUid === uid) return;
    this.profileUid = uid;
    this.profileReady = false;
    const svc = this.service;
    if (!svc) return;
    try {
      const p = await svc.loadProfile(uid);
      if (p) {
        if (p.nickname) setNickname(p.nickname);
        // 마지막으로 동기화한 계정과 다른 계정으로 로그인했을 때만 클라우드 설정을 적용한다
        // (같은 계정이면 이 기기의 로컬 변경이 우선). 판정 오프셋은 기기(이어폰)마다 달라서 동기화하지 않는다.
        if (p.settings && lastSyncedUid() !== uid) {
          const { speed, musicVolume, sfxVolume, difficulty } = p.settings;
          updateSettings({
            ...(speed !== undefined ? { speed } : {}),
            ...(musicVolume !== undefined ? { musicVolume } : {}),
            ...(sfxVolume !== undefined ? { sfxVolume } : {}),
            ...(difficulty !== undefined ? { difficulty } : {}),
          });
        }
        this.profileDirty = false;
      } else {
        this.profileDirty = true;
      }
      setLastSyncedUid(uid);
      this.profileReady = true;
      if (this.profileDirty) await this.pushProfile();
    } catch {
      this.profileUid = null; // 다음 기회에 다시 시도
    }
    this.emit();
  }

  private async pushProfile(): Promise<void> {
    const svc = this.service;
    const uid = svc?.user?.uid;
    if (!svc || !uid || !this.profileReady || !navigator.onLine) return;
    const s = getSettings();
    try {
      await svc.saveProfile(uid, getNickname(), { speed: s.speed, musicVolume: s.musicVolume, sfxVolume: s.sfxVolume, difficulty: s.difficulty });
      this.profileDirty = false;
    } catch { /* 오프라인 등: dirty 상태로 두었다가 retry() 에서 다시 */ }
  }

  // ─── 맵 ───────────────────────────────────────────────────────────────────
  /** 온라인에 저장된 맵(3개 난이도). 없거나 오프라인이거나 검증에 실패하면 null */
  async fetchMaps(songHash: string): Promise<CachedAnalysis | null> {
    if (!this.configured || songHash === SAMPLE_HASH || !(await this.readyUid())) return null;
    try {
      return (await this.service?.fetchMaps(songHash)) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * 분석한 맵을 온라인에 저장하도록 예약 (오프라인이면 나중에). 오디오는 올리지 않는다.
   * 설정의 "공개 목록" 이 켜져 있으면 공유 맵 둘러보기 목록에도 올린다.
   */
  publishMaps(songHash: string, info?: PublishInfo): void {
    if (!this.configured || songHash === SAMPLE_HASH) return;
    this.pendingMaps = this.pendingMaps.filter((e) => e.hash !== songHash);
    this.pendingMaps.push({ hash: songHash, title: info?.title ?? '', duration: info?.duration ?? 0 });
    if (this.pendingMaps.length > 20) this.pendingMaps.shift();
    writeJSON(PENDING_MAPS_KEY, this.pendingMaps);
    void this.flushMaps();
  }

  private flushMaps(): Promise<void> {
    this.mapsFlushing ??= this.runFlushMaps().finally(() => { this.mapsFlushing = null; });
    return this.mapsFlushing;
  }

  private async runFlushMaps(): Promise<void> {
    if (this.pendingMaps.length === 0) return;
    const uid = await this.readyUid();
    const svc = this.service;
    if (!uid || !svc) return;
    for (const entry of [...this.pendingMaps]) {
      const analysis = loadAnalysis(entry.hash); // 로컬 캐시에서 읽는다
      try {
        if (analysis) {
          await svc.uploadMaps(uid, analysis);
          if (getSettings().publicShare && entry.duration >= 1) {
            const m = analysis.maps;
            await svc.publishSong(uid, {
              songHash: entry.hash,
              title: entry.title || m.normal.title,
              mapper: getNickname(),
              bpm: analysis.bpm,
              duration: Math.min(3600, entry.duration),
              counts: { easy: m.easy.notes.length, normal: m.normal.notes.length, hard: m.hard.notes.length },
            });
          }
        }
      } catch (e) {
        if (TRANSIENT.has(codeOf(e))) break;
        // 규칙 거절 등 영구 오류는 버린다
      }
      this.pendingMaps = this.pendingMaps.filter((p) => p.hash !== entry.hash);
      writeJSON(PENDING_MAPS_KEY, this.pendingMaps);
    }
  }

  /** 공유 맵 둘러보기: 최신순 목록 (다음 페이지는 next 커서로) */
  async listSongs(after?: number): Promise<{ rows: SongInfo[]; next: number | null }> {
    if (!(await this.readyUid()) || !this.service) throw new Error('오프라인이거나 온라인 기능을 쓸 수 없어요.');
    return this.service.listSongs(20, after);
  }

  // ─── 점수 / 리더보드 ──────────────────────────────────────────────────────
  /** 기록을 업로드 대기열에 넣는다. 반환값: 온라인 저장 대상인지 (샘플 곡·미설정이면 false) */
  submitScore(songHash: string, difficulty: Difficulty, result: Result): boolean {
    if (!this.configured || songHash === SAMPLE_HASH) return false;
    this.outbox.enqueue({
      id: newId(),
      mapId: mapId(songHash, difficulty),
      nickname: getNickname(),
      score: Math.max(0, Math.min(1_000_000, Math.round(result.score))),
      accuracy: Math.max(0, Math.min(100, Math.round(result.accuracy * 100) / 100)),
      combo: Math.max(0, Math.round(result.maxCombo)),
      playedAt: Date.now(),
    });
    // 점수 문서는 맵 문서가 있어야 만들 수 있으므로 맵을 먼저 올린다
    void this.flushMaps().then(() => this.outbox.flush()).then(() => this.emit());
    return true;
  }

  async leaderboard(songHash: string, difficulty: Difficulty): Promise<LeaderboardRow[]> {
    if (!(await this.readyUid()) || !this.service) throw new Error('오프라인이거나 온라인 기능을 쓸 수 없어요.');
    return this.service.leaderboard(songHash, difficulty);
  }
}

export const online = new Online();
