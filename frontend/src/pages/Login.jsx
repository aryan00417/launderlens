import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setSession } from "../lib/api.js";

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    try {
      const { token, user } = await api("/auth/login", { method: "POST", body: { email, password } });
      setSession(token, user);
      nav("/");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="login">
      <h1>LaunderLens</h1>
      <p className="muted">Sign in to review alerts.</p>
      <form onSubmit={submit}>
        <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required /></label>
        <label>Password<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required /></label>
        {error && <p className="error">{error}</p>}
        <button type="submit">Sign in</button>
      </form>
    </div>
  );
}
