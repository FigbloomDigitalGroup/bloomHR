import { BUILT_IN } from '../../lib/landing';
import { Container } from './Section';
import { Eyebrow } from './previews/parts';

// A ruled strip of things a visitor can check for themselves. There are no customer logos and no figures on this page,
// so this is where credibility comes from: what the product does, said plainly.

export default function BuiltIn() {
  return (
    <section aria-label="What is built in" className="border-y border-border bg-white">
      <Container>
        <ul className="m-0 grid list-none grid-cols-2 gap-px bg-border p-0 md:grid-cols-4 [&>li]:bg-white" data-reveal>
          {BUILT_IN.map((item) => (
            <li key={item.label} className="px-4 py-6 sm:px-5">
              <Eyebrow className="text-brand">{item.label}</Eyebrow>
              <p className="m-0 mt-2.5 text-[14.5px] leading-snug text-ink">{item.fact.text}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
