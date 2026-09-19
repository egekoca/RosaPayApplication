import {DISPLAY_CURRENCIES} from '../../shared/priceSource';
import {OptionSheet} from '../../shared/OptionSheet';
import {useTranslate} from '../../shared/i18n';

/**
 * Choosing the money a balance is read in.
 *
 * The sheet itself is `OptionSheet`, which the merchant's pricing control also
 * uses: the two were the same modal drawn twice, and the merchant's needed to
 * carry assets as well as currencies. This is now only the list — which
 * currencies, and what they are called.
 */
export function CurrencyPicker({
  onClose,
  onSelect,
  selected,
  visible,
}: {
  onClose(): void;
  onSelect(code: string): void;
  selected: string;
  visible: boolean;
}) {
  const t = useTranslate();
  return (
    <OptionSheet
      onClose={onClose}
      onSelect={onSelect}
      /*
       * Every currency the product supports, whether or not a rate happens to
       * be available this minute. Hiding the ones a throttled feed cannot price
       * was the wrong place to be honest: it made the list flicker between four
       * entries and two, and told someone their currency had been removed. The
       * card is where a missing rate belongs, and it has a state for one.
       */
      options={DISPLAY_CURRENCIES.map(currency => ({
        value: currency.code,
        label: currency.code,
        detail: currency.name,
        glyph: currency.flag,
      }))}
      selected={selected}
      testIDPrefix="currency-picker"
      title={t('Show balance in')}
      visible={visible}
    />
  );
}
