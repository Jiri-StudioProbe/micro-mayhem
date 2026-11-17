// What the players screens say (M3.1b). Pure: characters in, words out. (The DOM is src/ui/playersui.js.)
// Every name came from storage or from a text box, so these strings are only ever shown with textContent.
import { isPristine, MAX_CHARACTERS } from '../household.js';
import { LEVELS, isLevel } from '../levels.js';

const DOT = ' · ';
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

// The start screen's button: who is playing, and that it can be changed. A new device's unused Player asks for a name instead.
export const describeWho = c => (isPristine(c) ? 'WHO ARE YOU? SET YOUR NAME' : 'PLAYING AS ' + c.name.toUpperCase() + DOT + 'CHANGE');

// The list of the household: [{ id, name, sub, current }], in household order.
export function describePlayers(characters, currentId) {
  return characters.map(c => ({
    id: c.id, name: c.name, current: c.id === currentId,
    sub: (isLevel(c.level) ? LEVELS[c.level].label.toUpperCase() : String(c.level).toUpperCase()) + DOT + plural(c.races.length, 'RACE', 'RACES')
  }));
}

// One line for each way adding or renaming can be refused (the codes are household.js's).
export const describeError = code => ({
  name: 'Type a name first.',
  taken: 'Someone in your household already has that name.',
  full: 'A household holds up to ' + MAX_CHARACTERS + ' players.',
  last: 'The last player cannot be deleted: there has to be someone to play as.',
  unknown: 'That player is no longer here.'
}[code] || 'That did not work.');

// The screen for one player: a new one, or an existing one (renaming and deleting).
export function describePlayer(c, count) {
  if (!c) return { kick: 'Your household', title: 'New player', save: 'ADD PLAYER', canDelete: false, note: 'Use a nickname, not a real name. It is shown on the results and the records, and is kept with your household.' };
  return {
    kick: 'Player', title: c.name, save: 'SAVE NAME', canDelete: count > 1,
    note: count <= 1 ? describeError('last') : c.races.length ? 'Deleting a player also deletes their ' + plural(c.races.length, 'race', 'races') + '. This cannot be undone.' : 'This player has no races yet. Deleting cannot be undone.'
  };
}
