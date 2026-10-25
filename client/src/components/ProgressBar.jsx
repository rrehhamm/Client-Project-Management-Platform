import { t } from '@/i18n';

export function ProgressBar({ value }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-2 w-full min-w-16 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={t('projects.progress', { pct })}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}
