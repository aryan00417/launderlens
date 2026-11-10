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

const authHeader = () => (getToken() ? { Authorization: `Bearer ${getToken()}` } : {});

function checkExpired(res) {
  if (res.status === 401 && getToken()) {
    clearSession();
    window.location.href = "/login";
  }
}

export async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { ...(isForm || !options.body ? {} : { "Content-Type": "application/json" }), ...authHeader(), ...options.headers },
    body: isForm ? options.body : options.body ? JSON.stringify(options.body) : undefined,
  });
  checkExpired(res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

// Downloads a protected file (the browser cannot send our token with a plain link).
export async function download(path, filename) {
  const res = await fetch(`/api${path}`, { headers: authHeader() });
  checkExpired(res);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "download failed");
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
