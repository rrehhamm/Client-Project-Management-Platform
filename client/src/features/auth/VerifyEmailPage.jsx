// FR-AUTH-13: confirm a new sign-in email from the emailed link.
// The user presses the button, so link scanners in mail clients do not consume the token.
import { Link, useSearchParams } from 'react-router';
import { useVerifyEmail } from '@/api/auth';
import { AuthCard } from '@/components/AuthLayout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const verify = useVerifyEmail();

  return (
    <AuthCard title={t('auth.verifyEmail.title')}>
      {!token ? (
        <Alert variant="destructive">{t('auth.reset.missingToken')}</Alert>
      ) : verify.isSuccess ? (
        <div className="grid gap-4">
          <Alert variant="success">{t('auth.verifyEmail.done', { email: verify.data.email })}</Alert>
          <Button asChild>
            <Link to="/">{t('auth.verifyEmail.continue')}</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          {verify.error ? <Alert variant="destructive">{verify.error.message}</Alert> : null}
          <Button onClick={() => verify.mutate({ token })} disabled={verify.isPending}>
            {verify.isPending ? t('auth.verifyEmail.verifying') : t('auth.verifyEmail.title')}
          </Button>
        </div>
      )}
    </AuthCard>
  );
}
