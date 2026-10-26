// Writes tone-125s.wav: 125 s of a 440 Hz tone, 48 kHz mono 16-bit, for the fake microphone
// (Chromium's --use-file-for-fake-audio-capture). Run: node tests/e2e/fixtures/make-tone.cjs
const fs = require("node:fs");
const path = require("node:path");

const rate = 48000;
const seconds = 125;
const samples = rate * seconds;
const data = Buffer.alloc(samples * 2);
for (let i = 0; i < samples; i++) {
  data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 0.3 * 32767), i * 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(rate, 24);
header.writeUInt32LE(rate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);
fs.writeFileSync(path.join(__dirname, "tone-125s.wav"), Buffer.concat([header, data]));
