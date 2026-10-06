import { describe, expect, it } from 'vitest';
import { chatDisplayName, directMessageId, initialsOf, isDirectMessageId, realChannelId } from './names';

describe('chatDisplayName', () => {
  it('prefers the employee record', () => {
    expect(chatDisplayName({ firstName: 'Michael', lastName: 'Kiruti', metadata: { full_name: 'Other' }, email: 'm@x.co' })).toBe('Michael Kiruti');
  });

  it('then the name given when joining', () => {
    expect(chatDisplayName({ metadata: { full_name: 'Jane Doe' }, email: 'jane@x.co' })).toBe('Jane Doe');
    expect(chatDisplayName({ metadata: { name: 'Jane' }, email: 'jane@x.co' })).toBe('Jane');
  });

  it('then the start of the email: an administrator with no employee record is not "User"', () => {
    expect(chatDisplayName({ firstName: '', lastName: null, metadata: {}, email: 'mikekirutic@gmail.com' })).toBe('mikekirutic');
  });

  it('never returns an empty name', () => {
    expect(chatDisplayName({})).toBe('Someone');
  });
});

describe('initialsOf', () => {
  it('takes the first and last initial', () => {
    expect(initialsOf('Mike Kiruti')).toBe('MK');
    expect(initialsOf('Mary Jane Watson')).toBe('MW');
    expect(initialsOf('mikekirutic')).toBe('M');
    expect(initialsOf('first.last')).toBe('FL');
    expect(initialsOf('')).toBe('U');
  });
});

describe('direct message ids', () => {
  it('maps between the chat id and the stored conversation id', () => {
    const uuid = 'cbca2c50-5489-47ab-ae32-4b6bb93cd58c';
    expect(directMessageId(uuid)).toBe(`dm-${uuid}`);
    expect(isDirectMessageId(`dm-${uuid}`)).toBe(true);
    expect(isDirectMessageId(uuid)).toBe(false);
    expect(realChannelId(`dm-${uuid}`)).toBe(uuid);
    expect(realChannelId(uuid)).toBe(uuid); // an ordinary channel id is untouched
  });
});
