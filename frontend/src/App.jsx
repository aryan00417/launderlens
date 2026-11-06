import { Navigate, Route, Routes } from "react-router-dom";
import { getToken } from "./lib/api.js";
import Layout from "./components/Layout.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import GraphExplorer from "./pages/GraphExplorer.jsx";

function Protected({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/graph" element={<GraphExplorer />} />
        {/* Later: /alerts, /cases, /reports, /monitoring, /admin */}
      </Route>
    </Routes>
  );
}
