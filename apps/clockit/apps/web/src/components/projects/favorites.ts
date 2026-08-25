import { clockitKey } from "../../lib/storage";
// Demo-quality favorites persistence (localStorage). A real implementation
// would persist per-user favorites server-side (see report: needs schema change).
const KEY = clockitKey("favoriteProjects");

export function getFavorites(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

export function toggleFavorite(projectId: string): Set<string> {
  const favs = getFavorites();
  if (favs.has(projectId)) favs.delete(projectId);
  else favs.add(projectId);
  localStorage.setItem(KEY, JSON.stringify([...favs]));
  return favs;
}
