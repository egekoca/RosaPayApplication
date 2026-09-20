import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {AppState, type AppStateStatus} from 'react-native';
import {appIsPresent, useAppPresence} from '../src/shared/appPresence';

function Harness({onChange}: {onChange(present: boolean): void}) {
  onChange(useAppPresence());
  return null;
}

describe('whether the app has actually gone away', () => {
  it('does not count system UI over the app as gone', () => {
    // iOS reports `inactive` for the Core NFC reader sheet, a permission alert,
    // a biometric prompt, Control Centre and the app switcher. Reading that as
    // gone is what made pressing "pay by tapping" open a sheet that closed
    // itself about a second later: presenting the sheet resigned the app
    // active, and the reader was torn down in response to its own success.
    expect(appIsPresent('inactive')).toBe(true);
    expect(appIsPresent('active')).toBe(true);
    expect(appIsPresent('background')).toBe(false);
  });

  it('keeps a listener armed across a system sheet and drops it on background', () => {
    const seen: boolean[] = [];
    let emit!: (state: AppStateStatus) => void;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      emit = listener as (state: AppStateStatus) => void;
      return {remove: jest.fn()} as never;
    });

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<Harness onChange={value => seen.push(value)} />);
    });
    expect(seen.at(-1)).toBe(true);

    ReactTestRenderer.act(() => emit('inactive'));
    expect(seen.at(-1)).toBe(true);

    ReactTestRenderer.act(() => emit('background'));
    expect(seen.at(-1)).toBe(false);

    ReactTestRenderer.act(() => emit('active'));
    expect(seen.at(-1)).toBe(true);

    ReactTestRenderer.act(() => renderer.unmount());
    jest.restoreAllMocks();
  });
});
