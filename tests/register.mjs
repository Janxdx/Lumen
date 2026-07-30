/* Module hooks have to live in their own file — Node loads them on a
   separate thread — so this is the shim `npm test` passes to `--import`. */
import { register } from 'node:module';

register('./ts-resolve.mjs', import.meta.url);
