// Preload for the capture server: shifts the process clock to FAKE_NOW (an ISO time)
// and lets it run on from there, so time-of-day features (the lunch routine offered
// before noon) appear in the captured app exactly as they would at that hour.
const target = Date.parse(process.env.FAKE_NOW ?? "");
if (!Number.isNaN(target)) {
  const RealDate = Date;
  const offset = target - RealDate.now();
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = ShiftedDate;
}
