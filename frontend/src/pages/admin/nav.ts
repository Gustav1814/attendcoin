import { BookOpen, Coins, LayoutDashboard, Package, Users } from "lucide-react";
import type { NavItem } from "@/shell/nav";

export const adminNav: NavItem[] = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/admin/people", label: "People", icon: Users },
  { to: "/admin/courses", label: "Courses", icon: BookOpen },
  { to: "/admin/economy", label: "Economy", icon: Coins },
  { to: "/admin/catalogue", label: "Catalogue", icon: Package },
];
