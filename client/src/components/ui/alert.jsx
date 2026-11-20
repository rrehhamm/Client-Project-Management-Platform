import { cn } from '@/lib/utils';

// Inline message box. role="alert" for errors so screen readers announce them.
function Alert({ className, variant = 'default', ...props }) {
  return (
    <div
      role={variant === 'destructive' ? 'alert' : 'status'}
      data-slot="alert"
      className={cn(
        'rounded-lg border px-4 py-3 text-sm',
        variant === 'default' && 'bg-card text-foreground',
        variant === 'info' && 'border-info/30 bg-info-soft text-info',
        variant === 'destructive' && 'border-destructive/30 bg-destructive-soft text-destructive',
        variant === 'success' && 'border-success/30 bg-success-soft text-success',
        variant === 'warning' && 'border-warning/30 bg-warning-soft text-warning',
        className,
      )}
      {...props}
    />
  );
}

export { Alert };
