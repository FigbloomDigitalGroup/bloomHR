import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import LandingPage from './LandingPage';
import { FEATURES, HERO, PRICING, PRICING_QUESTION, ROLES, SEO, SITE, STEPS, WHY } from '../lib/landing';

// jsdom has no matchMedia, IntersectionObserver or scrollIntoView: the page uses all three, and must work without them
beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  document.title = '';
});

const links = (name: RegExp | string) => screen.getAllByRole('link', { name });

describe('the landing page', () => {
  it('has one h1 with the headline, and names every section for screen readers', () => {
    const { container } = render(<LandingPage />);
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0].textContent).toBe(HERO.title);
    for (const section of Array.from(container.querySelectorAll('section'))) {
      const named = section.getAttribute('aria-labelledby') ?? section.getAttribute('aria-label');
      expect(named, section.id || section.className).toBeTruthy();
      if (section.getAttribute('aria-labelledby')) expect(document.getElementById(named!)).toBeTruthy();
    }
  });

  it('answers what it solves, what it offers and why it, without ranking itself', () => {
    render(<LandingPage />);
    // the problem, right under the headline
    expect(screen.getByText(HERO.problem)).toBeTruthy();
    // the offer: the platform, in its own section
    expect(screen.getByRole('region', { name: 'Everything HR runs on, in one place.' })).toBeTruthy();
    // the reasons: a section of things to check, each with a heading of its own, and a way in
    const why = screen.getByRole('region', { name: WHY.title });
    const reasons = within(why).getAllByRole('heading', { level: 3 });
    expect(reasons).toHaveLength(WHY.points.length);
    WHY.points.forEach((point, index) => expect(reasons[index].textContent).toContain(point.title));
    expect(within(why).getByRole('link', { name: 'Create your company' }).getAttribute('href')).toBe('/create-company');
    expect(why.textContent).not.toMatch(/\bbest\b|leading|number one/i);
  });

  it('leads to the two ways into the app: create a company, and sign in', () => {
    render(<LandingPage />);
    const create = links('Create your company');
    expect(create.length).toBeGreaterThanOrEqual(4);
    for (const link of create) expect(link.getAttribute('href')).toBe('/create-company');
    for (const link of links('Sign in')) expect(link.getAttribute('href')).toBe('/login');
  });

  it('has no dead link: nothing points at "#", and every place on the page exists', () => {
    const { container } = render(<LandingPage />);
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
    expect(hrefs).not.toContain('#');
    expect(hrefs).not.toContain('');
    for (const href of hrefs.filter((h) => h.startsWith('#'))) expect(document.getElementById(href.slice(1)), href).toBeTruthy();
    expect(hrefs.every((h) => h.startsWith('#') || h.startsWith('/') || h.startsWith('mailto:'))).toBe(true);
  });

  it('writes to the one address: the talk-to-us button opens an email', () => {
    render(<LandingPage />);
    expect(links('Talk to us').some((l) => l.getAttribute('href')?.startsWith(`mailto:${SITE.email}`))).toBe(true);
    expect(screen.getAllByText(SITE.email).length).toBeGreaterThan(0);
  });

  it('shows no Privacy or Terms link until those pages are approved', () => {
    render(<LandingPage />);
    expect(screen.queryByRole('link', { name: /privacy/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /terms/i })).toBeNull();
  });

  it('sets the title and the canonical address, and puts the title back when it goes', () => {
    document.title = 'Figbloom HR';
    const { unmount } = render(<LandingPage />);
    expect(document.title).toBe(SEO.title);
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${SITE.origin}/`);
    unmount();
    expect(document.title).toBe('Figbloom HR');
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it('says it uses sample data and illustrative people', () => {
    render(<LandingPage />);
    expect(screen.getAllByText('Sample data').length).toBeGreaterThan(3);
    expect(screen.getByText(/People shown in photographs are illustrative/)).toBeTruthy();
  });
});

describe('the feature tabs', () => {
  const tab = (name: string) => screen.getByRole('tab', { name });

  it('open one at a time, each with its own panel', () => {
    render(<LandingPage />);
    expect(within(screen.getByRole('tablist', { name: 'Parts of the platform' })).getAllByRole('tab')).toHaveLength(FEATURES.length);
    expect(tab('People').getAttribute('aria-selected')).toBe('true');

    fireEvent.click(tab('Payroll'));
    expect(tab('Payroll').getAttribute('aria-selected')).toBe('true');
    expect(tab('People').getAttribute('aria-selected')).toBe('false');
    const panel = screen.getByRole('tabpanel', { name: 'Payroll' });
    expect(within(panel).getByRole('heading', { name: FEATURES.find((f) => f.id === 'payroll')!.title })).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'Create your company' }).getAttribute('href')).toBe('/create-company');
  });

  it('move with the arrow keys, Home and End, and keep only the open tab in the Tab order', () => {
    render(<LandingPage />);
    fireEvent.click(tab('Payroll'));
    fireEvent.keyDown(tab('Payroll'), { key: 'ArrowRight' });
    expect(tab('Casual & piece rate').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('Casual & piece rate'));
    expect(tab('Payroll').getAttribute('tabindex')).toBe('-1');
    expect(tab('Casual & piece rate').getAttribute('tabindex')).toBe('0');

    fireEvent.keyDown(tab('Casual & piece rate'), { key: 'ArrowLeft' });
    expect(tab('Payroll').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab('Payroll'), { key: 'Home' });
    expect(tab('People').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab('People'), { key: 'ArrowLeft' });
    expect(tab('Staff portal').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab('Staff portal'), { key: 'ArrowRight' });
    expect(tab('People').getAttribute('aria-selected')).toBe('true');
    // End has to move from a tab that is not already the last one
    fireEvent.keyDown(tab('People'), { key: 'End' });
    expect(tab('Staff portal').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('Staff portal'));
  });

  it('show how casual workers and piece-rate work are paid, in a part of their own', () => {
    render(<LandingPage />);
    fireEvent.click(tab('Casual & piece rate'));
    const work = FEATURES.find((f) => f.id === 'work')!;
    const panel = screen.getByRole('tabpanel', { name: 'Casual & piece rate' });
    expect(within(panel).getByRole('heading', { name: work.title })).toBeTruthy();
    expect(within(panel).getAllByRole('listitem').length).toBeGreaterThanOrEqual(work.benefits.length);
    expect(within(panel).getByRole('img', { name: /Sample casual workers' week/ })).toBeTruthy();
  });

  it("leave the browser's own keys and the page's scrolling alone", () => {
    render(<LandingPage />);
    fireEvent.click(tab('Payroll'));
    // Alt+Left is "back", Ctrl+Home is "top of the page"
    fireEvent.keyDown(tab('Payroll'), { key: 'ArrowLeft', altKey: true });
    fireEvent.keyDown(tab('Payroll'), { key: 'Home', ctrlKey: true });
    expect(tab('Payroll').getAttribute('aria-selected')).toBe('true');
    // the tabs lie in a row, so Up and Down keep scrolling the page
    const down = fireEvent.keyDown(tab('Payroll'), { key: 'ArrowDown' });
    expect(down).toBe(true); // not cancelled
    expect(tab('Payroll').getAttribute('aria-selected')).toBe('true');
  });

  it('point only the open tab at a panel, because only that panel is in the page', () => {
    render(<LandingPage />);
    const open = tab('People');
    expect(document.getElementById(open.getAttribute('aria-controls')!)).toBeTruthy();
    expect(tab('Payroll').hasAttribute('aria-controls')).toBe(false);
  });

  it('are the same for the roles: one at a time, with the arrow keys', () => {
    render(<LandingPage />);
    const roles = within(screen.getByRole('tablist', { name: 'Roles' }));
    expect(roles.getAllByRole('tab')).toHaveLength(ROLES.length);
    const first = roles.getByRole('tab', { name: ROLES[0].label });
    expect(first.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(roles.getByRole('tab', { name: 'Finance and payroll' }));
    const panel = screen.getByRole('tabpanel', { name: 'Finance and payroll' });
    expect(within(panel).getByRole('heading', { name: ROLES.find((r) => r.id === 'finance')!.title })).toBeTruthy();

    fireEvent.keyDown(roles.getByRole('tab', { name: 'Finance and payroll' }), { key: 'ArrowRight' });
    expect(roles.getByRole('tab', { name: 'Managers' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(roles.getByRole('tab', { name: 'Managers' }), { key: 'Home' });
    expect(first.getAttribute('aria-selected')).toBe('true');
  });

  it('are also opened from the header: Features lists them and jumps to the showcase', () => {
    render(<LandingPage />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const button = within(nav).getByRole('button', { name: /Features/ });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(within(nav).getByRole('link', { name: 'Hiring' }));
    expect(tab('Hiring').getAttribute('aria-selected')).toBe('true');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('keep the Features list in the page, hidden while closed, so the button always points at something', () => {
    render(<LandingPage />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const button = within(nav).getByRole('button', { name: /Features/ });
    const list = document.getElementById(button.getAttribute('aria-controls')!)!;
    expect(list.hasAttribute('hidden')).toBe(true);
    fireEvent.click(button);
    expect(list.hasAttribute('hidden')).toBe(false);
  });

  it('close the Features list with Escape and hand focus back to its button', () => {
    render(<LandingPage />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const button = within(nav).getByRole('button', { name: /Features/ });
    button.focus();
    fireEvent.click(button);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('do not pull focus back to the Features button when Escape is pressed somewhere else', () => {
    render(<LandingPage />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const button = within(nav).getByRole('button', { name: /Features/ });
    fireEvent.click(button);
    const elsewhere = within(nav).getByRole('link', { name: 'FAQ' });
    elsewhere.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(elsewhere);
  });

  it('close the Features list when the keyboard leaves it, and not while it moves inside it', () => {
    render(<LandingPage />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const button = within(nav).getByRole('button', { name: /Features/ });
    fireEvent.click(button);
    const list = document.getElementById('lp-features-list')!;
    const [first, second] = within(list).getAllByRole('link');

    fireEvent.blur(first, { relatedTarget: second });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.blur(second, { relatedTarget: within(nav).getByRole('link', { name: 'FAQ' }) });
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('moving around the page', () => {
  it('takes a link in the header to its section and puts keyboard focus there', () => {
    render(<LandingPage />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    fireEvent.click(within(nav).getByRole('link', { name: 'How it works' }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(window.location.hash).toBe('#how');
    expect(document.activeElement).toBe(document.getElementById('how'));
  });

  it('scrolls without animation when the visitor wants less motion', () => {
    window.localStorage.setItem('figbloom.a11y', JSON.stringify({ textScale: 1, bold: false, contrast: false, reduceMotion: true }));
    render(<LandingPage />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'FAQ' }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('opens at the place named in the address', async () => {
    window.history.replaceState(null, '', '/#faq');
    render(<LandingPage />);
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect(document.activeElement).toBe(document.getElementById('faq'));
  });
});

describe('the phone menu', () => {
  it('opens and closes, and closes when a place is chosen', () => {
    render(<LandingPage />);
    // one name, whether it is open or not: aria-expanded says which
    const toggle = screen.getByRole('button', { name: 'Menu' });
    const panel = document.getElementById('lp-mobile-menu')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hasAttribute('hidden')).toBe(true);

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hasAttribute('hidden')).toBe(false);

    fireEvent.click(within(panel).getByRole('link', { name: 'FAQ' }));
    expect(panel.hasAttribute('hidden')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes with Escape and hands focus back to its button, so the keyboard does not start again from the top', () => {
    render(<LandingPage />);
    const toggle = screen.getByRole('button', { name: 'Menu' });
    const panel = document.getElementById('lp-mobile-menu')!;
    fireEvent.click(toggle);
    within(panel).getByRole('link', { name: 'FAQ' }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(panel.hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(toggle);
  });

  it('fits the real screen height when text is larger, because the bar is fixed and cannot be scrolled past', () => {
    render(<LandingPage />);
    const panel = document.getElementById('lp-mobile-menu')!;
    expect(panel.innerHTML).toContain('var(--screen-h)');
    expect(panel.innerHTML).not.toMatch(/\b100vh\b/);
  });
});

describe('the questions', () => {
  it('open and close, say which they are doing, and hide a closed answer from everyone', () => {
    render(<LandingPage />);
    const first = screen.getByRole('button', { name: 'How do we get started?' });
    const second = screen.getByRole('button', { name: 'Does Figbloom pay our staff?' });
    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(second.getAttribute('aria-expanded')).toBe('false');
    const answer = document.getElementById(second.getAttribute('aria-controls')!)!;
    expect(answer.hasAttribute('hidden')).toBe(true);

    fireEvent.click(second);
    expect(second.getAttribute('aria-expanded')).toBe('true');
    expect(answer.hasAttribute('hidden')).toBe(false);
    expect(within(answer).getByText(/^No\./)).toBeTruthy();
    expect(first.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(second);
    expect(answer.hasAttribute('hidden')).toBe(true);
  });
});

describe('less motion', () => {
  it('is on by default, and off when the visitor asks for less', () => {
    const { container, unmount } = render(<LandingPage />);
    expect(container.querySelector('.lp')?.getAttribute('data-motion')).toBe('on');
    unmount();

    window.localStorage.setItem('figbloom.a11y', JSON.stringify({ textScale: 1, bold: false, contrast: false, reduceMotion: true }));
    const again = render(<LandingPage />);
    expect(again.container.querySelector('.lp')?.getAttribute('data-motion')).toBe('off');
  });

  it('follows the operating system setting too', () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
    const { container } = render(<LandingPage />);
    expect(container.querySelector('.lp')?.getAttribute('data-motion')).toBe('off');
  });

  it('still shows everything when IntersectionObserver is missing', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { container } = render(<LandingPage />);
    expect(container.querySelectorAll('[data-reveal-state="pending"]')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });
});

describe('how it works', () => {
  const steps = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('#how li[data-step]'));

  it('lists the four steps in order, each with its words on the page whatever the motion', () => {
    const { container } = render(<LandingPage />);
    const how = screen.getByRole('region', { name: /four steps/ });
    const items = within(how).getAllByRole('listitem');
    expect(items).toHaveLength(STEPS.length);
    STEPS.forEach((step, index) => {
      expect(items[index].textContent).toContain(step.title);
      expect(items[index].textContent).toContain(step.text.text);
    });
    expect(steps(container)).toHaveLength(STEPS.length);
  });

  it('waits for each step to come into view, and dims it until then', () => {
    const { container } = render(<LandingPage />);
    expect(steps(container).map((li) => li.dataset.lit)).toEqual(['off', 'off', 'off', 'off']);
  });

  it('shows every step finished for a visitor who wants less motion, and where nothing can tell what is on screen', () => {
    window.localStorage.setItem('figbloom.a11y', JSON.stringify({ textScale: 1, bold: false, contrast: false, reduceMotion: true }));
    const calm = render(<LandingPage />);
    expect(steps(calm.container).every((li) => li.dataset.lit === undefined)).toBe(true);
    calm.unmount();
    window.localStorage.clear();

    vi.stubGlobal('IntersectionObserver', undefined);
    const blind = render(<LandingPage />);
    expect(steps(blind.container).every((li) => li.dataset.lit === undefined)).toBe(true);
  });

  it('keeps the little pictures out of a screen reader: the steps already say it all', () => {
    const { container } = render(<LandingPage />);
    for (const li of steps(container)) {
      const picture = li.querySelector('[data-spot]');
      expect(picture?.querySelector('[aria-hidden="true"]'), li.textContent ?? '').toBeTruthy();
    }
  });
});

describe('the price', () => {
  it('has a section of its own, with a link to it in the header', () => {
    render(<LandingPage />);
    const pricing = screen.getByRole('region', { name: PRICING.title });
    expect(pricing.id).toBe('pricing');
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Pricing' }));
    expect(window.location.hash).toBe('#pricing');
    expect(document.activeElement).toBe(pricing);
  });

  it('shows the two amounts the owner set, and nothing else in money', () => {
    render(<LandingPage />);
    const pricing = screen.getByRole('region', { name: PRICING.title });
    expect(within(pricing).getByText('10,000')).toBeTruthy();
    expect(within(pricing).getByText('250')).toBeTruthy();
    expect(pricing.textContent).toContain(PRICING.monthlyNote);
    expect(pricing.textContent).toContain(PRICING.perEmployeeNote);
    // (the text of neighbouring elements runs together, so an amount is read as thousands in groups of three)
    const amounts = (pricing.textContent ?? '').match(/KES\s?\d{1,3}(,\d{3})*/g) ?? [];
    expect(amounts.length).toBeGreaterThan(0);
    for (const amount of amounts) expect(['KES 16,250', 'KES 10,000', 'KES 6,250', 'KES 250'], amount).toContain(amount);
  });

  it('works out a month for any headcount, and says it aloud', () => {
    render(<LandingPage />);
    const slider = screen.getByRole('slider', { name: PRICING.estimate });
    expect(slider.getAttribute('aria-valuetext')).toBe('25 active employees, KES 16,250 a month');

    fireEvent.change(slider, { target: { value: '1' } });
    expect(slider.getAttribute('aria-valuetext')).toBe('1 active employee, KES 10,250 a month');

    fireEvent.change(slider, { target: { value: '100' } });
    expect(slider.getAttribute('aria-valuetext')).toBe('100 active employees, KES 35,000 a month');
    const pricing = screen.getByRole('region', { name: PRICING.title });
    // the figure that runs is hidden from a screen reader, which is given the finished one
    expect(within(pricing).getByText('KES 35,000', { selector: '.sr-only' })).toBeTruthy();
    expect(within(pricing).getByText('KES 25,000')).toBeTruthy();
  });

  it('is stated again under the questions', () => {
    render(<LandingPage />);
    const ask = screen.getByRole('button', { name: PRICING_QUESTION.q });
    fireEvent.click(ask);
    expect(screen.getByText(PRICING_QUESTION.a)).toBeTruthy();
  });
});
