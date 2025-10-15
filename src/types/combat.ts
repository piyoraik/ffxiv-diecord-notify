/**
 * 攻略セグメントの状態。
 * - `completed`: 開始と終了が揃っている
 * - `missing_start`: 開始が見つからない（終了のみ）
 * - `missing_end`: 終了が見つからない（開始のみ）
 */
export type ActivityStatus = 'completed' | 'missing_start' | 'missing_end';

/**
 * 1 プレイヤーの貢献度統計。
 */
export interface PlayerStats {
  name: string;
  totalDamage: number;
  dps: number;
  hits: number;
  criticalHits: number;
  directHits: number;
  jobCode?: string;
  role?: 'T' | 'H' | 'D';
}

/**
 * 攻略 1 回分の要約。
 */
export interface CombatSegmentSummary {
  id: string;
  globalIndex: number;
  ordinal: number;
  content: string;
  start: Date | null;
  end: Date | null;
  status: ActivityStatus;
  durationMs: number | null;
  players: PlayerStats[];
  participants?: string[];
  presenceResolved?: boolean;
}

/**
 * 1 日分の攻略サマリ。
 */
export interface DailyCombatSummary {
  date: string;
  segments: CombatSegmentSummary[];
  availableDates: string[];
}
