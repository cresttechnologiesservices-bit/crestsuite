import { useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "./api/client";
import { Layout } from "./components/layout/Layout";
import { Landing } from "./routes/landing";
import { Login } from "./routes/login";
import { Signup } from "./routes/signup";
import { Tracker } from "./routes/tracker";
import { Timesheet } from "./routes/timesheet";
import { Calendar } from "./routes/calendar";
import { Dashboard } from "./routes/dashboard";
import { Reports } from "./routes/reports";
import { Projects } from "./routes/projects";
import { Team } from "./routes/team";
import { Clients } from "./routes/clients";
import { Preferences } from "./routes/preferences";
import { Workspace } from "./routes/workspace";
import { Kiosk } from "./routes/kiosk";
import { FeatureRoute } from "./components/layout/FeatureRoute";
import { Profile } from "./routes/profile";
import { SharedReportView } from "./routes/sharedReport";
import { UiNotifyRoot } from "./components/ui/notify";

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

// Exchanges a ?sso=<token> handoff from the CrestSuite portal for a session
// cookie, so users arriving from the portal launcher skip the login screen.
function SsoGate({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const [exchanging, setExchanging] = useState(
    () => new URLSearchParams(window.location.search).has("sso")
  );
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("sso");
    if (!token) return;
    api
      .post("/auth/sso", { token })
      .then(() => nav("/tracker", { replace: true }))
      .catch(() => nav("/login", { replace: true }))
      .finally(() => setExchanging(false));
  }, []);
  if (exchanging) return <div className="min-h-screen grid place-items-center text-slate-500">Signing you in…</div>;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter basename="/clockit">
        <SsoGate>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/shared/reports/:slug" element={<SharedReportView />} />

          {/* Protected routes with sidebar layout */}
          <Route element={<Layout />}>
            {/* Feature toggles in Workspace Settings decide whether these
                routes exist; the API enforces the same rule. */}
            <Route
              path="/tracker"
              element={<FeatureRoute feature="timeTrackerEnabled" label="Time Tracker"><Tracker /></FeatureRoute>}
            />
            <Route
              path="/timesheet"
              element={<FeatureRoute feature="timesheetEnabled" label="Timesheet"><Timesheet /></FeatureRoute>}
            />
            <Route
              path="/kiosk"
              element={<FeatureRoute feature="kioskEnabled" label="Kiosk"><Kiosk /></FeatureRoute>}
            />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/reports/*" element={<Reports />} />
            <Route path="/projects/*" element={<Projects />} />
            <Route path="/team/*" element={<Team />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/preferences/*" element={<Preferences />} />
            <Route path="/workspace" element={<Workspace />} />
            <Route path="/profile" element={<Profile />} />
          </Route>

          <Route path="*" element={<Navigate to="/tracker" replace />} />
        </Routes>
        </SsoGate>
        {/* Toasts + confirm/prompt dialogs (replaces alert/confirm/prompt) */}
        <UiNotifyRoot />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
