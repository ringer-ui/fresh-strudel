// The local app has features that must never reach the public site or the public source (they talk to programs on this
// machine). Those parts are fenced with @local-start / @local-end in any comment syntax; this removes the fenced lines.
export function stripLocal(text) {
  const out = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (line.includes('@local-start')) { inside = true; continue; }
    if (line.includes('@local-end')) { if (!inside) throw new Error('@local-end without @local-start'); inside = false; continue; }
    if (!inside) out.push(line);
  }
  if (inside) throw new Error('@local-start without @local-end');
  return out.join('\n');
}
