import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Page } from "@/ui/Page";

export function NotFound() {
  return (
    <Page width="narrow">
      <EmptyState
        title="Page not found"
        body="That address doesn't match any page in AttendCoin."
        action={
          <Button variant="secondary" to="/">
            Back to start
          </Button>
        }
      />
    </Page>
  );
}
