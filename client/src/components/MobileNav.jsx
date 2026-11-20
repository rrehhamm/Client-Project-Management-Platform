// D-45: the sidebar as a drawer below 768 px (Radix dialog: focus trapped, Escape closes).
// Loaded lazily by InternalLayout on first open, so the dialog code stays out of the main bundle.
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { t } from '@/i18n';

export default function MobileNav({ open, onOpenChange, header, children }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay md:hidden" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] flex-col border-e bg-sidebar shadow-overlay outline-none md:hidden"
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <DialogPrimitive.Title asChild>
              <div className="min-w-0 flex-1">{header}</div>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label={t('nav.closeMenu')}
              className="cursor-pointer rounded-md p-1.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden="true" className="size-4" />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
