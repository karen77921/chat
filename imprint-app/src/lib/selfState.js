const SELF_STATE = /^\s*\[\[自我状态[：:]?\]\]([\s\S]*?)\[\[\/自我状态\]\]/;

/**
 * Split the deliberately public self-description from the spoken reply.
 * This is display metadata authored for the user, not hidden model reasoning.
 */
export function splitSelfState(text) {
  const raw = String(text || '');
  const match = raw.match(SELF_STATE);
  if (!match) return { state: '', body: raw };
  return {
    state: match[1].trim(),
    body: raw.slice(match[0].length).replace(/^\s*[—-]{2,}\s*/, '').trim(),
  };
}
