<p align="center"><img src="build/icon.png" width="96" alt=""></p>

<h1 align="center">RadicalHex — Radical Red Save Editor</h1>

<p align="center">A free <b>Pokémon Radical Red 4.1 save editor</b> and Pokédex for Windows, in the spirit of PKHeX.<br>Edit Pokémon, boxes, party, items and money in your Radical Red <code>.sav</code> file, check legality, and plan Nuzlocke runs.</p>

<p align="center"><a href="https://github.com/jajaa17/RadicalHex/releases/latest"><b>Download RadicalHex.exe</b></a> · <a href="https://github.com/jajaa17/RadicalHex/issues/new/choose">Report a problem</a></p>

![The Boxes tab with a Pokémon open in the editor](docs/screenshot-boxes.png)

## Download

Download **RadicalHex.exe** from the [Releases page](https://github.com/jajaa17/RadicalHex/releases) and run it. There is nothing to install.

The app is not code-signed, so Windows SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**.

Every release also includes the full source code (zip and tar.gz), so anyone can check it or build it themselves. See [Building from source](#building-from-source).

**Found a bug or something wrong?** Please report it on the [Issues page](https://github.com/jajaa17/RadicalHex/issues/new/choose). Every report helps.

## Features

### Boxes
- All 25 boxes (23–25 unlock in the game as your PC fills up) with normal and shiny sprites, a star for shinies, a mark for perfect IVs and the icon of each held item
- Add a new Pokémon to any empty slot: species, level, nature, gender, shiny, held item, Poké Ball, friendship, ability, moves, IVs and EVs
- Paste a Pokémon Showdown set to fill in a new Pokémon, or copy any Pokémon as a Showdown set
- Drag to move or swap Pokémon, clone them, release them
- Max IVs on every Pokémon in one click

### Party
![The Party tab with held items](docs/screenshot-party.png)

- Your six party Pokémon as cards with sprite, level, nature, held item, HP, status and moves
- **Heal**: restore HP (fainted Pokémon included), cure poison, burn, sleep, freeze and paralysis, and refill PP, for one Pokémon or the whole party
- Edit them like any other Pokémon, or copy them into a box. Their battle stats update automatically when you change level, nature, IVs or EVs

### Editing a Pokémon
- Species, nickname, level, nature, gender, shininess, held item, Poké Ball, friendship, ability, all four moves (including Radical Red's Gen 9 moves), IVs and EVs
- **Ability** is a dropdown like PKHeX's, listing the species' own abilities by name: ability 1, ability 2 (if it has one) and its hidden ability (H). Changing it keeps the nature, shininess and gender, like the game does when it changes an ability
- Origin details: original trainer, IDs, met location and level
- **Moves** list only what the species can learn in Radical Red (level-up, TM, tutor, egg and pre-evolution moves), and not moves it already knows. In RadicalHaX mode every move is listed
- **EVs** stop at the game's limits: 252 per stat and 510 in total. The arrows stop there, and a bigger number you type is lowered to what is left. RadicalHaX mode allows up to 255 with no total
- Items show Radical Red's own bag icons everywhere: held items, the bag and every item list
- Every list (species, items, moves, bag) opens as a list you can browse by scrolling, by clicking a letter (A–Z), or with Page up and Page down buttons. Typing to filter is optional, and nothing needs a scroll wheel.

### Legality check and RadicalHaX mode
- Like PKHeX's legality check: every Pokémon is checked against Radical Red 4.1's own data, and the editor shows **✓ Legal**, warnings or **✕ Illegal** with the reason
- Catches moves the species can't learn in Radical Red (level-up, TM, tutor, egg and pre-evolution moves are all counted), duplicate moves, battle-only forms such as Megas outside battle, EVs above 252 or 510 in total, a hidden ability on a species without one, impossible met levels, key items as held items, and party stats that don't match
- The Boxes tab counts the illegal Pokémon in your save. Click the count to jump from one to the next
- **RadicalHaX mode** (the button in the top bar) is the PKHaX-style mode: legality checks are off and anything goes, including Megas and other battle-only forms. The save safety checks below always stay on, so the file itself can't be damaged

### Trainer & Bag
![The Trainer & Bag tab with item icons](docs/screenshot-bag.png)

- Money and Game Corner coins
- The whole bag: Items, Key Items, Poké Balls, TMs & HMs and Berries, with "add every TM/HM, ball or berry"
- Pokédex counts, and one click to register every Pokémon you own

### RadicalDex
![The RadicalDex showing Eevee's evolutions](docs/screenshot-radicaldex.png)

A Pokédex built from Radical Red's own data, so it matches the hack rather than the official games:
- Every species and form, with sprites, filter by name, number or type, and "only Pokémon in my save"
- Types, base stats and abilities (ability 1, ability 2 and hidden ability) as they are in Radical Red
- **Where to find it:** every location, method (grass by day or night, surfing, fishing rods, Rock Smash, gifts, trades, overworld, roaming, raids), levels and encounter chance
- **Evolution tree** with Radical Red's evolution methods
- **Mega Evolutions and form changes**, such as Primal Groudon with the Red Orb
- **Other forms**, such as Alolan, Galarian, Hisuian, Paldean and Sevii forms
- Level-up moves
- Shows how many of each Pokémon you have, where they are, and your Pokédex status. It also works without opening a save.

### Nuzlocke tools
![The Nuzlocke tab with level caps](docs/screenshot-nuzlocke.png)

- **Level caps** from the official Radical Red 4.1 docs for Normal and Hardcore, and a list of Pokémon above your current cap
- **Graveyard box**: pick a box for fainted Pokémon and move them there from the editor
- **Encounter log** built from where each of your Pokémon was met, with locations that have more than one catch flagged
- **No encounter yet**: locations with wild Pokémon where you have no catch so far
- **Evolution families you own**, for the dupes clause
- Settings are remembered per trainer

### Safety
- A backup is saved to `Documents\RadicalHex\Backups` every time you open a save and right before every save. Restore any of them from the **Backups** tab.
- Every save is checked before it is written. RadicalHex rebuilds the file, reloads it, makes sure only the parts it is allowed to edit changed, and validates every Pokémon and bag entry you touched. If anything is off, nothing is written.
- Files are written to a temporary file first, verified, then swapped in.
- Only the newest save slot is edited, so the game's previous save stays as a fallback.
- Undo (Ctrl+Z) for every edit, and a warning before closing with unsaved changes.
- The Open dialog starts in the folder of the last save you opened.

### Fits your screen, light on memory
- Works on anything from old 1024×768 monitors and scaled laptop screens to large displays. The layout adapts when the window is small or not maximized.
- Only the tab you are looking at is kept in memory, and long lists only draw the rows on screen, so RadicalHex stays light even on older PCs.

## Using it

1. **Close the game in your emulator** (or at least do not save in-game) before editing, or the emulator may overwrite your changes.
2. Open your battery save (`.sav` / `.srm`), not a save state.
3. Edit, then press **Save** (Ctrl+S). Use **Save as…** to write a copy instead.
4. Load the save in your emulator.

Good to know:
- New Pokémon go into boxes. Withdraw them in the game to use them in your party.
- Party Pokémon store their battle stats separately. RadicalHex recalculates them for you when you edit a party Pokémon, and the Stats tab has a **Recalculate stats** button.
- Like the main games, a Pokémon in Radical Red has ability 1, ability 2 or its hidden ability, and RadicalHex lets you pick any of the ones its species has.

## Reporting a problem

If you find any issue, please report it on the [Issues page](https://github.com/jajaa17/RadicalHex/issues/new/choose) and pick **Bug report**, **Save problem**, **Wrong game data** or **Feature request**. Your original save is always in the Backups folder, so attaching it is safe.

## Building from source

Requires Node.js 22.

```sh
npm ci
npm start          # run the app
npm run check      # data and safety checks
npm test -- path/to/your.sav [more.sav]   # full edit and round-trip tests against real saves
npm run dist       # build dist/RadicalHex.exe
```

Every push to `main` makes GitHub Actions build `RadicalHex.exe` on Windows and publish it as the release for the version in `package.json`.

The data files are generated, in this order, from the sources listed below:

```sh
node tools/build-dex.js <sources>        # src/dex.js and tools/rr-tables.json
python3 tools/build-data.py <sources>    # src/data.js and the sprites
python3 tools/build-items.py <sources>   # the item icons
```

The top of each script lists which repositories go in the `<sources>` folder.

The screenshots in `docs` are made from a demo save with `npx electron tools/screenshots.js`.

## Credits

- [PKHeX](https://github.com/kwsch/PKHeX) by Kaphotics and contributors, the save editor RadicalHex is modeled after
- [PKForge](https://github.com/sofianeelhor/PKForge) by sofianeelhor, whose Radical Red engine documents the save layout RadicalHex follows, and whose Radical Red 4.1 species and item tables come from [Rad-Red-4.1-Team-Exporter](https://github.com/eliyahu1702/Rad-Red-4.1-Team-Exporter)
- The official [Radical Red Pokédex](https://dex.radicalred.net) ([source](https://github.com/JwowSquared/Radical-Red-Pokedex)) for species data, abilities, evolutions, locations, moves, items, item icons and level caps
- [pret/pokefirered](https://github.com/pret/pokefirered) for FireRed's location names
- [Complete Fire Red Upgrade](https://github.com/Skeli789/Complete-Fire-Red-Upgrade), the engine Radical Red is built on
- Radical Red's own `Base_Stats.c` (from the history of [Ydarissep/Radical-Red-Pokedex](https://github.com/Ydarissep/Radical-Red-Pokedex)) for experience growth rates
- [PokéAPI](https://github.com/PokeAPI/pokeapi) for national Pokédex numbers and gender ratios, and [PokéAPI sprites](https://github.com/PokeAPI/sprites) for the Pokémon sprites
- Pokémon Radical Red by soupercell and the Radical Red team

RadicalHex is a fan project and is not affiliated with Nintendo, Creatures Inc., GAME FREAK inc. or The Pokémon Company. Pokémon names and sprites are © their respective owners. Please do not use edited Pokémon against people who have not agreed to it.

### A note from me

I'm new to JavaScript and the other languages RadicalHex is written in. I wanted a save editor for Radical Red, so I built this with help from [Claude](https://claude.ai) by Anthropic, which showed me how to do things I didn't know were possible yet.

## License

GPL-3.0-or-later, matching PKHeX and PKForge. See [LICENSE](LICENSE).
