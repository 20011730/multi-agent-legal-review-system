import { createBrowserRouter } from "react-router";
import { Home } from "./pages/Home";
import { InputPage } from "./pages/Input";
import { Result } from "./pages/Result";
import { Verdict } from "./pages/Verdict";
import { Login } from "./pages/Login";
import { Signup } from "./pages/Signup";
import { CompanyProfile } from "./pages/CompanyProfile";
import { ReviewHistory } from "./pages/ReviewHistory";
import { ReviewDetailPage } from "./pages/ReviewDetail";
import { RequireAuth, RedirectIfAuth } from "./components/AuthGuard";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Home />,
  },
  {
    path: "/login",
    element: (
      <RedirectIfAuth>
        <Login />
      </RedirectIfAuth>
    ),
  },
  {
    path: "/signup",
    element: (
      <RedirectIfAuth>
        <Signup />
      </RedirectIfAuth>
    ),
  },
  {
    path: "/profile",
    element: (
      <RequireAuth>
        <CompanyProfile />
      </RequireAuth>
    ),
  },
  {
    path: "/input",
    element: (
      <RequireAuth>
        <InputPage />
      </RequireAuth>
    ),
  },
  {
    path: "/result",
    element: (
      <RequireAuth>
        <Result />
      </RequireAuth>
    ),
  },
  {
    path: "/verdict",
    element: (
      <RequireAuth>
        <Verdict />
      </RequireAuth>
    ),
  },
  {
    path: "/reviews",
    element: (
      <RequireAuth>
        <ReviewHistory />
      </RequireAuth>
    ),
  },
  {
    path: "/reviews/:sessionId",
    element: (
      <RequireAuth>
        <ReviewDetailPage />
      </RequireAuth>
    ),
  },
]);
