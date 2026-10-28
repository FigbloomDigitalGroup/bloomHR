# The public landing page

A signed-out visit to `/` shows the landing page. Everything else (sign-in, create company, invitations, careers pages,
the app) works as before.

## How it is mounted

`src/main.tsx` asks `frontDoor()` (`src/lib/landingRoute.ts`) what the address should open, before anything else loads:

- **landing** (`src/bootLanding.tsx`): exactly `/`, nobody signed in, not an installed app, and nothing in the query or
  hash except where the visitor came from (`utm_*`, `ref`, `gclid`, `fbclid`) or a place on the page (`#faq`).
- **legal** (`src/bootLegal.tsx`): `/privacy` and `/terms`, but only once approved (see below).
- **app** (`src/bootApp.tsx`): everything else. This is what `main.tsx` used to do, in the same order.

The landing bundle has no app in it (no sign-in, no database client, no router). Its links are plain addresses, so each
one opens the app fresh. Links Supabase sends back to `/` (email confirmation, password reset, errors) carry tokens in the
query or hash, so they still reach the app.

**Off switch:** build with `VITE_LANDING_PAGE=off` and `/` behaves as it did before the landing page existed.

## Changing what it says

All the words are in `src/lib/landing.ts`. Every sentence about what the product does is a `Fact`: the sentence and the
files that show it. `src/lib/landing.test.ts` opens those files, and refuses wording the owner ruled out (uptime or
certification claims, "compliant", prices or trials, paying salaries from the app, made-up numbers, and more). If a
feature is renamed or removed, the test fails and the sentence has to be looked at.

Product screens on the page are drawn from the app's own components and menu text, with made-up people, labelled
"Sample data". The sample payslip's figures come from the Kenyan payroll engine and are re-checked by
`src/components/Landing/previews/payslipSample.test.ts`.

### Few words

The page says as little as it can: a headline, a short line, and a picture of the product. About 1,000 words in all
(`landing.test.ts` fails above 1,100), and a visitor never sees most of them at once, because the platform tabs, the roles
and the questions show one at a time. When you add copy, cut something else, and keep a shortened sentence a narrower
version of what was checked against the code, never a broader one. There is no "Files and devices" section or "Inside the
product" gallery any more (the same pictures appear in the tabs); the files and the "Figbloom does not send the money"
line live in the payroll band and the questions.

### Countries

The page names no list of countries and does not promise "any country" (`landing.test.ts` refuses Tanzania, Uganda,
Rwanda and "every country"; adjust that list on purpose if the owner changes the decision). Kenya is named only where
the thing really is Kenyan: PAYE, SHIF, NSSF, Housing Levy and NITA, the KRA/SHA/NSSF files, the P9 and the sample
payslip. The FAQ says payroll follows each employee's branch country and invites other countries to write in. The
share image (`public/og-image.jpg`) has no country line either; its source is not in the repository, so if it is
redrawn, keep it that way.

### What the page answers

A visitor wants three things: what problem this solves, what it offers, and why this one.

- **The problem** is the first sentence under the headline (`HERO.problem`), and the "What changes" section (`OUTCOMES`) turns
  four everyday problems into what changes, one line each.
- **The offer** is the rest of that paragraph, the platform tabs (`FEATURES`) and the payroll band.
- **Why this one** is the "Why Figbloom HR" section (`WHY`): things it is built around, each with its evidence, ending
  with an invitation to check them in a workspace. It never says "the best" or compares with other products by name:
  there are no customers, benchmarks or reviews to back a ranking, and `landing.test.ts` refuses superlatives. If you
  gain real proof (named customers who agree to it, a measured result, a certificate), add it as data with its source
  and the test list can be adjusted on purpose.

## Larger text

The Accessibility button sets a text size by zooming the whole page (CSS `zoom`), and the screen's media queries (`md:`,
`lg:`) do not notice: a 1280px screen at 150% text has 853px of room but still says "wide". So the parts that must not
overflow follow their own width instead, with container queries in `src/index.css`: the top bar (`.lp-bar`: full menu from
1100px, the Sign in and Create buttons from 640px, the wordmark under 340px) and the dashboard in the first screen
(`.lp-cq`). When you add a row that cannot wrap (a button, a table, a fixed-width card), check it at 150% text.

## Large screens

The content width (`Container` in `src/components/Landing/Section.tsx`) is 1240px, 1400px from 1536px of screen and
1560px from 1800px, so a 1920px monitor has about 210px of margin instead of 340px. The hero's height, its heading size
and the photos' `sizes` hints follow those widths: when you change one, change the others (a `sizes` hint that is too
small makes the browser pick a file that is too small, and the photo goes soft). Checked at 1536, 1920 and 2560px; at
2560px the margins are still about 530px each.

