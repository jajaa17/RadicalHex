// Harness for tools/sg-gamecheck: SoulGold's own save code reads and writes this flash buffer and these save blocks.
#include "global.h"
#include "save.h"
#include "pokemon_storage_system.h"
#include "load_save.h"
u8 flash[0x20000];
static struct SaveBlock1 sb1; static struct SaveBlock2 sb2; static struct PokemonStorage ps;
struct SaveBlock1 *gSaveBlock1Ptr = &sb1; struct SaveBlock2 *gSaveBlock2Ptr = &sb2; struct PokemonStorage *gPokemonStoragePtr = &ps;
struct SaveBlock3 gSaveblock3;
bool32 gFlashMemoryPresent = TRUE;
void *gHoFSaveBuffer = NULL;
u32 *gTrainerHillVBlankCounter = NULL;
bool8 gSoftResetDisabled;
const u32 SZ1 = sizeof(sb1), SZ2 = sizeof(sb2), SZP = sizeof(ps);
u8 *const P1 = (u8*)&sb1, *const P2 = (u8*)&sb2, *const PP = (u8*)&ps, *const P3 = (u8*)&gSaveblock3;
const u32 SZ3 = sizeof(gSaveblock3);
void *memcpy(void *d, const void *s, unsigned n) { u8 *a = d; const u8 *b = s; while (n--) *a++ = *b++; return d; }
void *memset(void *d, int c, unsigned n) { u8 *a = d; while (n--) *a++ = c; return d; }
u32 ReadFlash(u16 sector, u32 offset, void *dest, u32 size) { memcpy(dest, flash + sector * 0x1000 + offset, size); return 0; }
u8 ProgramFlashSectorAndVerify(u16 sector, u8 *data) { memcpy(flash + sector * 0x1000, data, 0x1000); return 0; }
u16 ProgramFlashByte(u16 sector, u32 offset, u8 data) { flash[sector * 0x1000 + offset] = data; return 0; }
u16 EraseFlashSector(u16 sector) { memset(flash + sector * 0x1000, 0xFF, 0x1000); return 0; }
int initCalled;
void InitPokemonStorageExtension(void) { initCalled |= 1; }
void InitPokemonStorageBox18Extension(void) { initCalled |= 2; }
void InitPokemonStorageBox19Extension(void) { initCalled |= 4; }
void *AllocZeroedUnchecked_(u32 size) { return 0; }
void Free(void *p) {}
int status, counter;
int run(void) { status = LoadGameSave(SAVE_NORMAL); counter = gSaveCounter; return status; }
int runSave(void) { return TrySavingData(SAVE_NORMAL); }
