// Stand-ins for game functions save.c calls that do not matter for loading and saving.
#define STUB(n) int n() { return 0; }
STUB(ClearContinueGameWarpStatus2) STUB(CopyPartyAndObjectsFromSave) STUB(CopyPartyAndObjectsToSave) STUB(CountRetainedHallOfFameTeams)
STUB(DestroyTask) STUB(DoSaveFailedScreen) STUB(GetGameStat) STUB(IncrementGameStat) STUB(IsLinkTaskFinished) STUB(SaveMapView)
STUB(SetContinueGameWarpStatusToDynamicWarp) STUB(SetGameStat) STUB(SetLinkStandbyCallback)
char gTasks[16 * 64];
unsigned __udivsi3(unsigned n, unsigned d) { unsigned q = 0, r = 0; for (int i = 31; i >= 0; i--) { r = (r << 1) | ((n >> i) & 1); if (r >= d) { r -= d; q |= 1u << i; } } return q; }
unsigned __umodsi3(unsigned n, unsigned d) { unsigned r = 0; for (int i = 31; i >= 0; i--) { r = (r << 1) | ((n >> i) & 1); if (r >= d) r -= d; } return r; }
