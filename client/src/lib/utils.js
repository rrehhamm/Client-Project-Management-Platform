import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind class names, later classes winning (shadcn/ui helper). */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
