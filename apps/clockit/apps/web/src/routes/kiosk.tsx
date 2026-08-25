import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useWorkspace, formatDurationSeconds } from "../lib/workspace";
import { toast } from "../components/ui/notify";

/**
 * Kiosk mode — a full-screen clock in / clock out screen for a shared device
 * or wall display. Available only while Kiosk is switched on in Workspace
 * Settings; the API enforces the same rule, so the timer endpoints reject
 * calls when the Time Tracker feature is off.
 */
export function Kiosk() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const [now, setNow] = useState(Date.now());

  const { data: profile } = useQuery({
    queryKey: ["user-profile"],
    queryFn: async () => (await api.get("/users/me")).data,
  });

  const { data: running, isLoading } = useQuery({
    queryKey: ["running-timer"],
    queryFn: async () => (await api.get("/time-entries/running")).data,
    refetchInterval: 15_000,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data } = await api.get("/projects");
      return Array.isArray(data) ? data : (data.items ?? []);
    },
  });

  const [projectId, setProjectId] = useState("");

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const elapsed = running ? Math.floor((now - new Date(running.start).getTime()) / 1000) : 0;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["running-timer"] });
    queryClient.invalidateQueries({ queryKey: ["time-entries"] });
  };

  const clockIn = useMutation({
    mutationFn: async () =>
      (await api.post("/time-entries/start", { description: "", projectId: projectId || null })).data,
    onSuccess: () => {
      toast("Clocked in", "success");
      invalidate();
    },
    onError: (e: any) =>
      toast(e?.response?.data?.message || "Could not clock in", "error"),
  });

  const clockOut = useMutation({
    mutationFn: async () => (await api.post("/time-entries/stop")).data,
    onSuccess: () => {
      toast("Clocked out", "success");
      invalidate();
    },
    onError: (e: any) =>
      toast(e?.response?.data?.message || "Could not clock out", "error"),
  });

  const clock = new Date(now);

  return (
    <div className="min-h-full flex flex-col items-center justify-center p-8 text-center">
      <div className="text-sm uppercase tracking-widest text-slate-500">{workspace.name}</div>
      <div className="mt-2 text-6xl font-bold tabular-nums text-slate-900">
        {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </div>
      <div className="text-slate-500">
        {clock.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
      </div>

      <div className="mt-8 bg-white rounded-2xl shadow-lg p-10 w-full max-w-md">
        <div className="text-lg font-semibold text-slate-800">{profile?.name ?? "—"}</div>

        {isLoading ? (
          <div className="mt-6 text-slate-500">Loading…</div>
        ) : running ? (
          <>
            <div className="mt-2 text-sm text-slate-500">
              Clocked in since{" "}
              {new Date(running.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {running.project ? ` · ${running.project.name}` : ""}
            </div>
            <div className="mt-6 text-5xl font-mono font-bold text-indigo-600 tabular-nums">
              {formatDurationSeconds(workspace, elapsed)}
            </div>
            <button
              onClick={() => clockOut.mutate()}
              disabled={clockOut.isPending}
              className="mt-8 w-full py-6 rounded-xl bg-red-600 text-white text-2xl font-bold hover:bg-red-700 disabled:opacity-50"
            >
              CLOCK OUT
            </button>
          </>
        ) : (
          <>
            <div className="mt-2 text-sm text-slate-500">Not clocked in</div>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="mt-6 w-full px-4 py-3 border rounded-lg text-lg"
            >
              <option value="">No project</option>
              {projects.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => clockIn.mutate()}
              disabled={clockIn.isPending}
              className="mt-6 w-full py-6 rounded-xl bg-green-600 text-white text-2xl font-bold hover:bg-green-700 disabled:opacity-50"
            >
              CLOCK IN
            </button>
          </>
        )}
      </div>
    </div>
  );
}
