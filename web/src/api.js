/**
 * API client — wraps fetch calls to the backend with the user's Supabase JWT.
 */

import { supabase } from "./supabaseClient";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function startSession(cameraMode = "side") {
  const res = await fetch(`${API_BASE}/sessions`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ camera_mode: cameraMode }),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json(); // { session_id }
}

export async function endSession(sessionId, durationSeconds, totalFaults) {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}`, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify({
      ended_at: new Date().toISOString(),
      duration_seconds: durationSeconds,
      total_faults: totalFaults,
    }),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function postFaults(sessionId, faults) {
  if (!faults.length) return;
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/faults`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ faults }),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function listSessions() {
  const res = await fetch(`${API_BASE}/sessions`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function getSession(sessionId) {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}
