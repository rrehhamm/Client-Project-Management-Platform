import { Badge } from '@/components/ui/badge';
import { t } from '@/i18n';

const PROJECT_VARIANT = { NotStarted: 'secondary', InProgress: 'default', OnHold: 'warning', Completed: 'success', Cancelled: 'outline' };
const CLIENT_VARIANT = { Lead: 'warning', Active: 'success', Inactive: 'secondary', Archived: 'outline' };
const MILESTONE_VARIANT = { Upcoming: 'secondary', InProgress: 'default', Completed: 'success' };

export const ProjectStatusBadge = ({ status }) => <Badge variant={PROJECT_VARIANT[status]}>{t(`projectStatus.${status}`)}</Badge>;
export const ClientStatusBadge = ({ status }) => <Badge variant={CLIENT_VARIANT[status]}>{t(`clientStatus.${status}`)}</Badge>;
export const MilestoneStatusBadge = ({ status }) => <Badge variant={MILESTONE_VARIANT[status]}>{t(`milestoneStatus.${status}`)}</Badge>;
/** Overdue is shown as text, not colour alone (NFR-A11Y-01). */
export const OverdueBadge = () => <Badge variant="destructive">{t('projects.overdue')}</Badge>;
