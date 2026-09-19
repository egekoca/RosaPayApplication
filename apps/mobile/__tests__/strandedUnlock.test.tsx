import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

const mockUnlock = jest.fn();
jest.mock('../src/features/onboarding/deviceUnlock', () => ({
  unlockWithDevice: (...args: unknown[]) => mockUnlock(...args),
}));
jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');
  const {View} = require('react-native');
  const insets = {top: 0, right: 0, bottom: 0, left: 0};
  return {
    initialWindowMetrics: null,
    SafeAreaInsetsContext: ReactModule.createContext(insets),
    SafeAreaProvider: ({children}: {children: React.ReactNode}) => ReactModule.createElement(View, null, children),
    SafeAreaView: ({children}: {children: React.ReactNode}) => ReactModule.createElement(View, null, children),
    useSafeAreaInsets: () => insets,
  };
});

import {UnlockScreen} from '../src/features/onboarding/UnlockScreen';
import {useAppStore} from '../src/state/appStore';

const initial = useAppStore.getState();

async function render() {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<UnlockScreen />);
  });
  return renderer!;
}

describe('when the payment key is gone for good', () => {
  beforeEach(() => {
    useAppStore.setState({...initial, account: {name: 'Ege', createdAt: '2026-01-01T00:00:00.000Z'}, locked: true});
    mockUnlock.mockReset();
  });

  it('offers a way forward instead of a button that can only fail again', async () => {
    // Android destroys a key bound to the screen lock when that lock changes.
    mockUnlock.mockResolvedValue({
      ok: false,
      reason: 'no-key',
      message: 'Changing this phone’s screen lock destroyed the payment key',
    });

    const renderer = await render();
    const tree = JSON.stringify(renderer.toJSON());

    expect(tree).toContain('Set up this device again');
    expect(tree).toContain('screen lock destroyed the payment key');
    expect(tree).toContain('the old account cannot be recovered');
    // Retrying an unlock against a key that no longer exists is the dead end
    // this screen used to strand people in.
    expect(tree).not.toContain('Try again');
  });

  it('takes one tap to start over, because there is nothing left to protect', async () => {
    mockUnlock.mockResolvedValue({ok: false, reason: 'no-key', message: 'This device has no payment key yet'});

    const renderer = await render();
    const again = renderer.root.findByProps({testID: 'set-up-again'});
    await ReactTestRenderer.act(async () => {
      again.props.onPress();
    });

    expect(useAppStore.getState().account).toBeNull();
  });

  it('still offers a retry when the owner merely refused the prompt', async () => {
    mockUnlock.mockResolvedValue({ok: false, reason: 'refused', message: 'Unlock was cancelled'});

    const renderer = await render();
    const tree = JSON.stringify(renderer.toJSON());

    expect(tree).toContain('Try again');
    expect(tree).not.toContain('Set up this device again');
  });
});
