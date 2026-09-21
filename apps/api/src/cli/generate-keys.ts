import { generateKeyPairSync, randomBytes } from 'node:crypto';

/**
 * Prints the secrets a production deployment needs.
 *
 * Run with: pnpm --filter @bolsa/api keys:generate
 *
 * The voucher signing pair is Ed25519 (spec 10.3). The private key never
 * leaves the server; the public one goes to the staff app so a forged QR can be
 * rejected before it reaches the API. Losing the private key invalidates every
 * voucher already issued, so it belongs in the deployment's secret store and
 * not in a chat message.
 */
const pair = generateKeyPairSync('ed25519');

const privateKey = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const sessionSecret = randomBytes(48).toString('base64');

console.log('');
console.log('Copie para o .env do servidor:');
console.log('');
console.log(`SESSION_SECRET=${sessionSecret}`);
console.log(`VOUCHER_SIGNING_PRIVATE_KEY=${privateKey}`);
console.log(`VOUCHER_SIGNING_PUBLIC_KEY=${publicKey}`);
console.log('');
console.log('A chave privada assina os vouchers. Se a perder, todos os vouchers');
console.log('ja emitidos deixam de ser validos; se a partilhar, qualquer pessoa');
console.log('consegue fabricar um.');
console.log('');
