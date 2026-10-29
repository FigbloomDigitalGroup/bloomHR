import { useRef } from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { A11Y_CHANGED } from '../../lib/a11y';
import { useReduceMotion, useRevealOnScroll, useScrolled, useSeen, useSpotlight, useStepSequence, useTween } from './hooks';

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

describe('lighting steps one after another', () => {
  function Steps({ reduce }: { reduce: boolean }) {
    const root = useRef<HTMLOListElement>(null);
    const { lit, live } = useStepSequence(root, 3, reduce, 800);
    return (
      <ol ref={root} data-testid="list" data-lit={lit} data-live={String(live)}>
        {[0, 1, 2].map((i) => (
          <li key={i} data-step={i} data-testid={`step${i}`} />
        ))}
      </ol>
    );
  }
  const lit = (el: HTMLElement) => Number(el.dataset.lit);
  const arrive = (get: (id: string) => HTMLElement, ...indexes: number[]) =>
    act(() => watchers[0].callback(indexes.map((i) => ({ isIntersecting: true, target: get(`step${i}`) }))));
  const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with nothing lit, then lights steps that arrive together in turn', () => {
    const { getByTestId } = render(<Steps reduce={false} />);
    const list = getByTestId('list');
    expect(lit(list)).toBe(0);
    expect(list.dataset.live).toBe('true');

    arrive(getByTestId, 0, 1, 2);
    expect(lit(list)).toBe(0);
    wait(250);
    expect(lit(list)).toBe(1);
    wait(799);
    expect(lit(list)).toBe(1);
    wait(1);
    expect(lit(list)).toBe(2);
    wait(800);
    expect(lit(list)).toBe(3);
    wait(5000);
    expect(lit(list)).toBe(3);
  });

  it('never lights a step before the one ahead of it, however early it arrives', () => {
    const { getByTestId } = render(<Steps reduce={false} />);
    const list = getByTestId('list');
    arrive(getByTestId, 2);
    wait(5000);
    expect(lit(list)).toBe(0);
    arrive(getByTestId, 0);
    wait(250);
    expect(lit(list)).toBe(1);
    wait(5000);
    expect(lit(list)).toBe(1);
    arrive(getByTestId, 1);
    wait(800);
    expect(lit(list)).toBe(2);
    wait(800);
    expect(lit(list)).toBe(3);
  });

  it('stops watching and waiting when the page goes', () => {
    const { getByTestId, unmount } = render(<Steps reduce={false} />);
    arrive(getByTestId, 0);
    unmount();
    expect(watchers[0].disconnected).toBe(true);
    expect(() => wait(5000)).not.toThrow();
  });

  it('lights every step at once, and watches nothing, when the visitor wants less motion', () => {
    const { getByTestId } = render(<Steps reduce />);
    expect(lit(getByTestId('list'))).toBe(3);
    expect(getByTestId('list').dataset.live).toBe('false');
    expect(watchers).toHaveLength(0);
  });

  it('lights every step where there is no IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { getByTestId } = render(<Steps reduce={false} />);
    expect(lit(getByTestId('list'))).toBe(3);
    expect(getByTestId('list').dataset.live).toBe('false');
  });
});

