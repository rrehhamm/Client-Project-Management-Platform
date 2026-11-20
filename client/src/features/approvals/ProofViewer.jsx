// FR-APP-02 proofing: the file being approved, with numbered pins. While the approval is
// pending, people allowed to pin click a spot and type a note. Positions are stored as
// 0–1 fractions of the page (D-41), so pins stay in place at any width.
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';

const PdfPages = lazy(() => import('./PdfPages'));

function useWidth(ref) {
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function Pin({ pin, active, onSelect }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(pin.id);
      }}
      aria-label={t('approvals.pinLabel', { n: pin.number, body: pin.body })}
      className={cn('absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-bold shadow-card', active ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground')}
      style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
    >
      {pin.number}
    </button>
  );
}

/**
 * @param {object} props
 * @param {object} props.approval  { id, status, subject, pins }
 * @param {() => Promise<{url, mime_type}>} props.loadUrl
 * @param {boolean} props.canPin
 * @param {(pin: {page, x, y, body}) => Promise<unknown>} props.onAddPin
 */
export function ProofViewer({ approval, loadUrl, canPin, onAddPin, pinPending, pinError }) {
  const box = useRef(null);
  const width = useWidth(box);
  const [draft, setDraft] = useState(null); // { page, x, y }
  const [text, setText] = useState('');
  const [active, setActive] = useState(null);
  const link = useQuery({ queryKey: ['proof', approval.id], queryFn: loadUrl, staleTime: 8 * 60_000, gcTime: 8 * 60_000, enabled: approval.subject.type === 'file' });
  const mime = approval.subject.mime_type;

  const place = (e, page = 1) => {
    if (!canPin) return;
    const r = e.currentTarget.getBoundingClientRect();
    setDraft({ page, x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) });
    setText('');
  };
  const pinsOn = (page) => (
    <>
      {approval.pins.filter((p) => p.page === page).map((p) => (
        <Pin key={p.id} pin={p} active={active === p.id} onSelect={setActive} />
      ))}
      {draft && draft.page === page ? <span aria-hidden="true" className="absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-destructive" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }} /> : null}
    </>
  );
  const save = async () => {
    if (!text.trim()) return;
    await onAddPin({ ...draft, body: text.trim() });
    setDraft(null);
    setText('');
  };

  if (approval.subject.type !== 'file') return null;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <div ref={box} className={cn('min-w-0', canPin && 'cursor-crosshair')}>
        {canPin ? <p className="mb-2 text-xs text-muted-foreground">{t('approvals.pinHint')}</p> : null}
        {link.isPending ? (
          <Skeleton className="h-96 w-full" />
        ) : link.error ? (
          <Alert variant="destructive">{link.error.message}</Alert>
        ) : mime === 'application/pdf' ? (
          <Suspense fallback={<Skeleton className="h-96 w-full" />}>
            <PdfPages url={link.data.url} width={width} onPageClick={place} renderPins={pinsOn} />
          </Suspense>
        ) : approval.subject.proofable ? (
          <div className="relative mx-auto w-fit" onClick={(e) => place(e, 1)}>
            <img src={link.data.url} alt={approval.subject.file.name} className="block max-h-[75vh] max-w-full" draggable={false} />
            {pinsOn(1)}
          </div>
        ) : (
          <p className="rounded-md border bg-muted/40 p-6 text-center text-sm text-muted-foreground">{t('files.noPreview')}</p>
        )}
      </div>
      <aside className="space-y-3" aria-label={t('approvals.pins')}>
        <h3 className="text-sm font-semibold">{t('approvals.pins')}</h3>
        {draft ? (
          <div className="space-y-2 rounded-md border p-2">
            <label className="text-xs font-medium" htmlFor="pin-text">
              {t('approvals.newPin', { n: approval.pins.length + 1 })}
            </label>
            <Textarea id="pin-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} autoFocus />
            {pinError ? <Alert variant="destructive">{pinError.message}</Alert> : null}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" disabled={!text.trim() || pinPending} onClick={save}>
                {t('approvals.addPin')}
              </Button>
            </div>
          </div>
        ) : null}
        {approval.pins.length === 0 ? <p className="text-sm text-muted-foreground">{t('approvals.noPins')}</p> : null}
        <ol className="space-y-2">
          {approval.pins.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setActive(p.id)} className={cn('w-full rounded-md border p-2 text-left text-sm hover:bg-accent', active === p.id && 'border-destructive')}>
                <span className="mr-1 inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{p.number}</span>
                {p.body}
                <span className="block text-xs text-muted-foreground">
                  {p.author.full_name}
                  {mime === 'application/pdf' ? ` · ${t('approvals.page', { n: p.page })}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
