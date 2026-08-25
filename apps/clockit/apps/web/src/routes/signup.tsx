import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";

export function Signup() {
  const [step, setStep] = useState<"email" | "password">("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  const emailValid = /^\S+@\S+\.\S+$/.test(email);

  async function handleEmail() {
    setErr("");
    setLoading(true);
    try {
      // REQ-SU-B01: check whether email is already registered
      const res = await api.post("/auth/signup/check-email", { email });
      if (res.data.exists) {
        setErr("Email already registered. Please log in.");
        return;
      }
      setStep("password");
    } catch (e: any) {
      setErr(e.response?.data?.error ?? "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup() {
    setErr("");
    if (password.length < 8) {
      setErr("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/signup", { email, name, password });
      nav("/login");
    } catch (e: any) {
      setErr(e.response?.data?.error ?? "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-slate-50">
      <div className="hidden md:flex bg-indigo-600 text-white p-12 flex-col justify-center">
        <h1 className="text-4xl font-bold">ClockIT</h1>
        <p className="mt-4 text-indigo-100">Join thousands of teams tracking time.</p>
      </div>
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-6">
          <h2 className="text-2xl font-semibold">Get started with ClockIT</h2>

          <div className="space-y-2">
            <button className="w-full border rounded px-3 py-2 hover:bg-slate-50">🔵 Continue with Google</button>
            <button className="w-full border rounded px-3 py-2 hover:bg-slate-50">🟦 Continue with Microsoft</button>
            <button className="w-full border rounded px-3 py-2 hover:bg-slate-50">⚫ Continue with Apple</button>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-slate-200"></div>
            <span className="text-sm text-slate-500">OR</span>
            <div className="flex-1 h-px bg-slate-200"></div>
          </div>

          {step === "email" ? (
            <>
              <input
                type="email"
                className="w-full border rounded px-3 py-2"
                placeholder="name@work-email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button
                disabled={!emailValid || loading}
                onClick={handleEmail}
                className="w-full bg-indigo-600 text-white py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Checking..." : "Continue with email"}
              </button>
            </>
          ) : (
            <>
              <input
                type="text"
                className="w-full border rounded px-3 py-2"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                type="password"
                className="w-full border rounded px-3 py-2"
                placeholder="Password (min 8 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                onClick={handleSignup}
                disabled={loading || !name || password.length < 8}
                className="w-full bg-indigo-600 text-white py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Creating account..." : "Create account"}
              </button>
            </>
          )}

          {err && <p className="text-red-600 text-sm">{err}</p>}

          <p className="text-sm text-center">
            Already have an account?{" "}
            <Link className="text-indigo-600" to="/login">Log in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
