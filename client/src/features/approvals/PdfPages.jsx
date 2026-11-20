// PDF pages for the proofing viewer (D-41). This file is loaded on demand, so pdf.js
// (a large library) is only downloaded when someone opens a PDF to proof.
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState } from 'react';
import { t } from '@/i18n';

GlobalWorkerOptions.workerSrc = workerUrl;

function Page({ pdf, number, width, children, onClick }) {
  const canvas = useRef(null);
  const [size, setSize] = useState(null);
  useEffect(() => {
    let task;
    let live = true;
    pdf.getPage(number).then((page) => {
      if (!live) return;
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width;
      const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
      const c = canvas.current;
      c.width = viewport.width;
      c.height = viewport.height;
      setSize({ w: width, h: (base.height * width) / base.width });
      task = page.render({ canvasContext: c.getContext('2d'), viewport });
    });
    return () => {
      live = false;
      task?.cancel();
    };
  }, [pdf, number, width]);
  return (
    <div className="relative mx-auto border bg-white shadow-sm" style={size ? { width: size.w, height: size.h } : { width }} onClick={(e) => onClick?.(e, number)}>
      <canvas ref={canvas} className="block size-full" aria-label={t('approvals.page', { n: number })} />
      {children}
    </div>
  );
}

/** Renders every page; `renderPins(page)` draws that page's pins on top. */
export default function PdfPages({ url, width, onPageClick, renderPins }) {
  const [pdf, setPdf] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    const loading = getDocument({ url, withCredentials: false });
    loading.promise.then(setPdf, (err) => setError(err.message));
    return () => loading.destroy();
  }, [url]);
  if (error) return <p className="text-sm text-destructive">{t('approvals.pdfError')}</p>;
  if (!pdf) return <p className="text-sm text-muted-foreground">{t('states.loading')}</p>;
  return (
    <div className="space-y-4">
      {Array.from({ length: pdf.numPages }, (_, i) => (
        <Page key={i + 1} pdf={pdf} number={i + 1} width={width} onClick={onPageClick}>
          {renderPins(i + 1)}
        </Page>
      ))}
    </div>
  );
}
