/** Cap concurrent RoutePreview paints on the Trips shelf. */

const MAX_CONCURRENT = 6;
let active = 0;
const waiters: Array<() => void> = [];

export function acquirePaintSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (active >= MAX_CONCURRENT) {
        waiters.push(tryAcquire);
        return;
      }
      active += 1;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        active = Math.max(0, active - 1);
        const next = waiters.shift();
        if (next) next();
      });
    };
    tryAcquire();
  });
}

/** Test helper — not used in production UI. */
export function _paintGateDebug() {
  return { active, waiting: waiters.length, max: MAX_CONCURRENT };
}

export function _resetPaintGateForTests() {
  active = 0;
  waiters.length = 0;
}
