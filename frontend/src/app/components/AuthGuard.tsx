import { Navigate } from "react-router";

/**
 * 로그인이 필요한 페이지를 보호하는 가드.
 * legalreview_currentUser가 없으면 /login으로 리다이렉트.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = localStorage.getItem("legalreview_currentUser");
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

/**
 * 이미 로그인한 사용자가 /login, /signup에 접근하면 리다이렉트.
 */
export function RedirectIfAuth({ children }: { children: React.ReactNode }) {
  const user = localStorage.getItem("legalreview_currentUser");
  if (user) {
    return <Navigate to="/input" replace />;
  }
  return <>{children}</>;
}
