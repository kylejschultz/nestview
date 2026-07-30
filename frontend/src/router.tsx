import { createContext, type AnchorHTMLAttributes, type MouseEvent, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

interface RouterState {
  pathname: string;
  navigate: (to: string | number, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterState | null>(null);

function currentPath() {
  return window.location.pathname || "/";
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [pathname, setPathname] = useState(currentPath);

  useEffect(() => {
    const onPopState = () => setPathname(currentPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const value = useMemo<RouterState>(() => ({
    pathname,
    navigate(to, options) {
      if (typeof to === "number") {
        window.history.go(to);
        return;
      }

      const next = to.startsWith("/") ? to : `/${to}`;
      if (next === currentPath()) return;

      if (options?.replace) {
        window.history.replaceState(null, "", next);
      } else {
        window.history.pushState(null, "", next);
      }
      setPathname(currentPath());
    },
  }), [pathname]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

function useRouter() {
  const router = useContext(RouterContext);
  if (!router) throw new Error("RouterProvider is required");
  return router;
}

export function useLocation() {
  return { pathname: useRouter().pathname };
}

export function useNavigate() {
  return useRouter().navigate;
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: string;
}

export function Link({ to, onClick, ...props }: LinkProps) {
  const { navigate } = useRouter();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey ||
      props.target
    ) {
      return;
    }

    event.preventDefault();
    navigate(to);
  }

  return <a href={to} onClick={handleClick} {...props} />;
}

interface NavLinkProps extends Omit<LinkProps, "className"> {
  className?: string | ((state: { isActive: boolean }) => string);
}

export function NavLink({ to, className, ...props }: NavLinkProps) {
  const { pathname } = useRouter();
  const isActive = pathname === to || pathname.startsWith(`${to}/`);
  const resolvedClassName = typeof className === "function" ? className({ isActive }) : className;
  return <Link to={to} className={resolvedClassName} {...props} />;
}

export function Redirect({ to, replace = true }: { to: string; replace?: boolean }) {
  const navigate = useNavigate();

  useEffect(() => {
    navigate(to, { replace });
  }, [navigate, replace, to]);

  return null;
}

export function useParams<T extends Record<string, string>>() {
  const { pathname } = useRouter();
  const containerMatch = pathname.match(/^\/containers\/([^/]+)$/);
  return (containerMatch ? { id: decodeURIComponent(containerMatch[1]) } : {}) as Partial<T>;
}
