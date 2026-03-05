/**
 * Extension SDK Global — expose SDK, React, and lucide-react on `window`
 * so runtime-loaded extensions can `require()` them.
 */

import * as sdk from './extensionSdk';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as LucideReact from 'lucide-react';

(window as any).__open2dStudioSdk = sdk;
(window as any).__open2dStudioReact = React;
(window as any).__open2dStudioReactJsxRuntime = jsxRuntime;
(window as any).__open2dStudioLucideReact = LucideReact;
