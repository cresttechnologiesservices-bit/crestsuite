import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useWorkspace, Workspace } from "../../lib/workspace";

/**
 * Renders a route only while its workspace feature is switched on.
 *
 * Hiding the navigation entry is not enough on its own — someone can still
 * type the URL — so this blocks the page too. The API applies the same rule,
 * which is what actually protects the data.
 */
export function FeatureRoute({
  feature,
  label,
  children,
}: {
  feature: keyof Pick<Workspace, "timesheetEnabled" | "timeTrackerEnabled" | "kioskEnabled">;
  label: string;
  children: ReactNode;
}) {
  const workspace = useWorkspace();
  if (workspace[feature]) return <>{children}</>;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="bg-white rounded-lg shadow p-10 text-center">
        <div className="text-3xl mb-3">🔒</div>
        <h1 className="text-lg font-semibold text-slate-900">{label} is turned off</h1>
        <p className="text-slate-600 mt-2">
          An administrator has disabled {label} for the <strong>{workspace.name}</strong>{" "}
          workspace. It can be switched back on in Workspace Settings → General.
        </p>
        <Link
          to="/dashboard"
          className="inline-block mt-6 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
