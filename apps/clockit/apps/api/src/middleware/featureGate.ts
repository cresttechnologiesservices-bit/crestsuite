import { Response, NextFunction } from "express";
import { AuthedRequest } from "./auth";
import { getWorkspaceSettings } from "../lib/workspaceSettings";

type Feature = "timesheet" | "timeTracker" | "kiosk";

const LABEL: Record<Feature, string> = {
  timesheet: "Timesheet",
  timeTracker: "Time Tracker",
  kiosk: "Kiosk",
};

/**
 * Blocks a whole module when the workspace has that feature switched off.
 *
 * The check lives on the server so turning a feature off actually removes it —
 * hiding the navigation entry is not enough, since a direct URL or a hand-made
 * API call would otherwise still work.
 */
export function requireFeature(feature: Feature) {
  return async (_req: AuthedRequest, res: Response, next: NextFunction) => {
    const settings = await getWorkspaceSettings();
    const enabled =
      feature === "timesheet"
        ? settings.timesheetEnabled
        : feature === "timeTracker"
          ? settings.timeTrackerEnabled
          : settings.kioskEnabled;
    if (!enabled) {
      return res.status(403).json({
        error: "feature_disabled",
        feature,
        message: `${LABEL[feature]} is turned off for this workspace.`,
      });
    }
    next();
  };
}
