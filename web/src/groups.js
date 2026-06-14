// Saved session groups — persisted per-browser in localStorage.
// Shared by the Visualize page (create) and the Groups page (list/manage).

export const GROUPS_KEY = "vn-session-groups";

export function loadGroups() {
  try {
    const v = JSON.parse(localStorage.getItem(GROUPS_KEY));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function persistGroups(groups) {
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  } catch {
    /* storage unavailable (private mode) */
  }
}

export function addGroup(name, ids) {
  const group = {
    id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()),
    name,
    ids,
    savedAt: new Date().toISOString(),
  };
  persistGroups([group, ...loadGroups()]);
  return group;
}

export function removeGroup(id) {
  const next = loadGroups().filter((g) => g.id !== id);
  persistGroups(next);
  return next;
}
