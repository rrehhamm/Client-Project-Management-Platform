import { cn } from '@/lib/utils';

// shadcn/ui Skeleton (JavaScript version)
function Skeleton({ className, ...props }) {
  return <div data-slot="skeleton" className={cn('animate-pulse rounded-md bg-muted motion-reduce:animate-none', className)} {...props} />;
}

export { Skeleton };
