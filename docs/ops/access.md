# Access

Lanes reach GitHub only through the lead runner, logged in as mgillr.

Decided on 2026-10-17: no organisation and no machine account. The four lanes commit in their own clones under their lane
names, truedone-lane-a to truedone-lane-d, and hold no GitHub credential. The lead runner pushes each task branch to
mgillr/truedone and opens its pull request with my login; the CI gate re-runs the task from the signed contract on main.
GitHub does not let an author approve their own pull request, so the gate is the check on every pull request, and I read
the tests a task adds before I merge it.
