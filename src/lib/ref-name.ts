/**
 * Reference upload file names: letters, digits, dot, dash and underscore, starting with a letter or digit. The upload
 * route issues a token only for such a name under the uploader's refs/<id>/, and the cleanup deletes only such names,
 * so no spelling of a path (percent escapes, dot segments, slashes, fullwidth dots) can reach another member's files.
 * The browser imports this module too, so it must stay free of server-only imports.
 */
export const REF_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/** A name REF_NAME accepts, whatever the file is called: upload time, a random tag, and the file's plain extension. */
export function refUploadName(fileName: string, now = Date.now()): string {
  const ext = /\.[a-z0-9]{1,8}$/.exec(fileName.toLowerCase())?.[0] ?? "";
  return `${now}-${crypto.randomUUID().slice(0, 8)}${ext}`;
}
