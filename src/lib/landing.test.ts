import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILT_IN, FAQ, HERO, LINKS, OUTCOMES, PAYROLL, SEO, SITE, WHY, allCopy, allFacts } from './landing';

// The landing page may only say what the product does. These tests keep it that way: every claim names the files that
// show it (and the files must exist), and the words the owner ruled out cannot come back.

// tests run from the repository's root
const root = `${process.cwd().replace(/\\/g, '/')}/`;
const indexHtml = readFileSync(`${root}index.html`, 'utf8');

describe('what the landing page claims', () => {
  const facts = allFacts();

  it('is a long list, and every claim names the files that show it', () => {
    expect(facts.length).toBeGreaterThan(40);
    // the page is kept short: a few words for each part, and the picture of the product does the rest
    const words = allCopy().join(' ').split(/\s+/).filter(Boolean).length;
    expect(words).toBeLessThan(1100);
    for (const fact of facts) expect(fact.evidence.length, fact.text).toBeGreaterThan(0);
  });

  it('points only at files that exist, so a renamed or removed feature is noticed', () => {
    const missing = facts.flatMap((fact) => fact.evidence.filter((path) => !existsSync(`${root}${path}`)).map((path) => `${path}  (for: ${fact.text})`));
    expect(missing).toEqual([]);
  });
});

describe('what the landing page must never say', () => {
  // each pattern was ruled out because the product or the owner does not back it (see the list at the top of landing.ts)
  const BANNED: [string, RegExp][] = [
    ['an uptime or support-hours promise', /99\.9|24\s?\/\s?7|uptime|\bSLA\b|support hours/i],
    ['a certification or registration', /SOC\s?2|ISO\s?27001|certified|ODPC|penetration test/i],
    ['a statutory guarantee', /compliant|compliance|guarantee|accurate/i],
    ['a price, plan or trial', /free trial|no credit card|per employee|per month|\bpricing (starts|from)\b|\bKES\s?\d/i],
    ['social proof that does not exist', /trusted by|testimonial|case stud|our customers|loved by|\d[\d,]*\+?\s+(customers|companies|clients|employees paid)/i],
    ['paying salaries from the app', /pay[^.]{0,40}\bfrom (the|inside the) app|pays? (your )?(staff|employees|salaries) (in|from) (the )?(app|figbloom)|send(s)? (your )?salar/i],
    ['the hidden Expenses module', /expense/i],
    ['a feature that does not exist', /e-?signature|mobile app|\bSSO\b|single sign-on|whatsapp integration|zapier|quickbooks|\bAPI access\b|post (a )?jobs?\b/i],
    ['a time promise nobody measured', /\bin (just )?(a few |under |less than )?(minutes|seconds)\b|instantly/i],
    ['a percentage or other figure dressed as a result', /\d+\s?%/],
    // there are no customers, benchmarks or reviews to rank against: the page says what the product does and lets people check
    ['a ranking nobody can back', /\b(best|leading|number one|world-class|unmatched|unrivalled|market leader|fastest|cheapest|most (trusted|accurate|powerful|advanced|complete))\b|#\s?1\b/i],
    ['a claim about other products', /\b(unlike|better than|faster than|cheaper than|instead of|competitors?|alternatives?)\b/i],
    // the owner chose not to fence the page in with a country list, nor to promise every country (see landing.ts)
    ['a list of countries, or every country', /Tanzania|Uganda|Rwanda|East Africa|across Africa|\b(any|every|all) countr/i],
  ];

  for (const [name, pattern] of BANNED) {
    it(`has no ${name}`, () => {
      const hits = allCopy().filter((text) => pattern.test(text));
      expect(hits).toEqual([]);
    });
  }

  it('says plainly that Figbloom does not send the money', () => {
    expect(PAYROLL.steps.some((step) => /doesn't send the money/i.test(step.text.text))).toBe(true);
    const pay = FAQ.find((item) => /pay our staff/i.test(item.q));
    expect(pay?.a.text.startsWith('No.')).toBe(true);
  });
});

// A visitor wants three things answered: what problem this solves, what it offers, and why this one. The page answers
// the third with things to check, never with a ranking (see the list above).
describe('what a visitor wants answered', () => {
  it('names the problem, in the first words under the headline', () => {
    expect(HERO.problem).toMatch(/chasing/i);
    expect(OUTCOMES.length).toBe(4);
    for (const outcome of OUTCOMES) expect(outcome.from.length, outcome.id).toBeGreaterThan(0);
  });

  it('says what it offers, and where', () => {
    expect(HERO.eyebrow).toMatch(/HR and payroll/);
    expect(HERO.text).toMatch(/records, leave, attendance, approvals and monthly payroll/i);
  });

  it('gives reasons to choose it that can each be checked, and ends by inviting the visitor to check', () => {
    expect(WHY.points.length).toBeGreaterThanOrEqual(4);
    for (const point of WHY.points) expect(point.text.evidence.length, point.title).toBeGreaterThan(0);
    expect(WHY.title.length).toBeGreaterThan(0);
    expect(WHY.close).toMatch(/check/i);
  });
});

describe('contact and search text', () => {
  it('uses one address, in the link and in every sentence that gives it', () => {
    expect(LINKS.mail.startsWith(`mailto:${SITE.email}`)).toBe(true);
    const addresses = allCopy().flatMap((text) => text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []);
    expect(new Set(addresses)).toEqual(new Set([SITE.email]));
  });

  it('keeps the title and description a search result shows within their limits', () => {
    expect(SEO.title.length).toBeLessThanOrEqual(65);
    expect(SEO.description.length).toBeLessThanOrEqual(160);
  });

  it('gives crawlers that run no scripts, in index.html, the same description and the same facts', () => {
    const description = indexHtml.match(/<meta name="description" content="([^"]*)">/)?.[1];
    expect(description).toBe(SEO.description);
    expect(indexHtml.match(/<meta property="og:description" content="([^"]*)">/)?.[1]).toBe(SEO.description);
    expect(indexHtml.match(/<meta property="og:title" content="([^"]*)">/)?.[1]).toBe(SEO.title);
    // the plain list in <noscript> repeats claims the page makes, word for word
    const spoken = BUILT_IN.map((item) => item.fact.text);
    const listed = [...indexHtml.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1]);
    expect(listed.length).toBeGreaterThan(0);
    for (const line of listed) expect(spoken, line).toContain(line);
  });

  it('leaves the app\'s own title alone, and names no address of its own: index.html is shared by every route', () => {
    expect(indexHtml).toContain('<title>Figbloom HR</title>');
    // a canonical link or og:url here would tell a crawler that every page, a company's careers page included, is the home page
    expect(indexHtml).not.toMatch(/rel="canonical"/);
    expect(indexHtml).not.toMatch(/property="og:url"/);
  });

  it('tells a visitor with scripts off that the page needs them, before anything else', () => {
    const noscript = indexHtml.match(/<noscript>\s*<div[\s\S]*?<\/noscript>/)?.[0] ?? '';
    expect(noscript.indexOf('needs JavaScript')).toBeGreaterThan(-1);
    expect(noscript.indexOf('needs JavaScript')).toBeLessThan(noscript.indexOf('<ul>'));
  });
});
