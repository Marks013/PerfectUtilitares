const MAX_CONCURRENT_REAJUSTE_JOBS = 2;

let activeJobs = 0;

export function tryAcquireReajusteProcessingSlot() {
  if (activeJobs >= MAX_CONCURRENT_REAJUSTE_JOBS) return null;
  activeJobs += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeJobs = Math.max(0, activeJobs - 1);
  };
}
