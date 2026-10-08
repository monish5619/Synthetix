import type { Route } from '../route';
import { navItemFor } from '../shell/nav';
import { Badge, EmptyState, PageHeader } from '../ui/layout';

/**
 * For navigation items whose page does not exist yet. It says so plainly:
 * no mock data, no pretend charts, no disabled-looking controls.
 */
export function ComingSoonPage({ route }: { route: Route }) {
  const { label, icon } = navItemFor(route);
  return (
    <section className="page" aria-labelledby="page-title">
      <PageHeader title={label} subtitle="Not built yet" actions={<Badge tone="neutral">Soon</Badge>} />
      <EmptyState icon={icon} title={`${label} isn't available yet`} hint="It will appear here in a later release." />
    </section>
  );
}
