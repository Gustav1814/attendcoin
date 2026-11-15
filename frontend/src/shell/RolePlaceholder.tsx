import { ROLE_LABEL, type Role } from "@/lib/roles";
import { EmptyState } from "@/ui/EmptyState";
import { Page, PageHeader } from "@/ui/Page";

/** Stand-in until a role's pages are built. */
export function RolePlaceholder({ role }: { role: Role }) {
  return (
    <Page>
      <PageHeader eyebrow={ROLE_LABEL[role]} title="Overview" />
      <EmptyState title="Nothing here yet" body={`${ROLE_LABEL[role]} screens will appear here.`} />
    </Page>
  );
}
