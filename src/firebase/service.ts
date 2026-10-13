/**
 * Firebase SDK 에 직접 의존하는 계층. 번들 크기를 위해 online.ts 가 동적 import 로만 불러온다.
 * (Auth + Firestore 만 사용. Storage 는 쓰지 않으며 오디오 원본은 절대 저장하지 않는다.)
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider, connectAuthEmulator, getAuth, getRedirectResult, linkWithCredential, linkWithPopup, linkWithRedirect,
  onAuthStateChanged, signInAnonymously, signInWithCredential, signInWithPopup, signOut as fbSignOut,
  type Auth, type OAuthCredential, type User,
} from 'firebase/auth';
import {
  collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, initializeFirestore, limit, memoryLocalCache,
  orderBy, persistentLocalCache, persistentMultipleTabManager, query, serverTimestamp, setDoc, startAfter, Timestamp, where,
  type Firestore,
} from 'firebase/firestore';
import type { CachedAnalysis } from '../game/library';
import type { Settings } from '../game/settings';
import type { Difficulty, GameMap } from '../game/types';
import type { OnlineConfig } from './config';
import { DIFFICULTY_IDS, mapId, mapToDoc, sanitizeMapDoc } from './mapCodec';
import type { OutboxBackend, ScoreItem } from './outbox';
import { sanitizeSongDoc, songToDoc, type SongInfo } from './songCodec';

export interface LeaderboardRow {
  uid: string;
  nickname: string;
  score: number;
  accuracy: number;
  combo: number;
}

export type LinkResult = 'linked' | 'switched' | 'redirect' | 'cancelled';

/** 네트워크가 멈춰도 UI 가 기다리지 않도록 시간 제한 (오프라인 Firestore 쓰기는 영원히 대기할 수 있다) */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject({ code: 'deadline-exceeded' }), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

const errCode = (e: unknown): string =>
  typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';

export class Service {
  readonly app: FirebaseApp;
  readonly auth: Auth;
  readonly db: Firestore;

  constructor(cfg: OnlineConfig) {
    this.app = initializeApp(cfg.firebase);
    this.auth = getAuth(this.app);
    this.db = this.createFirestore();
    if (cfg.emulator) {
      const host = location.hostname || '127.0.0.1';
      connectAuthEmulator(this.auth, `http://${host}:9099`, { disableWarnings: true });
      connectFirestoreEmulator(this.db, host, 8080);
    }
  }

  /** 오프라인에서도 읽을 수 있도록 영구 캐시를 쓰고, 불가능한 환경(시크릿 모드 등)이면 메모리 캐시로 대체 */
  private createFirestore(): Firestore {
    try {
      return initializeFirestore(this.app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
    } catch {
      try {
        return initializeFirestore(this.app, { localCache: memoryLocalCache() });
      } catch {
        return getFirestore(this.app);
      }
    }
  }

  // ─── 인증 ────────────────────────────────────────────────────────────────
  get user(): User | null {
    return this.auth.currentUser;
  }

  onAuth(fn: (u: User | null) => void): () => void {
    return onAuthStateChanged(this.auth, fn);
  }

  /** 저장된 로그인 상태가 복원될 때까지 기다린 뒤, 없으면 익명 로그인한다. 오프라인이면 null. */
  async ensureSignedIn(): Promise<User | null> {
    await this.auth.authStateReady();
    // 구글 리다이렉트 로그인에서 돌아온 경우 결과 처리
    await getRedirectResult(this.auth).catch((e) => this.handleLinkError(e));
    if (this.auth.currentUser) return this.auth.currentUser;
    try {
      return (await signInAnonymously(this.auth)).user;
    } catch {
      return null; // 오프라인 등 → 나중에 재시도
    }
  }

  /** 익명 계정에 구글 계정을 연결한다 (uid 가 유지되어 기록이 그대로 이어진다). */
  async linkGoogle(): Promise<LinkResult> {
    const provider = new GoogleAuthProvider();
    const cur = this.auth.currentUser;
    try {
      if (!cur) await signInWithPopup(this.auth, provider);
      else if (cur.isAnonymous) await linkWithPopup(cur, provider);
      return 'linked';
    } catch (e) {
      const code = errCode(e);
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        if (cur?.isAnonymous) { await linkWithRedirect(cur, provider); return 'redirect'; }
      }
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'cancelled';
      return this.handleLinkError(e);
    }
  }

  /**
   * 구글 자격 증명(ID 토큰)으로 연결한다. 팝업을 쓸 수 없는 환경과 에뮬레이터 테스트용.
   * 익명 계정이면 연결(uid 유지), 이미 다른 계정에 연결된 구글 계정이면 그 계정으로 전환한다.
   */
  async linkWithGoogleIdToken(idToken: string): Promise<LinkResult> {
    const cred: OAuthCredential = GoogleAuthProvider.credential(idToken);
    const cur = this.auth.currentUser;
    if (!cur) { await signInWithCredential(this.auth, cred); return 'linked'; }
    if (!cur.isAnonymous) return 'linked';
    try {
      await linkWithCredential(cur, cred);
      return 'linked';
    } catch (e) {
      if (errCode(e) === 'auth/credential-already-in-use') { await signInWithCredential(this.auth, cred); return 'switched'; }
      throw e;
    }
  }

  /** 이미 다른 익명 계정에 연결된 구글 계정이면 그 계정으로 전환한다. */
  private async handleLinkError(e: unknown): Promise<LinkResult> {
    if (errCode(e) === 'auth/credential-already-in-use') {
      const cred = GoogleAuthProvider.credentialFromError(e as never);
      if (cred) { await signInWithCredential(this.auth, cred); return 'switched'; }
    }
    throw e;
  }

