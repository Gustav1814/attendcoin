import { House, ReceiptText, ScanLine, Store } from "lucide-react";
import type { NavItem } from "@/shell/nav";

export const studentNav: NavItem[] = [
  { to: "/student", label: "Overview", icon: House, end: true },
  { to: "/student/checkin", label: "Check in", icon: ScanLine },
  { to: "/student/store", label: "Store", icon: Store },
  { to: "/student/redemptions", label: "Redemptions", icon: ReceiptText },
];
