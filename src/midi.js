// Web MIDI glue: connect to whatever controllers are plugged in and report control-change messages.
// Nothing leaves the browser; Chrome asks permission the first time.
export const midiSupported = () => typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';

export async function connectMidi({ onCC, onDevices }) {
  const access = await navigator.requestMIDIAccess({ sysex: false });
  const attach = () => {
    const names = [];
    for (const input of access.inputs.values()) {
      names.push(input.name || 'MIDI device');
      input.onmidimessage = (e) => {
        const [status, data1, data2] = e.data;
        if ((status & 0xf0) === 0xb0) onCC({ channel: status & 0x0f, cc: data1, value: data2, device: input.name || '' });
      };
    }
    onDevices(names);
  };
  access.onstatechange = attach;
  attach();
  return { close() { access.onstatechange = null; for (const i of access.inputs.values()) i.onmidimessage = null; } };
}
