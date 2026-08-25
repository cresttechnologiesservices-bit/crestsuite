import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function Landing() {
  const navigate = useNavigate();
  // REQ-LP-B01: verify existing session; redirect to the app if already logged in
  const { data: user } = useQuery({
    queryKey: ["user-profile"],
    queryFn: async () => (await api.get("/users/me")).data,
    retry: false,
  });

  useEffect(() => {
    if (user) navigate("/tracker", { replace: true });
  }, [user, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-600 to-indigo-800 text-white">
      <header className="p-6 flex justify-between items-center max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-white rounded flex items-center justify-center text-indigo-600 font-bold text-xl">
            C
          </div>
          <span className="text-2xl font-bold">ClockIT</span>
        </div>
        <div className="flex gap-3">
          <Link
            to="/login"
            className="px-4 py-2 border border-white rounded hover:bg-white hover:text-indigo-600 transition"
          >
            Log in
          </Link>
          <Link
            to="/signup"
            className="px-4 py-2 bg-white text-indigo-600 rounded font-semibold hover:bg-slate-100 transition"
          >
            Sign up free
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-20 grid md:grid-cols-2 gap-12 items-center">
        <div>
          <h1 className="text-5xl font-bold leading-tight">
            The free time tracker for teams
          </h1>
          <p className="mt-6 text-xl text-indigo-100">
            Track time across projects, generate reports, and manage your team's
            productivity — all in one place.
          </p>
          <div className="mt-8 flex gap-4">
            <Link
              to="/signup"
              className="px-6 py-3 bg-white text-indigo-600 rounded-lg font-semibold hover:bg-slate-100 transition"
            >
              Get started free
            </Link>
            <Link
              to="/login"
              className="px-6 py-3 border border-white rounded-lg hover:bg-white hover:text-indigo-600 transition"
            >
              Sign in
            </Link>
          </div>
        </div>
        <div className="hidden md:block">
          <div className="bg-white rounded-2xl shadow-2xl p-6 text-slate-900">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">This week</h3>
              <span className="text-2xl font-bold text-indigo-600">34:30</span>
            </div>
            <div className="space-y-3">
              {["Website Redesign", "Client Meeting", "Code Review"].map((t, i) => (
                <div key={i} className="flex justify-between p-3 bg-slate-50 rounded">
                  <span>{t}</span>
                  <span className="font-mono">{[8, 4, 2][i]}:00</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      <footer className="max-w-7xl mx-auto px-6 py-8 text-center text-indigo-200 text-sm">
        <div className="flex justify-center gap-6 mb-4">
          <a href="#" className="hover:text-white">Privacy Policy</a>
          <a href="#" className="hover:text-white">Terms of Service</a>
          <a href="#" className="hover:text-white">Contact</a>
        </div>
        <p>© 2026 ClockIT. All rights reserved.</p>
      </footer>
    </div>
  );
}
