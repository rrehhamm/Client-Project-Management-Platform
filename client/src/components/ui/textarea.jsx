import { cn } from '@/lib/utils';

// shadcn/ui Textarea (JavaScript version)
function Textarea({ className, ...props }) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-20 w-full rounded-md border border-input bg-card text-foreground px-3 py-2 text-base shadow-card outline-none placeholder:text-muted-foreground md:text-sm',
        'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
