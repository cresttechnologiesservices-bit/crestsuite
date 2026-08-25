import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useI18n } from "../../i18n";

interface PendingInvite {
  id: string;
  email: string;
  name: string;
  invitedAt: string | null;
}

interface NotificationItem {
  id: string;
  type: string;
  subject: string;
  body: string;
  sentAt: string;
  delivered: boolean;
}

// I9: bell in the top bar surfacing invitation-related info (pending invited
// users, admins/owners only) plus the user's recent notifications.
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  const { data } = useQuery({
    queryKey: ["notifications-feed"],
    queryFn: async () => (await api.get("/notifications")).data,
    refetchInterval: 60_000,
  });

  const pendingInvites: PendingInvite[] = data?.pendingInvites ?? [];
  const notifications: NotificationItem[] = data?.notifications ?? [];
  const badgeCount = pendingInvites.length;

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t("notifications.title")}
        className="relative p-2 rounded-full text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-700"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 00-4-5.7V5a2 2 0 10-4 0v.3A6 6 0 006 11v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {badgeCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center">
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-30 overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t("notifications.title")}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {pendingInvites.length > 0 && (
              <div>
                <div className="px-4 pt-3 pb-1 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  {t("notifications.pendingInvitations")} ({pendingInvites.length})
                </div>
                {pendingInvites.map((invite) => (
                  <div key={invite.id} className="px-4 py-2 flex items-start gap-2">
                    <span className="mt-0.5 text-amber-500">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
                        />
                      </svg>
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm text-slate-900 dark:text-slate-100 truncate">{invite.email}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {t("notifications.invitePending")}
                        {invite.invitedAt && ` · ${new Date(invite.invitedAt).toLocaleDateString()}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {notifications.length > 0 && (
              <div>
                <div className="px-4 pt-3 pb-1 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  {t("notifications.recent")}
                </div>
                {notifications.map((n) => (
                  <div key={n.id} className="px-4 py-2">
                    <div className="text-sm text-slate-900 dark:text-slate-100 truncate">{n.subject}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {n.body}
                    </div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">
                      {new Date(n.sentAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {pendingInvites.length === 0 && notifications.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                {t("notifications.empty")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
