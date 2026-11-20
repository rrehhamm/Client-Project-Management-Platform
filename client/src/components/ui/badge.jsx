import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// D-45: soft tinted badges with an inset ring; status colours come from tokens.css.
const badgeVariants = cva('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset', {
  variants: {
    variant: {
      default: 'bg-brand-soft text-brand-text ring-brand-text/20',
      secondary: 'bg-muted text-muted-foreground ring-border',
      outline: 'bg-transparent text-foreground ring-border',
      success: 'bg-success-soft text-success ring-success/25',
      warning: 'bg-warning-soft text-warning ring-warning/25',
      destructive: 'bg-destructive-soft text-destructive ring-destructive/25',
      info: 'bg-info-soft text-info ring-info/25',
    },
  },
  defaultVariants: { variant: 'default' },
});

function Badge({ className, variant, ...props }) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
