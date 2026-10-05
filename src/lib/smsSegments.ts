/**
 * How many SMS segments (and therefore how much billing) a message uses.
 *
 * A message made only of GSM-7 characters holds 160 characters in one SMS, or 153 per part when it needs more
 * than one. A handful of GSM-7 characters (^ { } \ [ ] ~ | and the euro sign) take two character slots. If the
 * text has any other character (curly quotes, emoji, accented letters outside GSM-7...) the whole message is sent
 * as Unicode (UCS-2): 70 characters in one SMS, or 67 per part.
 */

const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '^{}\\[~]|€\f';

const basic = new Set(GSM7_BASIC);
const extended = new Set(GSM7_EXTENDED);

export interface SmsSegmentInfo {
  /** Characters the user sees (code points). */
  characters: number;
  /** Character slots used: extended GSM-7 characters count double. Equals `characters` for Unicode. */
  units: number;
  encoding: 'GSM-7' | 'Unicode';
  /** Capacity of a single-part SMS in this encoding (160 or 70). */
  singleLimit: number;
  /** Number of SMS parts that will be billed (0 for an empty message). */
  segments: number;
  /** Slots left in the current part. */
  remaining: number;
}

export function smsSegments(text: string): SmsSegmentInfo {
  const chars = Array.from(text);
  let gsm = true;
  let gsmUnits = 0;
  for (const ch of chars) {
    if (basic.has(ch)) gsmUnits += 1;
    else if (extended.has(ch)) gsmUnits += 2;
    else {
      gsm = false;
      break;
    }
  }

  const encoding = gsm ? 'GSM-7' : 'Unicode';
  // UCS-2 counts UTF-16 code units, so an emoji (a surrogate pair) takes two slots
  const units = gsm ? gsmUnits : text.length;
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;

  const segments = units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / multi);
  const capacity = segments <= 1 ? single : segments * multi;

  return {
    characters: chars.length,
    units,
    encoding,
    singleLimit: single,
    segments,
    remaining: units === 0 ? single : capacity - units,
  };
}
