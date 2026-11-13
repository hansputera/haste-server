// Two routes, no router dependency: `/v2` is the editor, `/v2/:id` is a paste.
//
// The API serves `static/v2/index.html` for both, so this is the only place
// that decides which component a path renders.

export type Route = { name: 'editor' } | { name: 'viewer'; id: string } | { name: 'not-found' };

export const parseRoute = (pathname: string): Route => {
  const path = pathname.replace(/\/+$/, '');

  if (path === '' || path === '/v2') return { name: 'editor' };

  const match = /^\/v2\/([^/]+)$/.exec(path);
  if (!match) return { name: 'not-found' };

  return { name: 'viewer', id: decodeURIComponent(match[1] as string) };
};

/** The paste key, without the `.ext` suffix v1 tolerates. */
export const bareKey = (id: string): string => id.split('.')[0] as string;
