/**
 * The line at the top of the home screen. It names the person when the app
 * knows who they are, because "Good morning" alone tells a returning user
 * nothing about whose account they just unlocked.
 */
export function greetingFor(name: string | undefined, at: Date = new Date()): string {
  const hour = at.getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}
