import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { MembersTab } from "../components/team/MembersTab";
import { GroupsTab } from "../components/team/GroupsTab";

export function Team() {
  const location = useLocation();
  const navigate = useNavigate();
  // REQ-TEAM-F16: active tab is preserved in the URL
  const path = location.pathname.split("/").pop() || "members";
  const activeTab = ["members", "groups", "reminders"].includes(path) ? path : "members";
  const tabs = [
    { id: "members", label: "Members" },
    { id: "groups", label: "Groups" },
    { id: "reminders", label: "Reminders" },
  ];
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Team</h1>
      </div>

      {/* Tabs */}
      <div className="border-b mb-6">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => navigate(`/team/${tab.id}`)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <Routes>
        <Route index element={<MembersTab />} />
        <Route path="members" element={<MembersTab />} />
        <Route path="groups" element={<GroupsTab />} />
        <Route
          path="reminders"
          element={
            <div className="bg-white rounded-lg shadow p-12 text-center text-slate-500">
              Reminders coming soon
            </div>
          }
        />
      </Routes>
    </div>
  );
}
