// ORG-01: the repository moved to the Truedone organisation (D36), so GitHub's merge commits read "Merge pull request #n
// from Truedone/<branch>" from then on, while the history before the move reads "from mgillr/<branch>". The README status
// lands a task from either owner's merge commit, and from no other owner's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landed } from '../readme-status.mjs';

const IDS = ['ORG-01', 'REPO-01', 'APP-17', 'WEB-01'];

test('a merge commit from Truedone/<id> lands its task', () => {
  assert.deepEqual([...landed(['Merge pull request #120 from Truedone/org-01'], IDS)], ['ORG-01']);
});

test('a merge commit from mgillr/<id>, made before the move, still lands its task', () => {
  assert.deepEqual([...landed(['Merge pull request #20 from mgillr/repo-01'], IDS)], ['REPO-01']);
});

test('history from both owners lands every task it names', () => {
  const on = landed(['Merge pull request #20 from mgillr/repo-01', 'Merge pull request #121 from Truedone/app-17', 'WEB-01: the site'], IDS);
  assert.deepEqual([...on].sort(), ['APP-17', 'REPO-01', 'WEB-01']);
});

test('a merge commit from any other owner lands nothing', () => {
  assert.equal(landed(['Merge pull request #122 from someone/org-01', 'Merge pull request #123 from truedone-fork/app-17'], IDS).size, 0);
});
