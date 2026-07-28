import * as React from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app";
import type { StudioSnapshot } from "@/types";
import "@/styles.css";

function loadSnapshot(): StudioSnapshot {
  const node = document.querySelector<HTMLScriptElement>("#mujica-studio-snapshot");
  if (!node?.textContent) throw new Error("Mujica Studio Snapshot is missing");
  const value: unknown = JSON.parse(node.textContent);
  if (
    typeof value !== "object"
    || value === null
    || (value as Partial<StudioSnapshot>).kind !== "mujica-studio-snapshot"
  ) throw new Error("Mujica Studio Snapshot contract is invalid");
  return value as StudioSnapshot;
}

const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Mujica Studio root is missing");

createRoot(root).render(
  <React.StrictMode>
    <App snapshot={loadSnapshot()} />
  </React.StrictMode>,
);
