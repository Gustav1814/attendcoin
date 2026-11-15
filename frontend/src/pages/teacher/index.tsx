import { Route, Routes } from "react-router-dom";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Page } from "@/ui/Page";
import { Course } from "./Course";
import { Courses } from "./Courses";
import { Issuance } from "./Issuance";
import { Session } from "./Session";

/** Mounted at /teacher/*. */
export function TeacherRoutes() {
  return (
    <Routes>
      <Route index element={<Courses />} />
      <Route path="courses/:courseId" element={<Course />} />
      <Route path="sessions/:sessionId" element={<Session />} />
      <Route path="issuance" element={<Issuance />} />
      <Route
        path="*"
        element={
          <Page>
            <EmptyState
              title="Nothing here"
              body="That page isn't part of the teacher area."
              action={<Button to="/teacher">Back to courses</Button>}
            />
          </Page>
        }
      />
    </Routes>
  );
}

export default TeacherRoutes;
