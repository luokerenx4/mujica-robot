import * as React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "@/app";
import type { StudioRouteManifest } from "@/types";
import "@/styles.css";

function loadManifest(): StudioRouteManifest {
  const node = document.querySelector<HTMLScriptElement>("#mujica-studio-route-manifest");
  if (!node?.textContent) throw new Error("Mujica Studio route manifest is missing");
  const value: unknown = JSON.parse(node.textContent);
  if (
    typeof value !== "object"
    || value === null
    || (value as Partial<StudioRouteManifest>).kind !== "mujica-studio-route-manifest"
  ) throw new Error("Mujica Studio route manifest contract is invalid");
  return value as StudioRouteManifest;
}

const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Mujica Studio root is missing");

createRoot(root).render(
  <React.StrictMode>
    <HashRouter>
      <App manifest={loadManifest()} />
    </HashRouter>
  </React.StrictMode>,
);
