import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

interface CalendarSettingsModalProps {
  preferences: any;
  onSave: (data: any) => void;
  onClose: () => void;
}

export function CalendarSettingsModal({ preferences, onSave, onClose }: CalendarSettingsModalProps) {
  const queryClient = useQueryClient();
  // REQ-CAL-F31: working-days toggle
  const [showWorkingDaysOnly, setShowWorkingDaysOnly] = useState(
    preferences?.showWorkingDaysOnly || false
  );

  // REQ-CAL-B12: integration status
  const { data: integrationStatus } = useQuery({
    queryKey: ["calendar-integrations"],
    queryFn: async () => {
      const response = await api.get("/calendar/integrations/status");
      return response.data;
    },
  });

  const afterConnect = (data: any) => {
    if (data?.authUrl) {
      // REQ-CAL-F34: real OAuth flow
      window.location.href = data.authUrl;
    } else {
      // Demo/stub connect completed server-side
      queryClient.invalidateQueries({ queryKey: ["calendar-integrations"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-entries"] });
    }
  };

  // REQ-CAL-B10: Connect Google Calendar
  const connectGoogleMutation = useMutation({
    mutationFn: async () => {
      const response = await api.get("/calendar/integrations/google/connect");
      return response.data;
    },
    onSuccess: afterConnect,
  });

  // REQ-CAL-B11: Connect Outlook Calendar
  const connectOutlookMutation = useMutation({
    mutationFn: async () => {
      const response = await api.get("/calendar/integrations/outlook/connect");
      return response.data;
    },
    onSuccess: afterConnect,
  });

  // REQ-CAL-B13: Disconnect integration
  const disconnectMutation = useMutation({
    mutationFn: async (provider: string) => {
      await api.post(`/calendar/integrations/${provider}/disconnect`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-integrations"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-entries"] });
    },
  });

  // REQ-CAL-F36/F37: CLOSE applies toggled settings
  const handleClose = () => {
    onSave({ showWorkingDaysOnly });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h3 className="text-lg font-semibold">Calendar settings</h3>
          {/* REQ-CAL-F30: X dismisses without applying changes */}
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* REQ-CAL-F31: Show working days only */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-slate-900">
                Show working days only
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Hide weekends in the calendar view
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowWorkingDaysOnly(!showWorkingDaysOnly)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                showWorkingDaysOnly ? "bg-indigo-600" : "bg-slate-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  showWorkingDaysOnly ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          {/* REQ-CAL-F32: Google Calendar Integration */}
          <div className="border rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                  <span className="text-red-600 font-bold">G</span>
                </div>
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-900">Google Calendar</div>
                <div className="text-xs text-slate-500 mt-1">
                  Sync events from your Google Calendar
                </div>
              </div>
              <div>
                {integrationStatus?.google?.connected ? (
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs text-green-600">Connected</span>
                    <button
                      onClick={() => disconnectMutation.mutate("google")}
                      disabled={disconnectMutation.isPending}
                      className="px-3 py-1 text-sm border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => connectGoogleMutation.mutate()}
                    disabled={connectGoogleMutation.isPending}
                    className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                  >
                    CONNECT
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* REQ-CAL-F33: Outlook Calendar Integration */}
          <div className="border rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-blue-600 font-bold">O</span>
                </div>
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-900">Outlook Calendar</div>
                <div className="text-xs text-slate-500 mt-1">
                  Sync events from your Outlook Calendar
                </div>
              </div>
              <div>
                {integrationStatus?.outlook?.connected ? (
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs text-green-600">Connected</span>
                    <button
                      onClick={() => disconnectMutation.mutate("outlook")}
                      disabled={disconnectMutation.isPending}
                      className="px-3 py-1 text-sm border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => connectOutlookMutation.mutate()}
                    disabled={connectOutlookMutation.isPending}
                    className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                  >
                    CONNECT
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer: CLOSE applies toggled settings (REQ-CAL-F36) */}
        <div className="flex items-center justify-end gap-3 p-6 border-t">
          <button
            onClick={handleClose}
            className="px-6 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}
