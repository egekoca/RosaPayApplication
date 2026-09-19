import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {CurrencyPicker} from '../src/features/home/CurrencyPicker';
import {DISPLAY_CURRENCIES} from '../src/shared/priceSource';

jest.mock('../src/shared/RosaMark', () => ({RosaMark: () => null}));

const active: ReactTestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  ReactTestRenderer.act(() => {
    active.splice(0).forEach(renderer => renderer.unmount());
  });
});

async function render(props: Partial<React.ComponentProps<typeof CurrencyPicker>> = {}) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <CurrencyPicker onClose={jest.fn()} onSelect={jest.fn()} selected="TRY" visible {...props} />,
    );
  });
  active.push(renderer);
  return renderer;
}

describe('which currencies a balance can be read in', () => {
  it('offers every currency the product supports, with its flag', async () => {
    const tree = JSON.stringify((await render()).toJSON());

    /*
     * All of them, always. Filtering to what a rate server happens to be
     * answering this minute made the list flicker between four entries and two
     * and read as though currencies had been taken away. A rate that is
     * missing right now is the card's problem to state, not a reason to remove
     * the currency from the product.
     */
    for (const currency of DISPLAY_CURRENCIES) {
      expect(tree).toContain(currency.code);
      expect(tree).toContain(currency.name);
      expect(tree).toContain(currency.flag);
    }
  });

  it('marks the one currently chosen', async () => {
    const renderer = await render({selected: 'NGN'});

    const option = renderer.root.findByProps({testID: 'currency-picker-option-NGN'});
    expect(option.props.accessibilityState).toEqual({selected: true});
  });

  it('passes the chosen code back and closes', async () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    const renderer = await render({onSelect, onClose});

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({testID: 'currency-picker-option-EUR'}).props.onPress();
    });

    expect(onSelect).toHaveBeenCalledWith('EUR');
    expect(onClose).toHaveBeenCalled();
  });

  it('changes nothing when the scrim is tapped', async () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    const renderer = await render({onSelect, onClose});

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({testID: 'currency-picker-scrim'}).props.onPress();
    });

    // Half of what a person means by "it should not change unless I change it".
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
