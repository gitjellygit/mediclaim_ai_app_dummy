import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login.jsx";
import NewClaim from "./pages/NewClaim.jsx";
import ClaimsList from "./modules/ai-claims/ClaimsList.jsx";
import ClaimDetail from "./modules/ai-claims/ClaimDetail.jsx";
import Rules from "./modules/rules/Rules.jsx";
import NewRule from "./modules/rules/NewRule.jsx";
import EditRule from "./modules/rules/EditRule.jsx";
import AnalyticsDashboard from "./modules/analytics/AnalyticsDashboard.jsx";
import DocumentIntelligence from "./modules/documents/DocumentIntelligence.jsx";
import ApprovalIntelligence from "./modules/approval/ApprovalIntelligence.jsx";
import MedicalConsistency from "./modules/medical-ai/MedicalConsistency.jsx";

import MainLayout from "./layout/MainLayout.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import { ProtectedRoute, RoleProtectedRoute } from "./components/ProtectedRoute.jsx";

/* ---------------- App Routes ---------------- */

function AppRoutes() {
  return (
    <Routes>
      {/* PUBLIC */}
      <Route path="/login" element={<Login />} />

      {/* PROTECTED */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Navigate to="/claims" replace />
          </ProtectedRoute>
        }
      />

      <Route
        path="/claims"
        element={
          <ProtectedRoute>
            <MainLayout>
              <ClaimsList />
            </MainLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/claims/new"
        element={
          <ProtectedRoute>
            <MainLayout>
              <NewClaim />
            </MainLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/claims/:id"
        element={
          <ProtectedRoute>
            <MainLayout>
              <ClaimDetail />
            </MainLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/medical-ai"
        element={
          <ProtectedRoute>
            <MainLayout>
              <MedicalConsistency />
            </MainLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/documents"
        element={
          <ProtectedRoute>
            <MainLayout>
              <DocumentIntelligence />
            </MainLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/approval"
        element={
          <ProtectedRoute>
            <MainLayout>
              <ApprovalIntelligence />
            </MainLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/analytics"
        element={
          <ProtectedRoute>
            <MainLayout>
              <AnalyticsDashboard />
            </MainLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/rules"
        element={
          <RoleProtectedRoute allowedRoles={["ADMIN"]}>
            <MainLayout>
              <Rules />
            </MainLayout>
          </RoleProtectedRoute>
        }
      />

      <Route
        path="/rules/new"
        element={
          <RoleProtectedRoute allowedRoles={["ADMIN"]}>
            <MainLayout>
              <NewRule />
            </MainLayout>
          </RoleProtectedRoute>
        }
      />

      <Route
        path="/rules/:id/edit"
        element={
          <RoleProtectedRoute allowedRoles={["ADMIN"]}>
            <MainLayout>
              <EditRule />
            </MainLayout>
          </RoleProtectedRoute>
        }
      />

      {/* FALLBACK */}
      <Route path="*" element={<Navigate to="/claims" replace />} />
    </Routes>
  );
}

/* ---------------- Root App ---------------- */

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
