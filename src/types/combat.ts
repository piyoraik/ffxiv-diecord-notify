export type ActivityStatus = 'completed' | 'missing_start' | 'missing_end';

export interface PlayerStats {
  name: string;
  totalDamage: number;
  dps: number;
  hits: number;
  criticalHits: number;
  directHits: number;
}

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
}

export interface DailyCombatSummary {
  date: string;
  segments: CombatSegmentSummary[];
  availableDates: string[];
}
