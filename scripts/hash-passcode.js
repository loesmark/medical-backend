/**
 * scripts/hash-passcode.js
 * Prompts for the secondary backup passcode, hashes it with bcrypt,
 * and prints the hash to put in `.env` as ADMIN_BACKUP_PASSCODE_HASH.
 *
 * Usage:  npm run hash:passcode
 */

const bcrypt = require('bcryptjs');
const readline = require('readline');

const rounds = Number(process.env.BCRYPT_SALT_ROUNDS || 10);

function prompt(query, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    if (hidden) {
      // Mask input
      rl._writeToOutput = (str) => {
        if (str === '\r\n' || str === '\n') process.stdout.write('\n');
        else if (str) process.stdout.write('*');
      };
    }
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const passcode = await prompt('Enter backup passcode (min 8 chars): ', true);
  if (!passcode || passcode.length < 8) {
    console.error('\n❌ Passcode must be at least 8 characters.');
    process.exit(1);
  }
  const confirm = await prompt('Re-enter passcode: ', true);
  if (passcode !== confirm) {
    console.error('\n❌ Passcodes do not match.');
    process.exit(1);
  }
  const hash = bcrypt.hashSync(passcode, rounds);
  console.log('\n✅ Passcode verified. Put this in your .env:\n');
  console.log(`ADMIN_BACKUP_PASSCODE_HASH=${hash}\n`);
  console.log('Keep the plaintext passcode secret — only the HASH lives on the server.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
