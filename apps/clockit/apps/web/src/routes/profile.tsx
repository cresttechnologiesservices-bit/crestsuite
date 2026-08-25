import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function Profile() {
  // REQ-ACC-B01: profile info
  const { data: user, isLoading } = useQuery({
    queryKey: ["user-profile"],
    queryFn: async () => (await api.get("/users/me")).data,
  });

  if (isLoading) {
    return <div className="p-6 text-center text-slate-500">Loading...</div>;
  }

  const initials = user?.name
    ? user.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">My profile</h1>

      <div className="bg-white rounded-lg shadow p-6">
        {/* REQ-ACC-F04: Personal info section with descriptive text */}
        <h2 className="text-lg font-semibold text-slate-900">Personal info</h2>
        <p className="text-sm text-slate-600 mt-1 mb-6">
          Your login credentials and the display name used in reports.
        </p>

        {/* REQ-ACC-F05: avatar, full name, and email as read fields */}
        <div className="flex items-center gap-4 mb-6">
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name}
              className="w-16 h-16 rounded-full object-cover"
            />
          ) : (
            <div className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center text-white text-xl font-semibold">
              {initials}
            </div>
          )}
        </div>

        <div className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm text-slate-600 mb-1">Full name</label>
            <input
              type="text"
              readOnly
              value={user?.name || ""}
              className="w-full px-3 py-2 border rounded bg-slate-50 text-slate-900"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1">Email</label>
            <input
              type="email"
              readOnly
              value={user?.email || ""}
              className="w-full px-3 py-2 border rounded bg-slate-50 text-slate-900"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
