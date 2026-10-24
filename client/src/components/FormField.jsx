// Label + control + field error, wired for screen readers (NFR-A11Y-01, NFR-UX-01).
import { cloneElement, useId } from 'react';
import { Label } from '@/components/ui/label';

export function FormField({ label, error, hint, children }) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(children, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
