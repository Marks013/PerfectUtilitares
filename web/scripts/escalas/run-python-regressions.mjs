/** Execute only synthetic production-code regressions in an already available processor image. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../../ops/escalas/", import.meta.url));
const result = spawnSync("docker", ["run", "--rm", "--pull=never", "--read-only", "--network", "none",
  "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m,uid=1001,gid=1001,mode=1770", "--cpus", "1", "--memory", "1536m",
  "--pids-limit", "96", "--env", "PYTHONDONTWRITEBYTECODE=1", "--mount", `type=bind,src=${directory},dst=/model,readonly`,
  "--workdir", "/model", "--entrypoint", "python", process.env.ESCALAS_TEST_IMAGE || "web-escalas-solver",
  "-B", "-m", "unittest", "discover", "-s", ".", "-p", "test_*.py"], { stdio: "inherit", timeout: 600_000 });
if (result.error) console.error("The scheduling regression processor could not finish.");
process.exitCode = result.status ?? 1;
