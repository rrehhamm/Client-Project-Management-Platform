import { cn } from '@/lib/utils';

// Inline message box. role="alert" for errors so screen readers announce them.
function Alert({ className, variant = 'default', ...props }) {
  return (
    <div
      role={variant === 'destructive' ? 'alert' : 'status'}
      data-slot="alert"
      className={cn(
        'rounded-lg border px-4 py-3 text-sm',
        variant === 'destructive' && 'border-destructive/40 bg-destructive/10 text-destructive',
        variant === 'success' && 'border-success/40 bg-success/10 text-success',
        variant === 'warning' && 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
        className,
      )}
      {...props}
    />
  );
}

export { Alert };
