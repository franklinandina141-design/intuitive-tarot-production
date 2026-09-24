const {newSession, ensureLogin, getCachedCredits} = require('./utils/session');
App({
  onLaunch() {
    this.session = newSession();
    // Only the current session lives in memory; questions are not stored on disk.
    this.allowAI = false;
    this.credits = getCachedCredits();
    ensureLogin()
      .then((data) => {
        this.credits = typeof data.credits === 'number' ? data.credits : this.credits;
      })
      .catch(() => {
        // Offline / backend down: keep reading flow working; pay CTAs retry login later.
      });
  }
});
