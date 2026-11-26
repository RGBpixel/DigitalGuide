import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export async function fileDigest(file: string,signal?: AbortSignal) { const hash = createHash('sha256');let size = 0;for await (const buffer of fs.createReadStream(file,{ signal })) { hash.update(buffer);size += buffer.length; }return { sha256: hash.digest('hex'),size }; }
export function ownedFile(directory: string,key: string) { if (path.basename(key) !== key) throw new Error('Unexpected storage key');const file = path.resolve(directory,key);if (!file.startsWith(path.resolve(directory)+path.sep)) throw new Error('Unexpected storage location');return file; }
