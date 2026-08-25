import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../api/client";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "INR"];

export function ClientEditModal({
  client,
  onClose,
  onSaved,
}: {
  client: { id: string; name: string; address?: string | null; currency: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(client.name);
  const [address, setAddress] = useState(client.address ?? "");
  const [currency, setCurrency] = useState(client.currency);
  const [error, setError] = useState("");

  const saveMutation = useMutation({
    mutationFn: async () => {
      await api.patch(`/clients/${client.id}`, {
        name: name.trim(),
        address: address.trim() || null,
        currency,
      });
    },
    onSuccess: onSaved,
    onError: (e: any) => {
      setError(e?.response?.status === 409 ? "A client with that name already exists" : "Failed to save client");
    },
  });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-6 border-b">
          <h3 className="text-lg font-semibold">Edit client</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">×</button>
        </div>
        <div className="p-6 space-y-4">
          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Address</label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border rounded"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full px-3 py-2 border rounded"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-6 border-t">
          <button onClick={onClose} className="px-4 py-2 border rounded hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!name.trim() || saveMutation.isPending}
            className="px-6 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
