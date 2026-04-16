import { createBrowserRouter } from "react-router";
import { HomeLanding } from "./pages/HomeLanding";
import { InputPage } from "./pages/Input";
import { Result } from "./pages/Result";
import { Verdict } from "./pages/Verdict";
import { Login } from "./pages/Login";
import { Signup } from "./pages/Signup";
import { CompanyProfile } from "./pages/CompanyProfile";
import { ReviewHistory } from "./pages/ReviewHistory";
import { ReviewDetailPage } from "./pages/ReviewDetail";
import { ServiceAbout } from "./pages/ServiceAbout";
import { ServiceDomains } from "./pages/ServiceDomains";
import { ServiceTechnology } from "./pages/ServiceTechnology";
import { ServiceTrust } from "./pages/ServiceTrust";
import { ServiceHowTo } from "./pages/ServiceHowTo";
import { ServiceContact } from "./pages/ServiceContact";
import { RequireAuth, RedirectIfAuth } from "./components/AuthGuard";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <HomeLanding />,
  },
  {
    path: "/about",
    element: <ServiceAbout />,
  },
  {
    path: "/domains",
    element: <ServiceDomains />,
  },
  {
    path: "/technology",
    element: <ServiceTechnology />,
  },
  {
    path: "/trust",
    element: <ServiceTrust />,
  },
  {
    path: "/how-to",
    element: <ServiceHowTo />,
  },
  {
    path: "/contact",
    element: <ServiceContact />,
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
