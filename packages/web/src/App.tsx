import type { ReactElement } from 'react';

import { Editor } from './Editor';
import { Viewer } from './Viewer';
import { parseRoute } from './router';

export function App(): ReactElement {
  const route = parseRoute(window.location.pathname);

  if (route.name === 'viewer') return <Viewer id={route.id} />;
  if (route.name === 'not-found') return <p className="v2-missing">This page does not exist.</p>;
  return <Editor />;
}
