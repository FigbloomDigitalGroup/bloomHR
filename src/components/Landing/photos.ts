import office640 from '../../assets/landing/office-laptop-640.jpg';
import office1080 from '../../assets/landing/office-laptop-1080.jpg';
import office1600 from '../../assets/landing/office-laptop-1600.jpg';
import interview640 from '../../assets/landing/interview-640.jpg';
import interview1080 from '../../assets/landing/interview-1080.jpg';
import team640 from '../../assets/landing/team-review-640.jpg';
import team1080 from '../../assets/landing/team-review-1080.jpg';
import lounge640 from '../../assets/landing/phone-lounge-640.jpg';
import lounge1080 from '../../assets/landing/phone-lounge-1080.jpg';

// The landing page's photographs. They are illustrations: the people are not customers or staff and are never captioned
// as such (the footer says so). Each is resized into small JPEGs here in src/assets so the build fingerprints them;
// `position` keeps the faces in frame when a tile crops the photo. Alt text says what is in the picture, nothing more.

export interface Photo {
  src: string;
  srcSet: string;
  width: number;
  height: number;
  alt: string;
  position: string;
}

export const PHOTOS = {
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
    alt: 'A man in glasses talks with a colleague across a desk, with a city skyline behind them.',
    position: '36% 38%',
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
