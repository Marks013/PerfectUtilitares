/** Snapshot exactly the production modules, including policy resources, without writing private inputs. */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const BASELINE_REVISION = "ee815cd26fd8c6557f3228482338338d8288e91f";

export function sourceSnapshot(revision?: string) {
  const directory = "ops/escalas/";
  let files: string[];
  if (revision) {
    const listed = spawnSync("git", ["-C", "..", "ls-tree", "-r", "--name-only", revision, "--", "web/ops/escalas/"], { encoding: "utf8" });
    if (listed.status !== 0) throw new Error("BENCHMARK_SOURCE_FAILED");
    files = listed.stdout.trim().split("\n").map(file => file.slice("web/ops/escalas/".length));
  } else files = readdirSync(directory);
  files = files.filter(file => /^[a-z][a-z0-9_-]*\.(py|json)$/.test(file)
    && !file.startsWith("test_") && !file.startsWith("candidate_") && !file.startsWith("property_")).sort();
  const sources: Record<string, string> = {}, resources: Record<string, string> = {}, hashes: Record<string, string> = {};
  for (const file of files) {
    let contents: string;
    if (revision) {
      const shown = spawnSync("git", ["show", `${revision}:web/${directory}${file}`], { encoding: "utf8" });
      if (shown.status !== 0 || !shown.stdout) throw new Error("BENCHMARK_SOURCE_FAILED");
      contents = shown.stdout;
    } else contents = readFileSync(directory + file, "utf8");
    if (file.endsWith(".py")) sources[file.slice(0, -3)] = contents;
    else resources[file] = contents;
    hashes[file] = createHash("sha256").update(contents).digest("hex");
  }
  if (!sources.solver || !sources.optimization || !sources.hints) throw new Error("BENCHMARK_SOURCE_FAILED");
  return { sources, resources, hashes, revision: revision || "working-tree", hash: createHash("sha256").update(JSON.stringify(hashes)).digest("hex") };
}

export const benchmarkPython = String.raw`import sys,json,time,types,resource,importlib.abc,importlib.util
from pathlib import Path
from ortools.sat.python import cp_model
request=json.load(sys.stdin)
class SnapshotLoader(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path=None, target=None):
        if name in request['sources']:
            return importlib.util.spec_from_loader(name,self,origin='/snapshot/'+name+'.py')
    def create_module(self,spec):
        return None
    def exec_module(self,module):
        module.__file__='/snapshot/'+module.__name__+'.py'
        exec(compile(request['sources'][module.__name__],module.__file__,'exec'),module.__dict__)
reader=Path.read_text
def read_resource(path,*args,**kwargs):
    if path.name in request.get('resources',{}):
        return request['resources'][path.name]
    return reader(path,*args,**kwargs)
Path.read_text=read_resource
sys.meta_path.insert(0,SnapshotLoader())
import solver
native=cp_model.CpSolver.solve
calls=[]
started=time.monotonic()
def traced(self,model,*args,**kwargs):
    before=time.monotonic()
    status=native(self,model,*args,**kwargs)
    calls.append({'at':round(before-started,3),'status':self.status_name(status),'seconds':round(time.monotonic()-before,3)})
    return status
cp_model.CpSolver.solve=traced
result=solver.solve(request['input'])
print(json.dumps({'result':result,'calls':calls,'maxRssKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}))`;

export function quantile(values: number[], fraction: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
