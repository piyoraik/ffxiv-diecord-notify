import { fetchDailyCombat } from './services/combatAnalyzer.js';
import { appSettings } from './config.js';
import { type ActivityStatus, type CombatSegmentSummary, type DailyCombatSummary, type PlayerStats } from './types/combat.js';

const TIME_ZONE = appSettings.timeZone();

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const timeFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: TIME_ZONE,
  hour12: false,
  hour: '2-digit',
  minute: '2-digit'
});

export type { ActivityStatus, CombatSegmentSummary, DailyCombatSummary, PlayerStats } from './types/combat.js';

export interface SummaryEntry {
  content: string;
  start: Date | null;
  end: Date | null;
  durationMs: number | null;
  status: ActivityStatus;
  players: PlayerStats[];
  ordinal: number;
  globalIndex: number;
}

export interface DailySummary {
  date: string;
  entries: SummaryEntry[];
  issues: string[];
}

export interface SummaryResult {
  summary: DailySummary | null;
  availableDates: string[];
}

export const summarizeLogsByDate = async (requestedDate?: string): Promise<SummaryResult> => {
  const combat = await fetchDailyCombat(requestedDate);
  if (combat.segments.length === 0) {
    return {
      summary: {
        date: combat.date,
        entries: [],
        issues: []
      },
      availableDates: combat.availableDates
    };
  }

  const entries: SummaryEntry[] = combat.segments.map(segment => ({
    content: segment.content,
    start: segment.start,
    end: segment.end,
    durationMs: segment.durationMs,
    status: segment.status,
    players: segment.players,
    ordinal: segment.ordinal,
    globalIndex: segment.globalIndex
  }));

  const issues = collectIssues(entries);

  return {
    summary: {
      date: combat.date,
      entries,
      issues
    },
    availableDates: combat.availableDates
  };
};

export const formatSummaryMessage = (
  summary: DailySummary,
  availableDates: string[]
): string => {
  const lines: string[] = [];
  lines.push(`📅 ${summary.date} の攻略履歴`);
  if (summary.entries.length === 0) {
    lines.push('記録が見つかりませんでした。');
  } else {
    summary.entries.forEach(entry => {
      lines.push(renderSummaryEntry(entry));
    });
  }
  if (summary.issues.length > 0) {
    lines.push('⚠️ ペアリングに失敗したログがあります:');
    summary.issues.forEach(issue => lines.push(`  - ${issue}`));
  }
  if (availableDates.length > 1) {
    lines.push(`📚 利用可能な日付: ${availableDates.join(', ')}`);
  }
  return lines.join('\n');
};

export const formatDpsListMessage = (
  date: string,
  segments: CombatSegmentSummary[]
): string => {
  const lines: string[] = [];
  lines.push(`📊 ${date} の攻略一覧`);
  segments.forEach((segment, index) => {
    const label = `${index + 1}. 「${segment.content}」 #${segment.ordinal}`;
    const duration = segment.durationMs !== null ? formatDuration(segment.durationMs) : '所要時間不明';
    const start = segment.start ? timeFormatter.format(segment.start) : '??:??';
    const end = segment.end ? timeFormatter.format(segment.end) : '??:??';
    const top = segment.players[0];
    const topInfo = top ? ` / Top: ${top.name} ${Math.round(top.dps)} DPS` : '';
    lines.push(`${label} (${start}〜${end} / ${duration})${topInfo}`);
  });
  lines.push('`index` オプションで対象番号を指定してください。');
  return lines.join('\n');
};

export const formatDpsDetailMessage = (
  segment: CombatSegmentSummary,
  date: string
): string => {
  const lines: string[] = [];
  const header = `📊 ${date} 「${segment.content}」 #${segment.ordinal}`;
  lines.push(header);
  const start = segment.start ? timeFormatter.format(segment.start) : '??:??';
  const end = segment.end ? timeFormatter.format(segment.end) : '??:??';
  const duration = segment.durationMs !== null ? formatDuration(segment.durationMs) : '所要時間不明';
  lines.push(`時間: ${start}〜${end} / ${duration}`);

  if (segment.players.length === 0) {
    lines.push('プレイヤーの与ダメージが見つかりませんでした。');
    return lines.join('\n');
  }

  lines.push('DPSランキング:');
  segment.players.forEach((player, idx) => {
    lines.push(
      `  ${idx + 1}. ${player.name} ${Math.round(player.dps)} DPS (総ダメージ ${player.totalDamage}, ヒット ${player.hits})`
    );
  });

  return lines.join('\n');
};

export const fetchDailyCombatSummary = fetchDailyCombat;

const collectIssues = (entries: SummaryEntry[]): string[] => {
  const issues: string[] = [];
  entries.forEach(entry => {
    if (entry.status === 'missing_end' && entry.start) {
      issues.push(`終了ログなし: 「${entry.content}」 (開始 ${entry.start.toISOString()})`);
    }
    if (entry.status === 'missing_start' && entry.end) {
      issues.push(`開始ログなし: 「${entry.content}」 (終了 ${entry.end.toISOString()})`);
    }
  });
  return issues;
};

const renderSummaryEntry = (entry: SummaryEntry): string => {
  const start = entry.start ? timeFormatter.format(entry.start) : '??:??';
  const end = entry.end ? timeFormatter.format(entry.end) : '??:??';
  const duration = entry.durationMs !== null ? formatDuration(entry.durationMs) : '所要時間不明';
  let line: string;
  switch (entry.status) {
    case 'completed':
      line = `- ${start}〜${end} 「${entry.content}」 #${entry.ordinal} ${duration}`;
      break;
    case 'missing_end':
      line = `- ${start}〜??:?? 「${entry.content}」 #${entry.ordinal} (終了ログなし)`;
      break;
    case 'missing_start':
    default:
      line = `- ??:??〜${end} 「${entry.content}」 #${entry.ordinal} (開始ログなし)`;
  }

  const topPlayers = entry.players.slice(0, 3);
  if (topPlayers.length > 0) {
    const extras = topPlayers
      .map((player, idx) => `    ${idx + 1}. ${player.name} ${Math.round(player.dps)} DPS (総 ${player.totalDamage})`)
      .join('\n');
    return `${line}\n${extras}`;
  }
  return line;
};

const formatDuration = (durationMs: number): string => {
  const totalSeconds = Math.max(Math.floor(durationMs / 1000), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}時間`);
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}分`);
  }
  parts.push(`${seconds}秒`);
  return parts.join('');
};

export const formatDateJst = (date: Date): string => dateFormatter.format(date);
