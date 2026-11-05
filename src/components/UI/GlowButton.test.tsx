import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import GlowButton from './GlowButton';

afterEach(cleanup);

// The theme's text greys (text-gray-*, text-black) come earlier in the generated CSS than text-primary-foreground,
// so a text colour passed in className used to lose to the variant's: white text on a white button.
describe('GlowButton', () => {
  it("lets className's colours replace the variant's", () => {
    render(<GlowButton className="bg-white text-gray-800 border-gray-300">View / print ID card</GlowButton>);
    const classes = screen.getByRole('button').className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['bg-white', 'text-gray-800', 'border-gray-300']));
    expect(classes).not.toContain('text-primary-foreground');
    expect(classes).not.toContain('bg-primary');
    expect(classes).not.toContain('border-primary/80');
  });

  it('keeps the variant colours when className sets none', () => {
    render(<GlowButton variant="secondary" className="mr-2">Cancel</GlowButton>);
    const classes = screen.getByRole('button').className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['bg-white', 'text-gray-700', 'mr-2']));
  });
});
