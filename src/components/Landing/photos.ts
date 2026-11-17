import hero480 from '../../assets/landing/hero-desk-480.jpg';
import hero720 from '../../assets/landing/hero-desk-720.jpg';
import hero960 from '../../assets/landing/hero-desk-960.jpg';
import office640 from '../../assets/landing/office-laptop-640.jpg';
import office1080 from '../../assets/landing/office-laptop-1080.jpg';
import office1600 from '../../assets/landing/office-laptop-1600.jpg';
import interview640 from '../../assets/landing/interview-640.jpg';
import interview1080 from '../../assets/landing/interview-1080.jpg';
import team640 from '../../assets/landing/team-review-640.jpg';
import team1080 from '../../assets/landing/team-review-1080.jpg';
import lounge640 from '../../assets/landing/phone-lounge-640.jpg';
import lounge1080 from '../../assets/landing/phone-lounge-1080.jpg';

// The landing page's photographs. The people are not customers or staff and are never captioned as such (the footer says
// so). `hero` and `interview` are stock photographs from Pexels (free for commercial use, no credit required, but never
// to suggest the people back Figbloom; credits are in docs/LANDING_PAGE.md); `office`, `team` and `lounge` are
// AI-generated. Each is resized into small JPEGs here in src/assets so the build fingerprints them; `position` keeps the
// faces in frame when a tile crops the photo. Alt text says what is in the picture, nothing more.
//
// `hero` is a 4:5 portrait with the top of the original cut away: the dashboard in the first screen covers the lower part
// of this photo, so the face has to sit high in the frame. Its position keeps it high in the 4:3 frame on small screens.

export interface Photo {
  src: string;
  srcSet: string;
  width: number;
  height: number;
  alt: string;
  position: string;
}

export const PHOTOS = {
  hero: {
    src: hero720,
    srcSet: `${hero480} 480w, ${hero720} 720w, ${hero960} 960w`,
    width: 960,
    height: 1200,
    alt: 'A man in a peach sweater types on a laptop at a wooden desk in a bright open office.',
    position: '50% 20%',
  },
  office: {
    src: office1080,
    srcSet: `${office640} 640w, ${office1080} 1080w, ${office1600} 1600w`,
    width: 1600,
    height: 900,
    alt: 'A woman in a green blazer smiles as she works on a laptop in a bright office with plants.',
    position: '34% 30%',
  },
  interview: {
    src: interview1080,
    srcSet: `${interview640} 640w, ${interview1080} 1080w`,
    width: 1080,
    height: 720,
    alt: 'A man in glasses and a grey blazer reads a document on a clipboard across a desk from a colleague, with plants and dried pampas grass beside them.',
    position: '60% 40%',
  },
  team: {
    src: team1080,
    srcSet: `${team640} 640w, ${team1080} 1080w`,
    width: 1080,
    height: 720,
    alt: 'Three colleagues look at a laptop together at a wooden table.',
    position: '50% 34%',
  },
  lounge: {
    src: lounge1080,
    srcSet: `${lounge640} 640w, ${lounge1080} 1080w`,
    width: 1080,
    height: 720,
    alt: 'A woman in a cream blazer checks her phone in an armchair in a sunny lounge.',
    position: '40% 36%',
  },
} satisfies Record<string, Photo>;

export type PhotoKey = keyof typeof PHOTOS;
