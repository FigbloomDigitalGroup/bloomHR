import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useState } from 'react';

const toastFn = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', () => ({ default: toastFn }));

import { canGoBackInApp, onOverlayEntry, resetBackToCloseForTests, useBackToClose, useExitGuard } from './useBackToClose';

// jsdom's history: back() reports with a popstate a moment later, like a browser
const back = async () => {
  await act(async () => {
    const popped = new Promise((r) => window.addEventListener('popstate', r, { once: true }));
    window.history.back();
    await popped;
    await new Promise((r) => setTimeout(r, 20));
  });
};
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });

function Overlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  useBackToClose(open, onClose);
  return open ? <div role="dialog">open</div> : null;
}

function Harness({ initial = false }: { initial?: boolean }) {
  const [a, setA] = useState(initial);
  const [b, setB] = useState(false);
  return (
    <>
      <button onClick={() => setA(true)}>open a</button>
      <button onClick={() => setA(false)}>close a</button>
      <button onClick={() => setB(true)}>open b</button>
      <button onClick={() => setB(false)}>close b</button>
      <Overlay open={a} onClose={() => setA(false)} />
      <Overlay open={b} onClose={() => setB(false)} />
      <span data-testid="state">{`${a ? 'A' : '-'}${b ? 'B' : '-'}`}</span>
    </>
  );
}

let base = 0;
beforeEach(async () => {
  resetBackToCloseForTests();
  // a fresh page entry to start from
  window.history.pushState({ idx: 0, key: 'page' }, '', '/page');
  base = window.history.length;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const click = (c: HTMLElement, name: string) => act(() => { (Array.from(c.querySelectorAll('button')).find((b) => b.textContent === name) as HTMLButtonElement).click(); });
const shown = (c: HTMLElement) => c.querySelector('[data-testid="state"]')!.textContent;

describe('useBackToClose', () => {
  it('adds a history entry when the overlay opens, and Back closes it without leaving the page', async () => {
    const { container } = render(<Harness />);
    await click(container, 'open a');
    expect(window.history.length).toBe(base + 1);
    expect(onOverlayEntry()).toBe(true);
    expect(window.location.pathname).toBe('/page');

    await back();
    expect(shown(container)).toBe('--');
    expect(onOverlayEntry()).toBe(false);
    expect(window.location.pathname).toBe('/page');
    expect(window.history.state).toMatchObject({ key: 'page' });
  });

  it('takes its entry off again when closed another way, so one Back is enough afterwards', async () => {
    const { container } = render(<Harness />);
    await click(container, 'open a');
    await click(container, 'close a');
    await settle();
    expect(onOverlayEntry()).toBe(false);
    expect(window.history.state).toMatchObject({ key: 'page' });
  });

  it('closes the top overlay first when two are open', async () => {
    const { container } = render(<Harness />);
    await click(container, 'open a');
    await click(container, 'open b');
    expect(shown(container)).toBe('AB');

    await back();
    expect(shown(container)).toBe('A-');
    await back();
    expect(shown(container)).toBe('--');
    expect(window.history.state).toMatchObject({ key: 'page' });
  });

  it('waits for its own step back before adding the next entry (one closes as another opens)', async () => {
    const { container } = render(<Harness />);
    await click(container, 'open a');
    await act(() => {
      (Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'close a') as HTMLButtonElement).click();
      (Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'open b') as HTMLButtonElement).click();
    });
    await settle();
    expect(shown(container)).toBe('-B');
    expect(onOverlayEntry()).toBe(true);

    await back();
    expect(shown(container)).toBe('--');
    expect(window.history.state).toMatchObject({ key: 'page' });
  });

  it('removes its entry when the component goes away while open', async () => {
    const { unmount } = render(<Harness initial />);
    expect(onOverlayEntry()).toBe(true);
    unmount();
    await settle();
    expect(onOverlayEntry()).toBe(false);
  });

  it('skips the entry of an overlay that closed while a page was opened over it', async () => {
    const { container } = render(<Harness />);
    await click(container, 'open a');
    // a page opened from the overlay, then the overlay closes (as the menu does)
    window.history.pushState({ idx: 2, key: 'next' }, '', '/next');
    await click(container, 'close a');
    await settle();
    expect(window.location.pathname).toBe('/next');

    await back();
    await settle();
    expect(window.history.state).toMatchObject({ key: 'page' });
  });
});

describe('canGoBackInApp', () => {
  it('uses the router entry number, else whether this is the first entry', () => {
    window.history.replaceState({ idx: 0 }, '');
    expect(canGoBackInApp('abc')).toBe(false);
    window.history.replaceState({ idx: 3 }, '');
    expect(canGoBackInApp('default')).toBe(true);
    window.history.replaceState(null, '');
    expect(canGoBackInApp('default')).toBe(false);
    expect(canGoBackInApp('k1')).toBe(true);
  });
});

describe('useExitGuard', () => {
  const setStandalone = (on: boolean) => {
    window.matchMedia = ((q: string) => ({ matches: on && q.includes('standalone'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  };
  function Guard({ atHome, goHome }: { atHome: boolean; goHome: () => void }) {
    useExitGuard(atHome, goHome);
    return null;
  }
  afterEach(() => setStandalone(false));

  it('in a browser tab, never holds Back', () => {
    setStandalone(false);
    const before = window.history.length;
    render(<Guard atHome goHome={() => {}} />);
    expect(window.history.length).toBe(before);
  });

  it('in the installed app, the first Back on the start page says "Press back again to exit"', async () => {
    setStandalone(true);
    toastFn.mockClear();
    const before = window.history.length;
    render(<Guard atHome goHome={() => {}} />);
    expect(window.history.length).toBe(before + 1);
    expect(window.history.state).toMatchObject({ idx: 1, __exitGuard: true });

    await back();
    expect(toastFn).toHaveBeenCalledWith('Press back again to exit', expect.anything());
    // the second Back is not held: nothing is added back during the two seconds
    expect(window.history.state).toMatchObject({ idx: 0 });
  });

  it('in the installed app, Back on a first page that is not the start page goes to the start page', async () => {
    setStandalone(true);
    const goHome = vi.fn();
    render(<Guard atHome={false} goHome={goHome} />);
    await back();
    expect(goHome).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(window.history.state).toMatchObject({ __exitGuard: true }));
  });
});
