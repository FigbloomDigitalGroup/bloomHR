import './index.css';
import { applyA11y, loadA11y } from './lib/a11y';
import { isStaleChunkError, reloadOnceForStaleChunk } from './lib/staleChunk';
import { frontDoorFromWindow } from './lib/landingRoute';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then((_registration) => {
      console.log('SW registered');
    })
    .catch((error) => {
      console.log('SW registration failed:', error);
    });
}
// Vite fires this when a page file it needs is gone (a new version was deployed): load the new version once.
// Only cancel the error when the page is really reloading: a cancelled error makes the page import "succeed" with
// nothing, and React then fails with "Cannot read properties of undefined (reading 'default')", which nothing
// recognises. Left alone, the error reaches the error screen as "Failed to fetch dynamically imported module".
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnceForStaleChunk()) event.preventDefault();
});

applyA11y(loadA11y()); // text size, bolder text, contrast, motion: also before the first render

// Nothing is rendered here. What this address opens is decided first (src/lib/landingRoute.ts), and only that part is
// downloaded: the public landing page and legal pages are small bundles of their own, and the app (sign-in, the
// database client, every screen) loads only when it is wanted. The app's start-up, in bootApp.tsx, is exactly what
// this file used to do.
function couldNotStart(error: unknown) {
  console.error('The page could not start:', error);
  // a tab opened before a new version went live asks for page files that no longer exist: one reload fetches the new ones
  if (isStaleChunkError(error) && reloadOnceForStaleChunk()) return;
  const root = document.getElementById('root');
  if (!root) return;
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.style.cssText =
    'min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;font-family:Outfit,system-ui,sans-serif;color:#16201a';
  const heading = document.createElement('h1');
  heading.textContent = 'Something went wrong';
  heading.style.cssText = 'margin:0;font-size:24px';
  const text = document.createElement('p');
  text.textContent = 'Please refresh the page to continue.';
  text.style.cssText = 'margin:0;font-size:14px;color:#5f6b62';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Refresh page';
  button.style.cssText = 'margin-top:8px;padding:10px 20px;border:0;border-radius:12px;background:#17402a;color:#fff;font:600 13px Outfit,system-ui,sans-serif;cursor:pointer';
  button.addEventListener('click', () => window.location.reload());
  box.append(heading, text, button);
  root.replaceChildren(box);
}

// When the preload handler above cancels an error because the page is reloading, the import "succeeds" with nothing: then
// there is nothing to start, and the "Something went wrong" box must not flash up while the new version loads.
const run = (page?: { default: () => void }) => page?.default();

const door = frontDoorFromWindow();
const start = door === 'landing' ? import('./bootLanding').then(run) : door === 'legal' ? import('./bootLegal').then(run) : import('./bootApp').then(run);
start.catch(couldNotStart);