describe('knowing that something has been on screen', () => {
  function Mark({ reduce }: { reduce: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    return <div ref={ref} data-testid="mark" data-seen={String(useSeen(ref, reduce))} />;
  }

  it('turns true when it arrives, and watches no more', () => {
    const { getByTestId } = render(<Mark reduce={false} />);
    expect(getByTestId('mark').dataset.seen).toBe('false');
    act(() => watchers[0].callback([{ isIntersecting: false, target: getByTestId('mark') }]));
    expect(getByTestId('mark').dataset.seen).toBe('false');
    act(() => watchers[0].callback([{ isIntersecting: true, target: getByTestId('mark') }]));
    expect(getByTestId('mark').dataset.seen).toBe('true');
    expect(watchers[0].disconnected).toBe(true);
  });

  it('is true from the start when the visitor wants less motion or the browser cannot tell', () => {
    expect(render(<Mark reduce />).getByTestId('mark').dataset.seen).toBe('true');
    cleanup();
    vi.stubGlobal('IntersectionObserver', undefined);
    expect(render(<Mark reduce={false} />).getByTestId('mark').dataset.seen).toBe('true');
  });
});

describe('a number that runs to its target', () => {
  let frames: ((now: number) => void)[] = [];
  let clock = 0;
  const tick = (to: number) =>
    act(() => {
      clock = to;
      const pending = frames;
      frames = [];
      pending.forEach((fn) => fn(to));
    });

  beforeEach(() => {
    frames = [];
    clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    vi.stubGlobal('requestAnimationFrame', (fn: (now: number) => void) => frames.push(fn));
    vi.stubGlobal('cancelAnimationFrame', () => {
      frames = [];
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts on its target, runs to a new one, and ends exactly on it', () => {
    const { result, rerender } = renderHook(({ target }) => useTween(target, false, 400), { initialProps: { target: 100 } });
    expect(result.current).toBe(100);

    rerender({ target: 200 });
    tick(0);
    expect(result.current).toBe(100);
    tick(200);
    expect(result.current).toBeGreaterThan(150);
    expect(result.current).toBeLessThan(200);
    tick(400);
    expect(result.current).toBe(200);
    tick(800);
    expect(result.current).toBe(200);
  });

  it('turns round from where it is when the target changes in mid-run', () => {
    const { result, rerender } = renderHook(({ target }) => useTween(target, false, 400), { initialProps: { target: 0 } });
    rerender({ target: 100 });
    tick(0);
    tick(200);
    expect(result.current).toBeGreaterThan(0);
    rerender({ target: 0 });
    tick(200);
    tick(600);
    expect(result.current).toBe(0);
  });

  it('is simply the target when the visitor wants less motion', () => {
    const { result, rerender } = renderHook(({ target }) => useTween(target, true), { initialProps: { target: 100 } });
    rerender({ target: 300 });
    expect(result.current).toBe(300);
    expect(frames).toHaveLength(0);
  });
});

describe('a light that follows the mouse', () => {
  function Card({ reduce }: { reduce: boolean }) {
    const root = useRef<HTMLDivElement>(null);
    useSpotlight(root, reduce);
    return (
      <div ref={root}>
        <div data-spot data-testid="card">
          <span data-testid="inner">text</span>
        </div>
        <p data-testid="plain">no light here</p>
      </div>
    );
  }
  const move = (el: Element, pointerType: string, x = 30, y = 20) => {
    const event = new Event('pointermove', { bubbles: true });
    Object.assign(event, { pointerType, clientX: x, clientY: y });
    act(() => void el.dispatchEvent(event));
  };

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
      fn();
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    placeElements(() => 5);
  });

  it('puts the light where the mouse is, measured from the card and also from something inside it', () => {
    const { getByTestId } = render(<Card reduce={false} />);
    move(getByTestId('inner'), 'mouse');
    // the stand-in layout puts every box at left 0, top 5
    expect(getByTestId('card').style.getPropertyValue('--mx')).toBe('30px');
    expect(getByTestId('card').style.getPropertyValue('--my')).toBe('15px');
  });

  it('divides by the page zoom, so larger text does not push the light off the pointer', () => {
    const { getByTestId } = render(<Card reduce={false} />);
    const card = getByTestId('card');
    // drawn 100 wide but laid out 50 wide: the page is zoomed to 200%
    card.getBoundingClientRect = () => ({ top: 0, left: 10, width: 100, height: 100, right: 110, bottom: 100, x: 10, y: 0, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(card, 'offsetWidth', { value: 50, configurable: true });
    move(card, 'mouse', 50, 40);
    expect(card.style.getPropertyValue('--mx')).toBe('20px');
    expect(card.style.getPropertyValue('--my')).toBe('20px');
  });

  it('ignores a finger and a pen, anything that is not a card, and a visitor who wants less motion', () => {
    const { getByTestId, unmount } = render(<Card reduce={false} />);
    move(getByTestId('inner'), 'touch');
    move(getByTestId('inner'), 'pen');
    move(getByTestId('plain'), 'mouse');
    expect(getByTestId('card').style.getPropertyValue('--mx')).toBe('');
    unmount();

    const calm = render(<Card reduce />);
    move(calm.getByTestId('inner'), 'mouse');
    expect(calm.getByTestId('card').style.getPropertyValue('--mx')).toBe('');
  });
});