  async signOut(): Promise<void> {
    await fbSignOut(this.auth);
    await this.ensureSignedIn();
  }

  // ─── 프로필 (users/{uid}) ─────────────────────────────────────────────────
  async loadProfile(uid: string): Promise<{ nickname?: string; settings?: Partial<Settings> } | null> {
    const snap = await withTimeout(getDoc(doc(this.db, 'users', uid)), 8000);
    return snap.exists() ? (snap.data() as { nickname?: string; settings?: Partial<Settings> }) : null;
  }

  async saveProfile(uid: string, nickname: string, settings: Pick<Settings, 'speed' | 'musicVolume' | 'sfxVolume' | 'difficulty'>): Promise<void> {
    await withTimeout(setDoc(doc(this.db, 'users', uid), { nickname, settings, updatedAt: serverTimestamp() }), 10000);
  }

  // ─── 맵 (maps/{songHash}_{difficulty}) ──────────────────────────────────
  /** 곡 지문으로 난이도 3개를 모두 가져온다. 하나라도 없거나 검증에 실패하면 null. */
  async fetchMaps(songHash: string): Promise<CachedAnalysis | null> {
    const snaps = await Promise.all(
      DIFFICULTY_IDS.map((d) => withTimeout(getDoc(doc(this.db, 'maps', mapId(songHash, d))), 6000)),
    );
    const maps = {} as Record<Difficulty, GameMap>;
    for (let i = 0; i < DIFFICULTY_IDS.length; i++) {
      const d = DIFFICULTY_IDS[i];
      const m = snaps[i].exists() ? sanitizeMapDoc(snaps[i].data(), { songHash, difficulty: d }) : null;
      if (!m) return null;
      maps[d] = m;
    }
    return { bpm: maps.normal.bpm, offset: maps.normal.offset ?? 0, maps };
  }

  /** 아직 없는 맵만 올린다 (맵은 생성 후 불변이며 첫 업로드가 기준이 된다). */
  async uploadMaps(uid: string, a: CachedAnalysis): Promise<void> {
    for (const d of DIFFICULTY_IDS) {
      const map = a.maps[d];
      const ref = doc(this.db, 'maps', mapId(map.songHash, d));
      if ((await withTimeout(getDoc(ref), 8000)).exists()) continue;
      await withTimeout(setDoc(ref, { ...mapToDoc(map, uid), createdAt: serverTimestamp() }), 15000);
    }
  }

  // ─── 공유 맵 목록 (songs/{songHash}) ────────────────────────────────────
  /** 공개 목록에 곡을 올린다 (이미 있으면 건너뜀). 맵 3개가 먼저 올라가 있어야 한다. */
  async publishSong(uid: string, info: Omit<SongInfo, 'createdAt'>): Promise<void> {
    const ref = doc(this.db, 'songs', info.songHash);
    if ((await withTimeout(getDoc(ref), 8000)).exists()) return;
    await withTimeout(setDoc(ref, { ...songToDoc(info, uid), createdAt: serverTimestamp() }), 15000);
  }

  /** 최신순 공유 곡 목록. next 가 있으면 다음 페이지의 커서(마지막 항목의 올린 시각). */
  async listSongs(pageSize = 20, after?: number): Promise<{ rows: SongInfo[]; next: number | null }> {
    const parts = [orderBy('createdAt', 'desc'), ...(after !== undefined ? [startAfter(Timestamp.fromMillis(after))] : []), limit(pageSize)];
    const snap = await withTimeout(getDocs(query(collection(this.db, 'songs'), ...parts)), 10000);
    const rows: SongInfo[] = [];
    for (const d of snap.docs) {
      const row = sanitizeSongDoc(d.id, d.data());
      if (row) rows.push(row);
    }
    const last = snap.docs.at(-1)?.data().createdAt;
    const next = snap.docs.length >= pageSize && last && typeof last.toMillis === 'function' ? (last.toMillis() as number) : null;
    return { rows, next };
  }

  // ─── 점수 (scores/{id}) ──────────────────────────────────────────────────
  outboxBackend(isReady: () => Promise<string | null>): OutboxBackend {
    return {
      ready: isReady,
      exists: async (id) => (await withTimeout(getDoc(doc(this.db, 'scores', id)), 8000)).exists(),
      create: async (item: ScoreItem, uid: string) => {
        await withTimeout(setDoc(doc(this.db, 'scores', item.id), {
          uid,
          mapId: item.mapId,
          nickname: item.nickname,
          score: item.score,
          accuracy: item.accuracy,
          combo: item.combo,
          time: serverTimestamp(),
          playedAt: item.playedAt,
        }), 12000);
      },
    };
  }

  /** 곡·난이도별 상위 기록. 한 사람이 여러 번 올렸을 수 있어 넉넉히 가져와 사람별 최고 기록만 남긴다. */
  async leaderboard(songHash: string, difficulty: Difficulty, top = 20): Promise<LeaderboardRow[]> {
    const q = query(
      collection(this.db, 'scores'),
      where('mapId', '==', mapId(songHash, difficulty)),
      orderBy('score', 'desc'),
      limit(top * 3),
    );
    const snap = await withTimeout(getDocs(q), 10000);
    const seen = new Set<string>();
    const rows: LeaderboardRow[] = [];
    for (const d of snap.docs) {
      const x = d.data();
      if (typeof x.uid !== 'string' || seen.has(x.uid)) continue;
      seen.add(x.uid);
      rows.push({
        uid: x.uid,
        nickname: typeof x.nickname === 'string' ? x.nickname.slice(0, 16) : '?',
        score: Number(x.score) || 0,
        accuracy: Number(x.accuracy) || 0,
        combo: Number(x.combo) || 0,
      });
      if (rows.length >= top) break;
    }
    return rows;
  }
}
