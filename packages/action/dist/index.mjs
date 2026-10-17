import { readFileSync } from 'node:fs';
const __m1=(()=>{
async function runGate(context) {
console.log(`truedone: the red-green executor is not wired yet (RUN-01, ACT-02); nothing ran for ${context.repository} ${context.headSha}.`);
return 0;
}

return {runGate};
})();
const { runGate } = __m1;

if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
console.log(`truedone: the action runs on pull_request events only (got ${process.env.GITHUB_EVENT_NAME}); skipping.`);
process.exit(0);
}

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const context = {
repository: process.env.GITHUB_REPOSITORY,
headSha: event.pull_request?.head?.sha ?? event.after ?? event.sha,
baseSha: event.pull_request?.base?.sha,
eventName: process.env.GITHUB_EVENT_NAME,
config: process.env.INPUT_CONFIG || ".github/truedone.yml",
timeoutS: Number(process.env.INPUT_TIMEOUT || 1200),
};

const code = await runGate(context);
process.exit(code);
