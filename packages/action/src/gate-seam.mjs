// The seam the bundle wires the executor through (ACT-01). RUN-01's runner and
// ACT-02's report client land behind this interface; until then the action runs,
// reports that nothing executed, and exits neutral so a misconfigured event
// never fails a repository's CI.
export async function runGate(context) {
  console.log(`truedone: the red-green executor is not wired yet (RUN-01, ACT-02); nothing ran for ${context.repository} ${context.headSha}.`);
  return 0;
}
