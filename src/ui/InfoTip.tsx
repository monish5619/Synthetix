import { Icon } from './icons';
import { Tooltip } from './Tooltip';

/**
 * The ⓘ for secondary explanations: short, one tooltip, reachable by keyboard.
 * `about` names what it explains, so the button has a real accessible name.
 */
export function InfoTip({ about, text, side = 'top' }: { about: string; text: string; side?: 'right' | 'bottom' | 'bottom-end' | 'top' }) {
  return (
    <Tooltip label={text} side={side}>
      <button type="button" className="info-tip" aria-label={`About ${about}`}>
        <Icon name="info" size={15} />
      </button>
    </Tooltip>
  );
}
