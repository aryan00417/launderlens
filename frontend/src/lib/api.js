export const getToken = () => localStorage.getItem("ll_token");
export const setSession = (token, user) => {
  localStorage.setItem("ll_token", token);
  localStorage.setItem("ll_user", JSON.stringify(user));
};
export const clearSession = () => {
  localStorage.removeItem("ll_token");
  localStorage.removeItem("ll_user");
};
export const getUser = () => JSON.parse(localStorage.getItem("ll_user") || "null");

export async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
    if (res.status === 401 && getToken()) {
    clearSession();
    window.location.href = "/login";
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}
