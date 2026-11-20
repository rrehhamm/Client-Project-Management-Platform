import { cn } from '@/lib/utils';

// Native <select> styled like shadcn inputs: accessible and keyboard-friendly by default.
function Select({ className, children, ...props }) {
  return (
    <select
      data-slot="select"
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-card text-foreground px-3 py-1 text-base shadow-card outline-none md:text-sm',
        'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export { Select };