## Photos

Five photographs in `src/assets/landing/`, resized into small JPEGs that the build fingerprints, so they cache for good:
`hero` (a 4:5 portrait, 480, 720 and 960 pixels wide), `office` (640, 1080, 1600), `interview`, `team` and `lounge`
(640 and 1080). They are listed in `src/components/Landing/photos.ts` with their alt text and crop. The people are not
customers or staff, and the footer says so. The full-size originals are kept outside the repository
(`..\bloomHR-design-source\landing-photos`); never put them in `public/`, which is published as it is.

- `hero` and `interview` are stock photographs from Pexels, added 2026-10-28. The [Pexels licence](https://www.pexels.com/license/)
  allows free commercial use with no credit, but the people must never be shown as backing Figbloom (so: no captions, and
  the footer's "illustrative" line stays), and Pexels does not promise that releases exist for the people shown. Credits
  for the record: `hero`, Edmond Dantes (Pexels 8547399); `interview`, Tima Miroshnichenko (Pexels 5439375).
- `office` (the closing section), `team` and `lounge` are AI-generated, and the right to use them is still unconfirmed.
  `public/og-image.jpg` (the share image) also uses the AI `office` photograph.
- `hero` is the original with its top cut away. The dashboard in the first screen covers the lower part of that photo,
  so the face has to sit high in the frame; with the full picture the dashboard hid his mouth at 1440 pixels. Check any
  replacement at 320, 768, 1024 and 1440 pixels and at 150% text.
- In the hiring tab on a phone, the Recruitment card is as tall as the photo and covers almost all of it. It did so with
  the earlier photo too, and has not been changed.

## Privacy Policy and Terms

Drafts for a lawyer, in `src/lib/legal.ts`. Everything only the company knows is a `[[PLACEHOLDER]]`. The sub-processor list
and the data the policy names were re-checked against the code on 2026-10-28 (third-party hosts, environment variables,
the mailbox feature, the M-Pesa and bank payout code). Hosting in Frankfurt (Supabase eu-central-1) comes from FIG-836;
nothing in the repository sets it, nor the region of the Vercel functions. To go live: fill in
every placeholder, get them approved, set `LEGAL_REVIEWED` to `true` in `src/lib/legalGate.ts` (a test refuses `true` while
any placeholder is left), and add both pages to `public/sitemap.xml`. Until then `/privacy` and `/terms` do not exist and the
footer shows no legal links.

## Search and sharing

`index.html` is shared by every route, so it carries only what is true for all of them: a description, Open Graph tags
(`public/og-image.jpg`, 1200 by 630), structured data (Organization, WebSite and a plain SoftwareApplication, with no
ratings or prices) and a `<noscript>` summary. Its title stays the app's. The landing page sets its own title and canonical
address when it runs. `public/robots.txt` and `public/sitemap.xml` assume the host `https://hr.figbloom.org`.

## Speed

The landing page loads about 108 KB of script (gzipped), 32 KB of styles, two font families and one photograph before the
first scroll, and no app code. On a production build, on a desktop connection, the headline paints in about 0.6 s and
Largest Contentful Paint is about 0.7 s; Cumulative Layout Shift is 0.04. On a simulated mid-range phone on slow 4G (4x
slower CPU, 1.6 Mbit/s, 150 ms latency) first paint is about 0.7 s and LCP about 3.5 to 4.4 s. The biggest cost used to be
the Google Fonts stylesheet in `index.html` holding back the first paint and every script (about 2.7 s on that connection):
it is now loaded as a `media="print"` stylesheet that switches to `all` when it arrives (with a `<noscript>` fallback).
`index.html` is shared with the app, so this applies there too. Self-hosting the two fonts would remove the remaining
dependency on Google; the vendor chunk `react` still carries react-router, about 17 KB gzipped the landing page does not need.

## Checking a change

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build` (on Windows run it from a shell whose path starts with an
upper-case drive letter, `C:\`: Vite's inline-style handling fails with `c:\`). By hand, at 320, 375, 768, 1024 and 1440 pixels, and with
Accessibility set to 150% text and to Reduce motion: no sideways scrolling, nothing covering a face in a photograph,
every control reachable with the keyboard. On a preview with real settings, also sign in, sign in with two-step, use a
password reset link, accept an invitation and create a company: those flows are not exercised by the tests.
