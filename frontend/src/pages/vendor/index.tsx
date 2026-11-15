import { Navigate, Route, Routes } from "react-router-dom";
import { VendorCounter } from "./Counter";

/** Mounted at /vendor/*. Child paths are relative. */
export function VendorRoutes() {
  return (
    <Routes>
      <Route index element={<VendorCounter />} />
      <Route path="*" element={<Navigate to="/vendor" replace />} />
    </Routes>
  );
}

export default VendorRoutes;
