// A minimal zip reader in Web APIs only (APP-12): the central directory gives
// each entry's offsets and method; stored entries are sliced, deflate entries
// are inflated with DecompressionStream('deflate-raw'). S6's cap is enforced
// by the caller before this runs.
export async function unzip(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip: no end of central directory");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("not a zip: bad central directory");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({ name, method, start: dataStart, size: compressedSize });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  const out = [];
  for (const entry of entries) {
    const compressed = bytes.subarray(entry.start, entry.start + entry.size);
    let data;
    if (entry.method === 0) {
      data = compressed.slice();
    } else if (entry.method === 8) {
      data = await inflateRaw(compressed);
    } else {
      throw new Error(`zip method ${entry.method} is not supported`);
    }
    out.push({ name: entry.name, data });
  }
  return { entries: out };
}

async function inflateRaw(compressed) {
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
