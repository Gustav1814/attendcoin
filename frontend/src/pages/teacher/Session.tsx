import { RotateCw } from "lucide-react";
import { useParams } from "react-router-dom";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Page } from "@/ui/Page";
import { Skeleton, SkeletonText } from "@/ui/Skeleton";
import { parseId, useTeacherSession } from "./data";
import { LiveSession } from "./LiveSession";
import { BackLink } from "./parts";
import { SessionSummary } from "./SessionSummary";

export function Session() {
  const id = parseId(useParams().sessionId);
  const lookup = useTeacherSession(id);

  if (id == null || lookup.data?.status === "missing") {
    return <Missing title="No such session" body="That session id doesn't exist on this network." />;
  }
  if (lookup.data?.status === "not-yours") {
    return <Missing title="Not your session" body="This session belongs to a course taught from another wallet." />;
  }
  if (lookup.isError && !lookup.data) {
    return (
      <Page>
        <BackLink to="/teacher">Courses</BackLink>
        <EmptyState
          tone="danger"
          title="Couldn't load this session"
          body="The chain didn't answer. Check the RPC connection and try again."
          action={
            <Button onClick={() => lookup.refetch()} leading={<RotateCw size={14} />}>
              Retry
            </Button>
          }
        />
      </Page>
    );
  }
  if (!lookup.data) {
    return (
      <Page aria-busy="true" aria-label="Loading session">
        <Skeleton width={120} height={14} />
        <Skeleton width="50%" height={40} />
        <SkeletonText lines={4} />
      </Page>
    );
  }

  const detail = lookup.data.data;
  // Keyed so a session that closes mid-view remounts cleanly into the summary.
  return detail.accepting ? (
    <LiveSession key={`live-${detail.session.id}`} detail={detail} />
  ) : (
    <SessionSummary key={`done-${detail.session.id}`} detail={detail} />
  );
}

function Missing({ title, body }: { title: string; body: string }) {
  return (
    <Page>
      <BackLink to="/teacher">Courses</BackLink>
      <EmptyState title={title} body={body} action={<Button to="/teacher">Back to courses</Button>} />
    </Page>
  );
}
