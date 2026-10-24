import { FileQuestion } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <FileQuestion aria-hidden="true" className="size-10 text-muted-foreground" />
      <h1 className="text-xl font-semibold">{t('notFound.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('notFound.body')}</p>
      <Button asChild variant="outline">
        <Link to="/">{t('notFound.home')}</Link>
      </Button>
    </div>
  );
}
