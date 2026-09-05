import { AdminSessionProvider } from "./admin-session";
import { AdminShell } from "./admin-shell";
import "./admin.css";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminSessionProvider><AdminShell>{children}</AdminShell></AdminSessionProvider>;
}
