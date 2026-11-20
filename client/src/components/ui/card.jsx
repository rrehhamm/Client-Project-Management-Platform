import { cn } from '@/lib/utils';

// shadcn/ui Card (JavaScript version)
function Card({ className, ...props }) {
  return (
    <div
      data-slot="card"
      className={cn('flex flex-col gap-5 rounded-lg border bg-card py-5 text-card-foreground shadow-card', className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }) {
  return <div data-slot="card-header" className={cn('grid gap-1.5 px-5', className)} {...props} />;
}

function CardTitle({ className, ...props }) {
  return <div data-slot="card-title" className={cn('text-sm font-semibold leading-none', className)} {...props} />;
}

function CardDescription({ className, ...props }) {
  return <div data-slot="card-description" className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

function CardContent({ className, ...props }) {
  return <div data-slot="card-content" className={cn('px-5', className)} {...props} />;
}

export { Card, CardContent, CardDescription, CardHeader, CardTitle };
