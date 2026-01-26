// services/avatarService.ts
export class AvatarService {
  // All available DiceBear avatar styles
  private static readonly avatarOptions = [
    'adventurer', 'adventurer-neutral', 'avataaars', 'big-ears', 'big-ears-neutral',
    'big-smile', 'bottts', 'croodles', 'croodles-neutral', 'fun-emoji',
    'icons', 'identicon', 'initials', 'lorelei', 'lorelei-neutral',
    'micah', 'miniavs', 'open-peeps', 'personas', 'pixel-art',
    'pixel-art-neutral', 'shapes'
  ];

  private static readonly diceBearUrl = 'https://api.dicebear.com/7.x';

  /**
   * Generate a random avatar URL
   */
  static generateAvatar(seed: string, style: string = 'adventurer'): string {
    const validStyle = this.avatarOptions.includes(style) ? style : 'adventurer';
    return `${this.diceBearUrl}/${validStyle}/svg?seed=${encodeURIComponent(seed)}`;
  }

  /**
   * Get a random avatar style
   */
  static getRandomStyle(): string {
    return this.avatarOptions[Math.floor(Math.random() * this.avatarOptions.length)];
  }

  /**
   * Get all available avatar styles
   */
  static getAvatarStyles(): string[] {
    return [...this.avatarOptions];
  }

  /**
   * Generate avatar with custom options
   */
  static generateCustomAvatar(seed: string, options: {
    style?: string;
    backgroundColor?: string;
    radius?: number;
    size?: number;
  } = {}): string {
    const {
      style = 'adventurer',
      backgroundColor,
      radius = 0,
      size = 100
    } = options;

    const validStyle = this.avatarOptions.includes(style) ? style : 'adventurer';
    let url = `${this.diceBearUrl}/${validStyle}/svg?seed=${encodeURIComponent(seed)}&size=${size}`;

    if (backgroundColor) {
      url += `&backgroundColor=${backgroundColor}`;
    }
    if (radius > 0) {
      url += `&radius=${radius}`;
    }

    return url;
  }
}