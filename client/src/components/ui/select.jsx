import { cn } from '@/lib/utils';

// Native <select> styled like shadcn inputs: accessible and keyboard-friendly by default.
function Select({ className, children, ...props }) {
  return (
    <select
      data-slot="select"
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base shadow-xs outline-none md:text-sm',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
        'aria-invalid:border-destructive',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export { Select };
