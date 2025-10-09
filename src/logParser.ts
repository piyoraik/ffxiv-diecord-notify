import { fetchDailyCombat } from './services/combatAnalyzer.js';
import { appSettings } from './config.js';
import { type ActivityStatus, type CombatSegmentSummary, type DailyCombatSummary, type PlayerStats } from './types/combat.js';
import { roleForJobCode } from './jobs.js';
import { replaceJobTagsWithEmojis } from './emoji.js';

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
  participants?: string[];
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

/**
 * 指定日のログを集計し、UI 向けの要約構造に変換する。
 * @param requestedDate YYYY-MM-DD の文字列（省略時は前日もしくは最新対象日）
 * @returns 要約データと利用可能日付一覧
 */
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
    globalIndex: segment.globalIndex,
    participants: segment.participants
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

/**
 * 日次要約を Discord メッセージ文字列へ整形する。
 * @param summary 日次要約
 * @param availableDates 利用可能日付一覧
 */
export const formatSummaryMessage = (
  summary: DailySummary,
  availableDates: string[],
  opts?: { rosterNames?: Set<string>; guild?: { id: string; emojis: { cache: Map<any, any> } }; showTop?: boolean }
): string => {
  const lines: string[] = [];
  lines.push(`📅 ${summary.date} の攻略履歴`);
  if (summary.entries.length === 0) {
    lines.push('記録が見つかりませんでした。');
  } else {
    summary.entries.forEach(entry => {
      lines.push(renderSummaryEntry(entry, opts?.showTop !== false));
      // 登録プレイヤーの参加があれば併記
      if (opts?.rosterNames && entry.players.length > 0) {
        const matched = entry.players.filter(p => opts.rosterNames!.has(p.name));
        if (matched.length > 0) {
          const parts = matched.map(p => renderPlayerLabel(p));
          lines.push(`  参加（登録者）: ${parts.join(', ')}`);
        }
      }
    });
  }
  if (summary.issues.length > 0) {
    lines.push('⚠️ ペアリングに失敗したログがあります:');
    summary.issues.forEach(issue => lines.push(`  - ${issue}`));
  }
  if (availableDates.length > 1) {
    lines.push(`📚 利用可能な日付: ${availableDates.join(', ')}`);
  }
  const text = lines.join('\n');
  return replaceJobTagsWithEmojis(text, (opts as any)?.guild ?? null);
};

/**
 * 同日の攻略一覧を一覧表示用のメッセージに整形する。
 * @param date 対象日 (YYYY-MM-DD)
 * @param segments 攻略サマリ配列
 */
export const formatDpsListMessage = (
  date: string,
  segments: CombatSegmentSummary[],
  opts?: { guild?: { id: string; emojis: { cache: Map<any, any> } } } // 簡易型（handlers からのみ利用）
): string => {
  const lines: string[] = [];
  lines.push(`📊 ${date} の攻略一覧`);
  segments.forEach((segment, index) => {
    const label = `${index + 1}. 「${segment.content}」 #${segment.ordinal}`;
    const duration = segment.durationMs !== null ? formatDuration(segment.durationMs) : '所要時間不明';
    const start = segment.start ? timeFormatter.format(segment.start) : '??:??';
    const end = segment.end ? timeFormatter.format(segment.end) : '??:??';
    const top = segment.players[0];
    const topInfo = top ? ` / Top: ${renderPlayerLabel(top)} ${Math.round(top.dps)} DPS` : '';
    lines.push(`${label} (${start}〜${end} / ${duration})${topInfo}`);
  });
  lines.push('`index` オプションで対象番号を指定してください。');
  const text = lines.join('\n');
  // ギルド絵文字が使える場合は [JOB] を置換
  return replaceJobTagsWithEmojis(text, (opts as any)?.guild ?? null);
};

/**
 * 指定攻略の DPS ランキング詳細をメッセージに整形する。
 * @param segment 攻略サマリ
 * @param date 対象日 (YYYY-MM-DD)
 */
export const formatDpsDetailMessage = (
  segment: CombatSegmentSummary,
  date: string,
  opts?: { guild?: { id: string; emojis: { cache: Map<any, any> } } }
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
      `  ${idx + 1}. ${renderPlayerLabel(player)} ${Math.round(player.dps)} DPS (総ダメージ ${player.totalDamage}, ヒット ${player.hits})`
    );
  });

  const text = lines.join('\n');
  return replaceJobTagsWithEmojis(text, (opts as any)?.guild ?? null);
};

export const fetchDailyCombatSummary = fetchDailyCombat;

/**
 * 要約中に検知した不整合（開始や終了の欠落）を収集する。
 * @param entries 日次要約のエントリ配列
 */
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

/**
 * 要約 1 行分をレンダリングする。
 * @param entry 要約エントリ
 */
const renderSummaryEntry = (entry: SummaryEntry, showTop = true): string => {
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
  if (showTop && topPlayers.length > 0) {
    const extras = topPlayers
      .map((player, idx) => `    ${idx + 1}. ${renderPlayerLabel(player)} ${Math.round(player.dps)} DPS (総 ${player.totalDamage})`)
      .join('\n');
    return `${line}\n${extras}`;
  }
  return line;
};

/**
 * ミリ秒の継続時間を「H時間M分S秒」表記に整形する。
 * @param durationMs 継続時間（ミリ秒）
 */
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

/**
 * JST タイムゾーンでの日付を YYYY-MM-DD で返す。
 */
export const formatDateJst = (date: Date): string => dateFormatter.format(date);

// 表示ラベル: 役割絵文字 + [JOB] + 名前（jobCode が無ければ名前のみ）
const renderPlayerLabel = (player: PlayerStats): string => {
  if (!player.jobCode) return player.name;
  const role = roleForJobCode(player.jobCode);
  const roleEmoji = role === 'T' ? '🛡️' : role === 'H' ? '🩹' : role === 'D' ? '⚔️' : '';
  return `${roleEmoji ? roleEmoji + ' ' : ''}[${player.jobCode}] ${player.name}`;
};
