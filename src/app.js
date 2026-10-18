import { createOcrAdapter } from './ocr-adapter.js';
import { createController } from './client/controller.js';
import { createState, LOCAL_MODE_KEY } from './client/state.js';
import { createViewRenderer } from './client/views.js';

const root = document.querySelector('#app');
const state = createState();
const views = createViewRenderer({ state });
const controller = createController({ root, state, views, ocr: createOcrAdapter() });

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => undefined));
if (localStorage.getItem(LOCAL_MODE_KEY) === 'local') controller.enterLocal(); else controller.hydrateRemote();
