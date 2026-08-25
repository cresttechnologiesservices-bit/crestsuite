import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { TurnstileWidget } from "../components/auth/TurnstileWidget";

export function Login() {
  const [step, setStep] = useState<"email" | "otp">("email");
  // B3: OTP flow (default) or classic email + password login
  const [mode, setMode] = useState<"otp" | "password">("otp");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const code = digits.join("");
  const [err, setErr] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileVerified, setTurnstileVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const nav = useNavigate();

  const emailValid = /^\S+@\S+\.\S+$/.test(email);
  const canSubmit = emailValid && turnstileVerified;

  function startCountdown(seconds: number) {
    setResendCountdown(seconds);
    const interval = setInterval(() => {
      setResendCountdown((c) => {
        if (c <= 1) {
          clearInterval(interval);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  async function requestOtp() {
    if (!canSubmit) return;
    setErr("");
    setLoading(true);
    try {
      await api.post("/auth/email/request-otp", { email, turnstileToken });
      setStep("otp");
      startCountdown(25);
    } catch (e: any) {
      setErr(e.response?.data?.error ?? "error");
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    setErr("");
    setLoading(true);
    try {
      await api.post("/auth/email/verify-otp", { email, code });
      // REQ-LI-F16: redirect to the authenticated tracker page
      nav("/tracker");
    } catch (e: any) {
      setErr(e.response?.data?.error ?? "error");
    } finally {
      setLoading(false);
    }
  }

  // B3: email + password login against POST /api/auth/login
  async function loginWithPassword() {
    if (!emailValid || !password) return;
    setErr("");
    setLoading(true);
    try {
      await api.post("/auth/login", { email, password });
      nav("/tracker");
    } catch (e: any) {
      const code = e.response?.data?.error;
      setErr(
        code === "invalid_credentials"
          ? "Invalid credentials"
          : code === "account_inactive"
          ? "This account is inactive"
          : code ?? "error"
      );
    } finally {
      setLoading(false);
    }
  }

  async function resendOtp() {
    if (resendCountdown > 0) return;
    setErr("");
    setLoading(true);
    try {
      // REQ-LI-B08: dedicated resend endpoint (same rate limits)
      await api.post("/auth/email/resend-otp", { email });
      setDigits(Array(6).fill(""));
      startCountdown(25);
    } catch (e: any) {
      setErr(e.response?.data?.error ?? "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-slate-50">
      {/* Left panel - branding */}
      <div className="hidden md:flex bg-indigo-600 text-white p-12 flex-col justify-center">
        <h1 className="text-4xl font-bold">ClockIT</h1>
        <p className="mt-4 text-indigo-100">The free time tracker for teams.</p>
      </div>

      {/* Right panel - form */}
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-6">
          <h2 className="text-2xl font-semibold">Log in to ClockIT</h2>

          {/* OAuth buttons */}
          <div className="space-y-2">
            <button className="w-full border rounded px-3 py-2 flex items-center justify-center gap-2 hover:bg-slate-50">
              <span>🔵</span> Continue with Google
            </button>
            <button className="w-full border rounded px-3 py-2 flex items-center justify-center gap-2 hover:bg-slate-50">
              <span>🟦</span> Continue with Microsoft
            </button>
            <button className="w-full border rounded px-3 py-2 flex items-center justify-center gap-2 hover:bg-slate-50">
              <span>⚫</span> Continue with Apple
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-slate-200"></div>
            <span className="text-sm text-slate-500">OR</span>
            <div className="flex-1 h-px bg-slate-200"></div>
          </div>

          {mode === "password" ? (
            <>
              {/* B3: classic email + password login */}
              <input
                type="email"
                className="w-full border rounded px-3 py-2"
                placeholder="name@work-email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                type="password"
                className="w-full border rounded px-3 py-2"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") loginWithPassword();
                }}
              />
              <button
                disabled={!emailValid || !password || loading}
                onClick={loginWithPassword}
                className="w-full bg-indigo-600 text-white py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Logging in..." : "Log in"}
              </button>
              <button
                type="button"
                onClick={() => { setMode("otp"); setErr(""); }}
                className="w-full text-sm text-indigo-600 hover:underline"
              >
                Log in with a one-time code instead
              </button>
            </>
          ) : step === "email" ? (
            <>
              <input
                type="email"
                className="w-full border rounded px-3 py-2"
                placeholder="name@work-email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              {/* REQ-LI-F05: Turnstile widget */}
              <TurnstileWidget
                onVerify={(token) => {
                  setTurnstileToken(token);
                  setTurnstileVerified(true);
                }}
                onExpire={() => setTurnstileVerified(false)}
                onError={() => setTurnstileVerified(false)}
              />

              <button
                disabled={!canSubmit || loading}
                onClick={requestOtp}
                className="w-full bg-indigo-600 text-white py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Sending..." : "Continue with email"}
              </button>

              {/* B3: switch to password-based login */}
              <button
                type="button"
                onClick={() => { setMode("password"); setErr(""); }}
                className="w-full text-sm text-indigo-600 hover:underline"
              >
                Log in with password
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-600">
                Enter the 6-digit code sent to{" "}
                <span className="font-medium">{email.replace(/(.{2}).*(@.*)/, "$1***$2")}</span>
              </p>

              {/* REQ-LI-F11: 6-box OTP input */}
              <div className="flex gap-2 justify-center">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <input
                    key={i}
                    type="text"
                    inputMode="numeric"
                    className="w-10 h-12 border rounded text-center text-lg"
                    value={digits[i]}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, "");
                      const target = e.target as HTMLInputElement;
                      setDigits((prev) => {
                        const next = [...prev];
                        if (value.length <= 1) {
                          next[i] = value;
                        } else {
                          // Multiple digits (fast typing or autofill): distribute from this box
                          for (let k = 0; k < value.length && i + k < 6; k++) {
                            next[i + k] = value[k];
                          }
                        }
                        return next;
                      });
                      if (value) {
                        const advance = Math.min(i + value.length, 5);
                        const boxes = target.parentElement?.querySelectorAll("input");
                        (boxes?.[advance] as HTMLInputElement | undefined)?.focus();
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Backspace" && !digits[i] && i > 0) {
                        const prev = (e.target as HTMLElement).previousElementSibling as HTMLInputElement;
                        prev?.focus();
                      }
                    }}
                    onPaste={(e) => {
                      // REQ-LI-F12: Support pasting full code
                      const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
                      setDigits(Array.from({ length: 6 }, (_, k) => pasted[k] ?? ""));
                      e.preventDefault();
                    }}
                  />
                ))}
              </div>

              {/* REQ-LI-F13: Open Gmail/Outlook buttons */}
              <div className="flex gap-2 justify-center">
                <a
                  href="https://mail.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-indigo-600 hover:underline"
                >
                  Open Gmail
                </a>
                <span className="text-slate-300">|</span>
                <a
                  href="https://outlook.live.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-indigo-600 hover:underline"
                >
                  Open Outlook
                </a>
              </div>

              <button
                onClick={verify}
                disabled={code.length !== 6 || loading}
                className="w-full bg-indigo-600 text-white py-2 rounded disabled:opacity-50"
              >
                {loading ? "Verifying..." : "Verify"}
              </button>

              {/* REQ-LI-F14: Resend with countdown */}
              <div className="text-center text-sm">
                {resendCountdown > 0 ? (
                  <span className="text-slate-500">Resend email in {resendCountdown} seconds</span>
                ) : (
                  <button onClick={resendOtp} className="text-indigo-600 hover:underline">
                    Resend email
                  </button>
                )}
              </div>
            </>
          )}

          {err && <p className="text-red-600 text-sm">{err}</p>}

          <p className="text-sm text-center">
            Don't have an account?{" "}
            <Link className="text-indigo-600" to="/signup">Sign up</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
