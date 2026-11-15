import { lazy } from "react";
import { Outlet, Route, Routes } from "react-router-dom";
import { Landing } from "./pages/Landing";
import { CheckIn } from "./pages/student/CheckIn";
import { Overview } from "./pages/student/Overview";
import { Redemptions } from "./pages/student/Redemptions";
import { StoreFront } from "./pages/student/Store";
import { AppShell } from "./shell/AppShell";
import { NotFound } from "./shell/NotFound";
import { RequireRole } from "./shell/RequireRole";

// Role areas built separately load on demand so students never download them.
const TeacherRoutes = lazy(() => import("./pages/teacher"));
const AdminRoutes = lazy(() => import("./pages/admin"));
const VendorRoutes = lazy(() => import("./pages/vendor"));

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Landing />} />
        <Route
          path="checkin"
          element={
            <RequireRole role="student">
              <CheckIn />
            </RequireRole>
          }
        />
        <Route
          path="student"
          element={
            <RequireRole role="student">
              <Outlet />
            </RequireRole>
          }
        >
          <Route index element={<Overview />} />
          <Route path="checkin" element={<CheckIn />} />
          <Route path="store" element={<StoreFront />} />
          <Route path="redemptions" element={<Redemptions />} />
        </Route>
        <Route
          path="teacher/*"
          element={
            <RequireRole role="teacher">
              <TeacherRoutes />
            </RequireRole>
          }
        />
        <Route
          path="admin/*"
          element={
            <RequireRole role="admin">
              <AdminRoutes />
            </RequireRole>
          }
        />
        <Route
          path="vendor/*"
          element={
            <RequireRole role="vendor">
              <VendorRoutes />
            </RequireRole>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
