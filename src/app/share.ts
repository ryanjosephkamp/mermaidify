/**
 * Mermaid code carried in a web address, so a page can show the diagram from its address alone: squeezed with deflate
 * where the browser can, and written in base64url. The first letter says which: "z" squeezed, "t" as typed.
 */
function toBase64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const through = (bytes: Uint8Array, stream: CompressionStream | DecompressionStream) => new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));

export async function pack(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(code);
  if (typeof CompressionStream !== "function") return "t" + toBase64url(bytes);
  return "z" + toBase64url(new Uint8Array(await through(bytes, new CompressionStream("deflate-raw")).arrayBuffer()));
}

/** The code `pack` carried, or an error when the text is not one it made. */
export async function unpack(text: string): Promise<string> {
  const bytes = fromBase64url(text.slice(1));
  if (text[0] === "t") return new TextDecoder().decode(bytes);
  if (text[0] === "z") return through(bytes, new DecompressionStream("deflate-raw")).text();
  throw new Error("Not a packed diagram");
}
