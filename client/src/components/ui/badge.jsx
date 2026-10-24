import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary text-primary-foreground',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      outline: 'text-foreground',
      success: 'border-transparent bg-success/15 text-success',
      warning: 'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400',
      destructive: 'border-transparent bg-destructive/15 text-destructive',
    },
  },
  defaultVariants: { variant: 'default' },
});

function Badge({ className, variant, ...props }) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
