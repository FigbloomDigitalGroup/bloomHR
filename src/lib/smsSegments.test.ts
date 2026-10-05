import { describe, expect, it } from 'vitest';
import { smsSegments } from './smsSegments';

describe('smsSegments', () => {
  it('treats an empty message as zero segments', () => {
    expect(smsSegments('')).toMatchObject({ units: 0, segments: 0, encoding: 'GSM-7', remaining: 160 });
  });

  it('fits 160 plain characters in one SMS and the 161st starts a second', () => {
    expect(smsSegments('a'.repeat(160))).toMatchObject({ units: 160, segments: 1, remaining: 0 });
    expect(smsSegments('a'.repeat(161))).toMatchObject({ units: 161, segments: 2 });
  });

  it('uses 153 per part once a message is multipart', () => {
    expect(smsSegments('a'.repeat(306)).segments).toBe(2);
    expect(smsSegments('a'.repeat(307)).segments).toBe(3);
  });

  it('counts the extended GSM-7 characters double', () => {
    // 80 euro signs = 160 slots = still one SMS; 81 spill over
    expect(smsSegments('€'.repeat(80))).toMatchObject({ characters: 80, units: 160, segments: 1, encoding: 'GSM-7' });
    expect(smsSegments('€'.repeat(81)).segments).toBe(2);
    expect(smsSegments('a{b}')).toMatchObject({ characters: 4, units: 6 });
  });

  it('switches the whole message to Unicode (70 / 67) when one character is not GSM-7', () => {
    const curly = 'Hello ' + 'a'.repeat(100) + '’s'; // right single quote
    expect(smsSegments(curly)).toMatchObject({ encoding: 'Unicode', singleLimit: 70, segments: 2 });
    expect(smsSegments('é'.repeat(70)).encoding).toBe('GSM-7'); // é is in GSM-7
    expect(smsSegments('ç'.repeat(70))).toMatchObject({ encoding: 'Unicode', segments: 1, remaining: 0 });
    expect(smsSegments('ç'.repeat(71)).segments).toBe(2);
  });

  it('counts an emoji as two Unicode slots but one visible character', () => {
    expect(smsSegments('hi 😀')).toMatchObject({ encoding: 'Unicode', characters: 4, units: 5 });
  });

  it('reports how many slots remain in the current part', () => {
    expect(smsSegments('a'.repeat(100)).remaining).toBe(60);
    expect(smsSegments('a'.repeat(200)).remaining).toBe(306 - 200);
  });
});
