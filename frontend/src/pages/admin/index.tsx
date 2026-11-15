import { Navigate, Route, Routes } from "react-router-dom";
import { AdminCatalogue } from "./Catalogue";
import { AdminCourses } from "./Courses";
import { AdminEconomy } from "./Economy";
import { AdminOverview } from "./Overview";
import { AdminPeople } from "./People";

/** Mounted at /admin/*. Child paths are relative, e.g. <Route path="courses/:id" />. */
export function AdminRoutes() {
  return (
    <Routes>
      <Route index element={<AdminOverview />} />
      <Route path="people" element={<AdminPeople />} />
      <Route path="courses" element={<AdminCourses />} />
      <Route path="economy" element={<AdminEconomy />} />
      <Route path="catalogue" element={<AdminCatalogue />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

export default AdminRoutes;
