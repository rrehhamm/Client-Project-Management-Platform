import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t } from '@/i18n';

/** Yes/no confirmation for actions that are hard to undo. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = t('team.confirm.confirm'), destructive, pending, error, onConfirm }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? <Alert variant="destructive">{error.message}</Alert> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm} disabled={pending}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
