import { createBrowserRouter } from "react-router";
import { Home } from "./pages/Home";
import { InputPage } from "./pages/Input";
import { Result } from "./pages/Result";
import { Verdict } from "./pages/Verdict";
import { Login } from "./pages/Login";
import { Signup } from "./pages/Signup";
import { CompanyProfile } from "./pages/CompanyProfile";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Home,
  },
  {
    path: "/login",
    Component: Login,
  },
  {
    path: "/signup",
    Component: Signup,
  },
  {
    path: "/profile",
    Component: CompanyProfile,
  },
  {
    path: "/input",
    Component: InputPage,
  },
  {
    path: "/result",
    Component: Result,
  },
  {
    path: "/verdict",
    Component: Verdict,
  },
]);