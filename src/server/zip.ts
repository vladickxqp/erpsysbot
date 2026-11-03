/**
 * A ZIP archive written as a stream (stored, not compressed): entries go out
 * one after the other with a data descriptor, so a large video never has to
 * sit in memory whole. Enough for exports; no ZIP64 (entries and archive
 * below 4 GB).
 */
import { createReadStream } from "node:fs";

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, previous = 0): number {
  let c = ~previous >>> 0;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

export type ZipEntry = { name: string; data: Uint8Array | string } | { name: string; file: string };

function dosTime(at: Date): { time: number; date: number } {
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2),
    date: ((Math.max(1980, at.getFullYear()) - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

/** The archive of `entries`, produced while it is read. */
export function zipStream(entries: Iterable<ZipEntry> | AsyncIterable<ZipEntry>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const central: Uint8Array[] = [];
  let offset = 0;
  let count = 0;
  const { time, date } = dosTime(new Date());

  async function* produce(): AsyncGenerator<Uint8Array> {
    for await (const entry of entries) {
      const name = encoder.encode(entry.name);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0808, true); // data descriptor follows; names are UTF-8
      local.setUint16(8, 0, true); // stored
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint16(26, name.length, true);
      yield new Uint8Array(local.buffer);
      yield name;

      let crc = 0;
      let size = 0;
      if ("file" in entry) {
        for await (const chunk of createReadStream(entry.file)) {
          const bytes = chunk as Buffer;
          crc = crc32(bytes, crc);
          size += bytes.length;
          yield new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
        }
      } else {
        const bytes = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
        crc = crc32(bytes);
        size = bytes.length;
        yield bytes;
      }

      const descriptor = new DataView(new ArrayBuffer(16));
      descriptor.setUint32(0, 0x08074b50, true);
      descriptor.setUint32(4, crc, true);
      descriptor.setUint32(8, size, true);
      descriptor.setUint32(12, size, true);
      yield new Uint8Array(descriptor.buffer);

      const header = new DataView(new ArrayBuffer(46));
      header.setUint32(0, 0x02014b50, true);
      header.setUint16(4, 20, true);
      header.setUint16(6, 20, true);
      header.setUint16(8, 0x0808, true);
      header.setUint16(12, time, true);
      header.setUint16(14, date, true);
      header.setUint32(16, crc, true);
      header.setUint32(20, size, true);
      header.setUint32(24, size, true);
      header.setUint16(28, name.length, true);
      header.setUint32(42, offset, true);
      central.push(new Uint8Array(header.buffer), name);
      offset += 30 + name.length + size + 16;
      count++;
    }
    let length = 0;
    for (const part of central) {
      length += part.length;
      yield part;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, count, true);
    end.setUint16(10, count, true);
    end.setUint32(12, length, true);
    end.setUint32(16, offset, true);
    yield new Uint8Array(end.buffer);
  }

  const parts = produce();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await parts.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    async cancel() {
      await parts.return(undefined);
    },
  });
}
