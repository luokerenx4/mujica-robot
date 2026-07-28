import * as React from "react";

const cache = new Map<string, Promise<unknown>>();

declare global {
  interface Window {
    __MUJICA_STUDIO_ROUTE_DATA__?: Record<string, unknown>;
  }
}

function loadScriptJson<T>(path: string): Promise<T> {
  const existing = window.__MUJICA_STUDIO_ROUTE_DATA__?.[path];
  if (existing !== undefined) return Promise.resolve(existing as T);
  return new Promise<T>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = path.replace(/\.json$/, ".js");
    script.onload = () => {
      script.remove();
      const value = window.__MUJICA_STUDIO_ROUTE_DATA__?.[path];
      if (value === undefined) reject(new Error(`Studio data script '${script.src}' did not publish '${path}'`));
      else resolve(value as T);
    };
    script.onerror = () => {
      script.remove();
      reject(new Error(`Studio data script '${script.src}' could not be loaded`));
    };
    document.head.append(script);
  });
}

function fetchJson<T>(path: string): Promise<T> {
  let request = cache.get(path);
  if (!request) {
    request = window.location.protocol === "file:"
      ? loadScriptJson<T>(path)
      : fetch(path, { cache: "force-cache" }).then(async (response) => {
          if (!response.ok) throw new Error(`Studio data '${path}' returned ${response.status}`);
          return response.json() as Promise<T>;
        });
    cache.set(path, request);
  }
  return request as Promise<T>;
}

export function useRouteData<T>(path: string | null): {
  data: T | null;
  error: Error | null;
  loading: boolean;
} {
  const [state, setState] = React.useState<{
    path: string | null;
    data: T | null;
    error: Error | null;
  }>({ path: null, data: null, error: null });

  React.useEffect(() => {
    let current = true;
    if (!path) {
      setState({ path, data: null, error: null });
      return () => { current = false; };
    }
    void fetchJson<T>(path).then(
      (data) => {
        if (current) setState({ path, data, error: null });
      },
      (error: unknown) => {
        if (current) {
          setState({
            path,
            data: null,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      },
    );
    return () => { current = false; };
  }, [path]);

  return {
    data: state.path === path ? state.data : null,
    error: state.path === path ? state.error : null,
    loading: Boolean(path) && state.path !== path,
  };
}
