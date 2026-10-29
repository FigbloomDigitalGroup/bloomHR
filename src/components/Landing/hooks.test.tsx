import { useRef } from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { A11Y_CHANGED } from '../../lib/a11y';
import { useReduceMotion, useRevealOnScroll, useScrolled } from './hooks';

// jsdom has no layout, no IntersectionObserver and no matchMedia: these tests give the hooks stand-ins and play the
// browser's part, so what they do when the browser speaks can be checked.

type Reading = Pick<IntersectionObserverEntry, 'isIntersecting' | 'target'>;
interface Watcher {
  callback: (entries: Reading[]) => void;
  unobserved: Element[];
  disconnected: boolean;
}
let watchers: Watcher[] = [];
let restoreLayout = () => {};

beforeEach(() => {
  watchers = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      watcher: Watcher = { callback: () => {}, unobserved: [], disconnected: false };
      constructor(callback: (entries: Reading[]) => void) {
        this.watcher.callback = callback;
        watchers.push(this.watcher);
      }
      observe() {}
      unobserve = (el: Element) => {
        this.watcher.unobserved.push(el);
      };
      disconnect = () => {
        this.watcher.disconnected = true;
      };
    }
  );
});
afterEach(() => {
  cleanup();
  restoreLayout();
  restoreLayout = () => {};
  vi.unstubAllGlobals();
  window.localStorage.clear();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

/** jsdom has no layout: say where each element is, until the end of the test. */
function placeElements(topOf: (el: HTMLElement) => number) {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const top = topOf(this);
    return { top, bottom: top + 100, left: 0, right: 0, width: 0, height: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  };
  restoreLayout = () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
}
const belowTheFold = (el: HTMLElement) => (el.dataset.testid === 'below' ? window.innerHeight + 600 : 0);

function Page({ reduce }: { reduce: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useRevealOnScroll(root, reduce);
  return (
    <div ref={root}>
      <p data-reveal data-testid="visible">
        on screen
      </p>
      <p data-reveal data-testid="below">
        below the fold
      </p>
    </div>
  );
}

describe('revealing sections as they scroll into view', () => {
  it('hides only what is below the fold, and shows it when it arrives', () => {
    placeElements(belowTheFold);
    const { getByTestId } = render(<Page reduce={false} />);
    expect(getByTestId('visible').dataset.revealState).toBeUndefined();
    expect(getByTestId('below').dataset.revealState).toBe('pending');

    act(() => watchers[0].callback([{ isIntersecting: false, target: getByTestId('below') }]));
    expect(getByTestId('below').dataset.revealState).toBe('pending');

    act(() => watchers[0].callback([{ isIntersecting: true, target: getByTestId('below') }]));
    expect(getByTestId('below').dataset.revealState).toBe('shown');
    expect(watchers[0].unobserved).toContain(getByTestId('below'));
  });

  it('puts everything back when the page goes, so nothing is left hidden', () => {
    placeElements(belowTheFold);
    const { getByTestId, unmount } = render(<Page reduce={false} />);
    const el = getByTestId('below');
    expect(el.dataset.revealState).toBe('pending');
    unmount();
    expect(watchers[0].disconnected).toBe(true);
    expect(el.dataset.revealState).toBeUndefined();
  });

  it('hides nothing at all when the visitor wants less motion', () => {
    placeElements(belowTheFold);
    const { getByTestId } = render(<Page reduce />);
    expect(getByTestId('below').dataset.revealState).toBeUndefined();
    expect(watchers).toHaveLength(0);
  });
});

describe('the top bar changing once the page has moved', () => {
  function Marker({ onValue }: { onValue: (scrolled: boolean) => void }) {
    const marker = useRef<HTMLDivElement>(null);
    onValue(useScrolled(marker));
    return <div ref={marker} />;
  }

  it('follows the marker, and when several readings arrive at once the latest is where the marker is now', () => {
    const seen: boolean[] = [];
    const { container } = render(<Marker onValue={(value) => seen.push(value)} />);
    const target = container.firstElementChild!;
    expect(seen.at(-1)).toBe(false);

    act(() => watchers[0].callback([{ isIntersecting: false, target }]));
    expect(seen.at(-1)).toBe(true);

    // out of sight and back in view within one call: the bar is not "scrolled"
    act(() =>
      watchers[0].callback([
        { isIntersecting: false, target },
        { isIntersecting: true, target },
      ])
    );
    expect(seen.at(-1)).toBe(false);
  });

  it('stops watching when the page goes', () => {
    const { unmount } = render(<Marker onValue={() => {}} />);
    unmount();
    expect(watchers[0].disconnected).toBe(true);
  });

  it('stays in its resting style where there is no IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const seen: boolean[] = [];
    render(<Marker onValue={(value) => seen.push(value)} />);
    expect(seen.every((value) => value === false)).toBe(true);
  });
});

describe('asking for less motion', () => {
  const stubMedia = (matches: boolean) => {
    const listeners = new Set<() => void>();
    const query = {
      matches,
      addEventListener: vi.fn((_type: string, fn: () => void) => listeners.add(fn)),
      removeEventListener: vi.fn((_type: string, fn: () => void) => listeners.delete(fn)),
    };
    window.matchMedia = vi.fn(() => query) as unknown as typeof window.matchMedia;
    return { query, listeners };
  };

  it('follows the operating system setting while the page is open', () => {
    const { query, listeners } = stubMedia(false);
    const { result } = renderHook(() => useReduceMotion());
    expect(result.current).toBe(false);

    query.matches = true;
    act(() => listeners.forEach((fn) => fn()));
    expect(result.current).toBe(true);
  });

  it("follows the app's own Reduce motion switch while the page is open", () => {
    stubMedia(false);
    const { result } = renderHook(() => useReduceMotion());
    expect(result.current).toBe(false);

    window.localStorage.setItem('figbloom.a11y', JSON.stringify({ textScale: 1, bold: false, contrast: false, reduceMotion: true }));
    act(() => {
      window.dispatchEvent(new Event(A11Y_CHANGED));
    });
    expect(result.current).toBe(true);
  });

  it('stops listening when the page goes', () => {
    const { query, listeners } = stubMedia(false);
    const { unmount } = renderHook(() => useReduceMotion());
    expect(listeners.size).toBe(1);
    unmount();
    expect(query.removeEventListener).toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it('works in a browser with no matchMedia at all', () => {
    const { result } = renderHook(() => useReduceMotion());
    expect(result.current).toBe(false);
  });
});
