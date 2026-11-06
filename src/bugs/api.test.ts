import { describe, expect, it } from 'vitest';
import { isAdminPath, keyFromLocation } from './api';

describe('admin link', () => {
  it('reads the key from the fragment or the query', () => {
    expect(keyFromLocation({ hash: '#key=abc', search: '' })).toBe('abc');
    expect(keyFromLocation({ hash: '', search: '?key=xyz' })).toBe('xyz');
    expect(keyFromLocation({ hash: '#key=frag', search: '?key=query' })).toBe('frag');
    expect(keyFromLocation({ hash: '', search: '' })).toBeNull();
    expect(keyFromLocation({ hash: '#other=1', search: '?key=' })).toBeNull();
  });

  it('only /bugs/admin is the admin page', () => {
    expect(isAdminPath('/bugs/admin')).toBe(true);
    expect(isAdminPath('/bugs/admin/')).toBe(true);
    expect(isAdminPath('/')).toBe(false);
    expect(isAdminPath('/bugs/administrator')).toBe(false);
  });
});
