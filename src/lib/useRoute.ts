import { useEffect, useState } from 'react';

/**
 * Tiny hash router. Hash routing keeps the app deployable on any static host
 * (including a sub-path or file://) and makes the phone's back gesture work.
 */

export type TabName = 'today' | 'records' | 'graph' | 'agent' | 'more';

export type Route =
  | { name: 'today' }
  | { name: 'records' }
  | { name: 'plan' }
  | { name: 'profile' }
  | { name: 'health' }
  | { name: 'finance' }
  | { name: 'templates' }
  | { name: 'archive' }
  | { name: 'attachments' }
  | { name: 'graph' }
  | { name: 'agent' }
  | { name: 'search' }
  | { name: 'settings' }
  | { name: 'more' }
  | { name: 'directories' }
  | { name: 'note'; id: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const segments = path.split('/').filter(Boolean);
  const head = segments[0];
  switch (head) {
    case 'note':
      return segments[1] ? { name: 'note', id: decodeURIComponent(segments[1]) } : { name: 'records' };
    case 'plan':
      return { name: 'plan' };
    case 'profile':
      return { name: 'profile' };
    case 'health':
      return { name: 'health' };
    case 'finance':
      return { name: 'finance' };
    case 'templates':
      return { name: 'templates' };
    case 'archive':
      return { name: 'archive' };
    case 'attachments':
      return { name: 'attachments' };
    case 'more':
      return { name: 'more' };
    case 'directories':
      return { name: 'directories' };
    case 'graph':
      return { name: 'graph' };
    case 'agent':
      return { name: 'agent' };
    case 'search':
      return { name: 'search' };
    case 'settings':
      return { name: 'settings' };
    case 'records':
    case 'experience':
    case 'notes':
      return { name: 'records' };
    default:
      return { name: 'today' };
  }
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'note':
      return `#/note/${encodeURIComponent(route.id)}`;
    case 'today':
      return '#/today';
    default:
      return `#/${route.name}`;
  }
}

/** Navigate by updating the hash (adds a history entry, like a normal link). */
export function navigate(route: Route): void {
  const hash = routeToHash(route);
  if (window.location.hash === hash) return;
  window.location.hash = hash;
}

/** Replace the current history entry instead of pushing a new one. */
export function replaceRoute(route: Route): void {
  const hash = routeToHash(route);
  if (window.location.hash === hash) return;
  window.history.replaceState(null, '', hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route;
}
