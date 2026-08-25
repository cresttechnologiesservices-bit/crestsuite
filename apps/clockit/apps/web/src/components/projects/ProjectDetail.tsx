import { useState } from "react";
import { Link, useParams, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { TasksTab } from "./TasksTab";
import { AccessTab } from "./AccessTab";
import { StatusTab } from "./StatusTab";
import { SettingsTab } from "./SettingsTab";
import { getFavorites, toggleFavorite } from "./favorites";

const TABS = ["tasks", "access", "status", "settings"] as const;

export function ProjectDetail() {
  const { projectId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [favorites, setFavorites] = useState<Set<string>>(getFavorites());

  const hash = location.hash.replace("#", "");
  const tab = (TABS as readonly string[]).includes(hash) ? hash : "tasks";

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => (await api.get(`/projects/${projectId}`)).data,
  });

  if (isLoading) return <div className="p-6 text-slate-500">Loading...</div>;
  if (!project) return <div className="p-6 text-slate-500">Project not found</div>;

  const favorite = favorites.has(projectId);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Link to="/projects" className="text-sm text-indigo-600 hover:underline">
        Projects
      </Link>
      <div className="flex items-center justify-between mt-1 mb-6">
        <div className="flex items-baseline gap-3">
          <span className="w-3 h-3 rounded-full self-center" style={{ backgroundColor: project.color }} />
          <h1 className="text-2xl font-bold">{project.name}</h1>
          {project.client && <span className="text-lg text-slate-500">{project.client.name}</span>}
          {project.status === "ARCHIVED" && (
            <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded self-center">Archived</span>
          )}
        </div>
        <button
          onClick={() => setFavorites(new Set(toggleFavorite(projectId)))}
          title={favorite ? "Remove from favorites" : "Add to favorites"}
          className={`text-xl ${favorite ? "text-yellow-500" : "text-slate-300 hover:text-yellow-500"}`}
        >
          ★
        </button>
      </div>

      <div className="border-b mb-6 flex gap-6">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => navigate(`#${t}`, { replace: true })}
            className={`pb-2 text-sm font-semibold uppercase tracking-wide border-b-2 -mb-px ${
              tab === t
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "tasks" && <TasksTab projectId={projectId} project={project} />}
      {tab === "access" && <AccessTab projectId={projectId} project={project} />}
      {tab === "status" && <StatusTab projectId={projectId} />}
      {tab === "settings" && <SettingsTab projectId={projectId} project={project} />}
    </div>
  );
}
