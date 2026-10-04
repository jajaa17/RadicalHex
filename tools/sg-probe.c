// Compiled by tools/build-sg-data.py with the game's ARM compiler: struct sizes, field offsets, bit-field positions and constants of SoulGold.
#include "global.h"
#include "pokemon.h"
#include "item.h"
#include "move.h"
#include "region_map.h"
#include "constants/items.h"
#include "constants/moves.h"
#include "constants/abilities.h"
#include "constants/species.h"
#include "constants/region_map_sections.h"
#define O(s,f) const unsigned P_##s##__##f = offsetof(struct s, f);
#define Z(s) const unsigned S_##s = sizeof(struct s);
Z(SpeciesInfo) Z(ItemInfo) Z(MoveInfo) Z(RegionMapLocation) Z(LevelUpMove) Z(Evolution) Z(AbilityInfo) Z(FormChange)
O(SpeciesInfo,baseHP) O(SpeciesInfo,types) O(SpeciesInfo,catchRate) O(SpeciesInfo,expYield) O(SpeciesInfo,itemCommon) O(SpeciesInfo,genderRatio) O(SpeciesInfo,eggCycles) O(SpeciesInfo,friendship) O(SpeciesInfo,growthRate) O(SpeciesInfo,eggGroups) O(SpeciesInfo,abilities) O(SpeciesInfo,innates) O(SpeciesInfo,categoryName) O(SpeciesInfo,speciesName) O(SpeciesInfo,frontPic) O(SpeciesInfo,palette) O(SpeciesInfo,shinyPalette) O(SpeciesInfo,levelUpLearnset) O(SpeciesInfo,teachableLearnset) O(SpeciesInfo,eggMoveLearnset) O(SpeciesInfo,evolutions) O(SpeciesInfo,formSpeciesIdTable) O(SpeciesInfo,formChangeTable) O(SpeciesInfo,description) O(SpeciesInfo,iconSprite)
O(ItemInfo,price) O(ItemInfo,name) O(ItemInfo,description) O(ItemInfo,holdEffect) O(ItemInfo,iconPic) O(ItemInfo,iconPalette) O(ItemInfo,secondaryId)
O(MoveInfo,name) O(MoveInfo,description) O(MoveInfo,pp)
O(RegionMapLocation,name)
O(LevelUpMove,move) O(LevelUpMove,level)
O(Evolution,method) O(Evolution,param) O(Evolution,targetSpecies)
O(AbilityInfo,name) O(AbilityInfo,description) O(AbilityInfo,longDescription)
const unsigned K_NUM_SPECIES = NUM_SPECIES, K_ITEMS_COUNT = ITEMS_COUNT, K_MOVES_COUNT = MOVES_COUNT, K_ABILITIES_COUNT = ABILITIES_COUNT, K_MAPSEC_COUNT = MAPSEC_COUNT, K_MAPSEC_NONE = MAPSEC_NONE, K_NUM_ABILITY_SLOTS = NUM_ABILITY_SLOTS, K_MAX_MON_INNATES_INTERNAL = MAX_MON_INNATES_INTERNAL, K_EVOLUTIONS_END = EVOLUTIONS_END, K_LEVEL_UP_MOVE_END = LEVEL_UP_MOVE_END, K_NATIONAL_DEX_COUNT = NATIONAL_DEX_COUNT, K_SPECIES_EGG = SPECIES_EGG, K_MOVE_UNAVAILABLE = MOVE_UNAVAILABLE, K_FORM_SPECIES_END = FORM_SPECIES_END;
const struct SpeciesInfo B_natDexNum = {.natDexNum = 0xFFFF};
const struct SpeciesInfo B_isMega = {.isMegaEvolution = 1};
const struct SpeciesInfo B_isPrimal = {.isPrimalReversion = 1};
const struct SpeciesInfo B_isGmax = {.isGigantamax = 1};
const struct SpeciesInfo B_isUB = {.isUltraBurst = 1};
const struct SpeciesInfo B_isTera = {.isTeraForm = 1};
const struct SpeciesInfo B_isTotem = {.isTotem = 1};
const struct MoveInfo B_mvCat = {.category = 3};
const struct ItemInfo B_pocket = {.pocket = 31};
const struct ItemInfo B_importance = {.importance = 3};
const struct MoveInfo B_type = {.type = 31};
const struct MoveInfo B_category = {.category = 3};
const struct MoveInfo B_power = {.power = 511};
const struct MoveInfo B_accuracy = {.accuracy = 127};
