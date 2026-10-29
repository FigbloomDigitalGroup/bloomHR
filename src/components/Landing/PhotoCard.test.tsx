import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import PhotoCard from './PhotoCard';
import { PHOTOS } from './photos';

afterEach(cleanup);

describe('a photograph with a card over it', () => {
  it('describes what is in the picture, and gives its size so the page does not jump when it loads', () => {
    render(<PhotoCard photo="team" sizes="100vw" />);
    const img = screen.getByRole('img', { name: PHOTOS.team.alt });
    expect(img.getAttribute('width')).toBe(String(PHOTOS.team.width));
    expect(img.getAttribute('height')).toBe(String(PHOTOS.team.height));
    expect(img.getAttribute('loading')).toBe('lazy');
  });

  it('loads the first one at once, and the rest as they come near', () => {
    render(<PhotoCard photo="office" eager sizes="100vw" />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.getAttribute('fetchpriority')).toBe('high');
  });

  it('is skipped by a screen reader when the same photograph was already described higher up the page', () => {
    const { container } = render(<PhotoCard photo="office" repeat sizes="100vw" />);
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
  });

  it('keeps its place and shows the brand mark when the picture cannot load', () => {
    const { container } = render(
      <PhotoCard photo="lounge" sizes="100vw">
        <span>a card over it</span>
      </PhotoCard>
    );
    fireEvent.error(screen.getByRole('img'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('figure svg')).toBeTruthy();
    // the frame and what floats over it stay
    expect(container.querySelector('figure')?.style.aspectRatio).toBe(`${PHOTOS.lounge.width} / ${PHOTOS.lounge.height}`);
    expect(screen.getByText('a card over it')).toBeTruthy();
  });
});
