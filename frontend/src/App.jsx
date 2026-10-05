import React, { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import MainLayout from "./layout/MainLayout.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import {
  ProtectedRoute,
  RoleProtectedRoute
} from "./components/ProtectedRoute.jsx";

const Login = lazy(() => import("./pages/Login.jsx"));
const NewClaim = lazy(() => import("./pages/NewClaim.jsx"));
const ClaimsList = lazy(() => import("./modules/ai-claims/ClaimsList.jsx"));
const ClaimDetail = lazy(() => import("./modules/ai-claims/ClaimDetail.jsx"));
const Rules = lazy(() => import("./modules/rules/Rules.jsx"));
const NewRule = lazy(() => import("./modules/rules/NewRule.jsx"));
const EditRule = lazy(() => import("./modules/rules/EditRule.jsx"));
const AnalyticsDashboard = lazy(() =>
  import("./modules/analytics/AnalyticsDashboard.jsx")
);
const DocumentIntelligence = lazy(() =>
  import("./modules/documents/DocumentIntelligence.jsx")
);
const ApprovalIntelligence = lazy(() =>
  import("./modules/approval/ApprovalIntelligence.jsx")
);
const MedicalConsistency = lazy(() =>
  import("./modules/medical-ai/MedicalConsistency.jsx")
);
const ClaimJourney = lazy(() => import("./modules/journey/ClaimJourney.jsx"));
const DenialIntelligence = lazy(() =>
  import("./modules/denials/DenialIntelligence.jsx")
);
const UnderpaymentIntelligence = lazy(() =>
  import("./modules/payments/UnderpaymentIntelligence.jsx")
);
const AuditTrail = lazy(() => import("./modules/audit/AuditTrail.jsx"));

const protectedRoutes = [
  { path: "/claims", Component: ClaimsList },
  { path: "/claims/new", Component: NewClaim },
  { path: "/claims/:id", Component: ClaimDetail },
  { path: "/journey", Component: ClaimJourney },
  { path: "/denials", Component: DenialIntelligence },
  { path: "/payments", Component: UnderpaymentIntelligence },
  { path: "/medical-ai", Component: MedicalConsistency },
  { path: "/documents", Component: DocumentIntelligence },
  { path: "/approval", Component: ApprovalIntelligence },
  { path: "/analytics", Component: AnalyticsDashboard }
];

const adminRoutes = [
  { path: "/rules", Component: Rules },
  { path: "/rules/new", Component: NewRule },
  { path: "/rules/:id/edit", Component: EditRule },
  { path: "/audit", Component: AuditTrail }
];

function RouteFallback() {
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "35vh"
      }}
    >
      Loading...
    </div>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/claims" replace />} />

          {protectedRoutes.map(({ path, Component }) => (
            <Route key={path} path={path} element={<Component />} />
          ))}

          {adminRoutes.map(({ path, Component }) => (
            <Route
              key={path}
              path={path}
              element={
                <RoleProtectedRoute allowedRoles={["ADMIN"]}>
                  <Component />
                </RoleProtectedRoute>
              }
            />
          ))}
        </Route>

        <Route path="*" element={<Navigate to="/claims" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
