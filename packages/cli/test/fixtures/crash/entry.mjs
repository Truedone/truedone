// A --run that is killed mid-way (cli-crash.test.mjs): node entry.mjs <repo> runs the CLI's --run there with a
// red-green stand-in that swaps src/add.mjs to its base bytes the way RUN-02 does (record first, then swap), prints
// SWAPPED, and then waits, with a timer keeping the process alive, so the test can kill it while the tree is swapped.
import { run, swapLikeRun02 } from '../../lib/run-fakes.mjs';

const root = process.argv[2];
const r = await run(['--run'], {
  cwd: root,
  redGreen: async () => {
    swapLikeRun02(root, { 'src/add.mjs': 'export const add = (a, b) => a - b;\n' });
    process.stdout.write('SWAPPED\n');
    await new Promise(() => { setInterval(() => {}, 1000); });   // killed here
  },
});
process.stdout.write(`EXITED ${r.code} ${r.err}\n`);
