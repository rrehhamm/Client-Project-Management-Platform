// D-37: image attachments (PNG, JPG, GIF, WebP) show as a small thumbnail inside the
// comment; clicking it opens the full image. Other types keep the file chip.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { fileUrl } from '@/api/comms';
import { useApiBase } from '@/lib/apiScope';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n';

export function ImageAttachment({ attachment }) {
  const base = useApiBase();
  const [open, setOpen] = useState(false);
  // Signed links last 10 minutes (FR-FILE-04); reuse one for up to 8
  const link = useQuery({
    queryKey: ['files', 'preview', base, attachment.file_id, attachment.version_no],
    queryFn: () => fileUrl(attachment.file_id, attachment.version_no, { inline: true, base }),
    staleTime: 8 * 60_000,
    gcTime: 8 * 60_000,
  });
  const download = async () => {
    const { url } = await fileUrl(attachment.file_id, attachment.version_no, { base });
    window.location.assign(url);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('comments.openImage', { name: attachment.name })}
        className="block overflow-hidden rounded-md border hover:ring-2 hover:ring-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        data-testid={`thumb-${attachment.file_id}`}
      >
        {link.data ? (
          <img src={link.data.url} alt="" className="h-20 w-28 object-cover" loading="lazy" />
        ) : (
          <Skeleton className="h-20 w-28" />
        )}
      </button>
      {open ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle className="break-all">{attachment.name}</DialogTitle>
            </DialogHeader>
            {link.data ? <img src={link.data.url} alt={attachment.name} className="mx-auto max-h-[70vh] rounded-md object-contain" /> : <Skeleton className="h-64 w-full" />}
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => download()}>
                {t('files.download')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
