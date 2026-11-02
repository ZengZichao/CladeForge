// Time-unit formatting for the UI, canvas and exports.
//
// Ma/ka/Ga are points in time ("years ago"); Myr/kyr/Gyr are durations. The
// catalogue holds the localised explanations; these helpers keep the formal
// symbol (never the raw lower-case enum) in compact positions such as ticks,
// scale bars and number-field chips.

import { S } from './strings';

export function timeUnitSymbol(unit: string | undefined): string {
  switch ((unit ?? 'Ma').trim().toLowerCase()) {
    case 'ma':
    case 'mya':
      return 'Ma';
    case 'ka':
    case 'kya':
      return 'ka';
    case 'ga':
    case 'gya':
      return 'Ga';
    case 'myr':
      return 'Myr';
    case 'kyr':
      return 'kyr';
    case 'gyr':
      return 'Gyr';
    case 'yr':
      return 'yr';
    default:
      return unit ?? 'Ma';
  }
}

export function timeUnitLabel(unit: string | undefined): string {
  switch ((unit ?? 'Ma').trim().toLowerCase()) {
    case 'ma':
    case 'mya':
      return S.layoutPanel.timeUnitMa;
    case 'ka':
    case 'kya':
      return S.layoutPanel.timeUnitKa;
    case 'ga':
    case 'gya':
      return S.layoutPanel.timeUnitGa;
    case 'myr':
      return S.layoutPanel.timeUnitMyr;
    case 'kyr':
      return S.layoutPanel.timeUnitKyr;
    case 'gyr':
      return S.layoutPanel.timeUnitGyr;
    case 'yr':
      return S.layoutPanel.timeUnitYr;
    default:
      return unit ?? 'Ma';
  }
}
