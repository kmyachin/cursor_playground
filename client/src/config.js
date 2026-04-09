/** @returns {string} */
export function getApiBase() {
  if (typeof window.ZERNYSHKO_API_BASE !== "undefined")
    return window.ZERNYSHKO_API_BASE;
  if (typeof location === "undefined") return "http://127.0.0.1:5001";
  if (location.protocol === "file:") return "http://127.0.0.1:5001";
  const h = location.hostname;
  const p = location.port;
  const local = h === "localhost" || h === "127.0.0.1";
  if (local && (p === "5000" || p === "5001")) return "";
  if (local && p && p !== "5000" && p !== "5001")
    return "http://127.0.0.1:5001";
  if (!local) return "";
  return "http://127.0.0.1:5001";
}

export const CLIENT_ID_KEY = "zernyshko_client_id_v1";
export const LEGACY_STATE_KEY = "zernyshko_state_v1";
export const LEGACY_SESSION_KEY = "zernyshko_session_v1";
export const LEGACY_EXTRAS_KEY = "zernyshko_extras_v1";
