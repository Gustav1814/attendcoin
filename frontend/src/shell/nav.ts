import type { LucideIcon } from "lucide-react";
import type { Role } from "@/lib/roles";
import { adminNav } from "@/pages/admin/nav";
import { studentNav } from "@/pages/student/nav";
import { teacherNav } from "@/pages/teacher/nav";
import { vendorNav } from "@/pages/vendor/nav";

export interface NavItem {
  /** Absolute path, e.g. "/teacher/sessions". */
  to: string;
  label: string;
  icon?: LucideIcon;
  /** Match the path exactly; set for a role's index route. */
  end?: boolean;
}

export const NAV: Record<Role, NavItem[]> = {
  student: studentNav,
  teacher: teacherNav,
  admin: adminNav,
  vendor: vendorNav,
};

export function sectionOf(pathname: string): Role | null {
  const first = pathname.split("/")[1];
  if (first === "checkin") return "student";
  return first === "student" || first === "teacher" || first === "admin" || first === "vendor" ? first : null;
}
