import { BookOpen, Coins } from "lucide-react";
import type { NavItem } from "@/shell/nav";

export const teacherNav: NavItem[] = [
  { to: "/teacher", label: "Courses", icon: BookOpen, end: true },
  { to: "/teacher/issuance", label: "Issuance", icon: Coins },
];
