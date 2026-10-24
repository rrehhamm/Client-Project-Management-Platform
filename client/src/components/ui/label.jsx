import { cn } from '@/lib/utils';

// shadcn/ui Label (JavaScript version, native element)
function Label({ className, ...props }) {
  return <label data-slot="label" className={cn('text-sm font-medium leading-none select-none', className)} {...props} />;
}

export { Label };
