<p align="center"><img src="build/icon.png" width="96" alt=""></p>

<h1 align="center">RadicalHex — Radical Red Save Editor</h1>

<p align="center">A free <b>Pokémon Radical Red 4.1 save editor</b> and Pokédex for Windows, in the spirit of PKHeX.<br>Edit Pokémon, boxes, party, items and money in your Radical Red <code>.sav</code> file, check legality, and plan Nuzlocke runs.</p>

<p align="center"><a href="https://github.com/jajaa17/RadicalHex/releases/latest"><b>Download RadicalHex.exe</b></a> · <a href="https://github.com/jajaa17/RadicalHex/issues/new/choose">Report a problem</a></p>

![The Boxes tab with a Pokémon open in the editor](docs/screenshot-boxes.png)

> [!WARNING]
> **Editing a save always carries some risk. Use RadicalHex at your own risk.**
> RadicalHex backs up your save every time you open or save it, checks every save before writing it, and refuses to write anything that looks wrong. Even so, it can't guarantee your save will never break. Radical Red is a ROM hack with its own rules, and some edits the file allows can still confuse the game: RadicalHaX mode, battle-only forms, key items, story items, extreme values, or lots of big edits at once. **Keep your own copy of your save before editing**, make changes a few at a time, and test them in the game. If something goes wrong, restore a backup from the **Backups** tab.

## Download

Download **RadicalHex.exe** from the [Releases page](https://github.com/jajaa17/RadicalHex/releases) and run it. There is nothing to install.

**Put RadicalHex.exe in its own folder** (for example `C:\Games\RadicalHex`) before running it. RadicalHex makes a **`Backups`** folder next to the .exe and keeps a copy of your save there every time you open or save. If you move the .exe, move the `Backups` folder with it. If that folder can't be written to (such as inside Program Files), backups go to `Documents\RadicalHex\Backups` instead.

The app is not code-signed, so Windows SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**.

Every release also includes the full source code (zip and tar.gz), so anyone can check it or build it themselves. See [Building from source](#building-from-source).

**Found a bug or something wrong?** Please report it on the [Issues page](https://github.com/jajaa17/RadicalHex/issues/new/choose). Every report helps.

## Features

### Boxes
- All 25 boxes (23–25 unlock in the game as your PC fills up) with normal and shiny sprites, a star for shinies, a mark for perfect IVs and the icon of each held item
- Add a new Pokémon to any empty slot: species, level, nature, gender, shiny, held item, Poké Ball, friendship, ability, moves, IVs and EVs
- Paste a Pokémon Showdown set to fill in a new Pokémon, or copy any Pokémon as a Showdown set
- **Drag and drop like PKHeX:** your party is shown next to the box. Drag any Pokémon onto any box or party slot to move it there, or onto another Pokémon to swap them. Hold a Pokémon over ‹ or › to flip to another box. Clone and release from the editor
- **Move to box** sends a Pokémon to the first free slot of any other box, and **Move to party** puts it at the end of your party
- Max IVs on every Pokémon in one click

### Party
![The Party tab with held items](docs/screenshot-party.png)

- Your six party Pokémon as cards with sprite, level, nature, held item, HP, status and moves
- **Heal**: restore HP (fainted Pokémon included), cure poison, burn, sleep, freeze and paralysis, and refill PP, for one Pokémon or the whole party
- **Add a Pokémon straight to your party**: click an empty party slot
- Drag party cards onto each other to change the order. **Move to box** (or dragging in the Boxes tab) puts a party Pokémon in a box, and the rest of the party moves up, like in the game. Your last Pokémon has to stay (eggs don't count)
- Edit them like any other Pokémon, or copy them into a box. Their battle stats update automatically when you change level, nature, IVs or EVs

### Editing a Pokémon
- Species, nickname, level, nature, gender, shininess, held item, Poké Ball, friendship, ability, all four moves (including Radical Red's Gen 9 moves), IVs and EVs
- **Ability** is a dropdown like PKHeX's, listing the species' own abilities by name: ability 1, ability 2 (if it has one) and its hidden ability (H). Changing it keeps the nature, shininess and gender, like the game does when it changes an ability
- **Origin** (like PKHeX): original trainer name, gender, trainer ID and secret ID, met location and met level, plus **Make it mine** to give it your trainer details. Changing the IDs keeps it shiny or not shiny. The met location list puts the places where that Pokémon's evolution family is found in Radical Red first. With legality checks on, the met level can't go above its level and the OT needs a name. RadicalHaX mode allows any location number and met level
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
- **Pokédex like PKHeX:** when you save, every Pokémon in the file is marked as seen and caught, as the game does for anything you own. If you add a Pokémon by mistake and remove or replace it before saving, it isn't registered

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
- A backup is saved to the `Backups` folder next to RadicalHex.exe every time you open a save and right before every save. Restore any of them from the **Backups** tab. To keep the folder tidy, tick backups and delete them, or use **Select all but the newest 5** (per save). The tab also lists backups made by versions before 1.0.5 (those were kept in `Documents\RadicalHex\Backups`).
- Every save is checked before it is written. RadicalHex rebuilds the file, reloads it, makes sure only the parts it is allowed to edit changed, and validates every Pokémon and bag entry you touched. If anything is off, nothing is written.
- Files are written to a temporary file first, verified, then swapped in.
- Only the newest save slot is edited, so the game's previous save stays as a fallback.
- Undo (Ctrl+Z) for every edit, and a warning before closing with unsaved changes.
- The Open dialog starts in the folder of the last save you opened.

### Sounds and cries
- Every Pokémon has a **Cry** button (in the editor and the RadicalDex). Clicking its big sprite plays the cry too, and it hops along
- Little GBA-style sounds for clicks, tabs, picking from lists, saving, undo, errors, adding a Pokémon (a Poké Ball catch), releasing, healing and making a Pokémon shiny
- The speaker button in the top bar turns the sounds off or on. Cries still play when you ask for one
- Light: the sounds are made by the app as they play (no sound files), and each cry is a small file that only loads when you press Cry

### Updates
- The version you have is shown next to the RadicalHex name at the top left.
- When RadicalHex starts, it checks GitHub for a newer version. If there is one, the version turns red. Click it, then **Update now**.
- RadicalHex downloads the new `RadicalHex.exe` next to yours and keeps it only if it matches the checksum GitHub publishes for that file. Then it closes, and the new version replaces the old `RadicalHex.exe` and starts. Your saves and the `Backups` folder aren't touched.
- If anything goes wrong (no internet, a bad download, the folder can't be written to, the old .exe is still in use), your current `RadicalHex.exe` stays exactly as it was, and RadicalHex tells you what happened.
- Don't want it to go online? Click the version and untick **Check for updates when RadicalHex starts**. You can still check by hand with **Check now**, or download new versions from the [Releases page](https://github.com/jajaa17/RadicalHex/releases).
- Updating in place starts with v1.0.9. If you have an older version, download v1.0.9 or newer once by hand.

### Fits your screen, light on memory
- Works on anything from old 1024×768 monitors and scaled laptop screens to large displays. The layout adapts when the window is small or not maximized.
- Only the tab you are looking at is kept in memory, and long lists only draw the rows on screen, so RadicalHex stays light even on older PCs.

## Using it

1. **Close the game in your emulator** (or at least do not save in-game) before editing, or the emulator may overwrite your changes.
2. Open your battery save (`.sav` / `.srm`), not a save state.
3. Edit, then press **Save** (Ctrl+S). Use **Save as…** to write a copy instead.
4. Load the save in your emulator.

Good to know:
- New Pokémon can go into a box or straight into your party. A Pokémon moved into the party gets full HP and PP, the same as withdrawing it in the game.
- Party Pokémon store their battle stats separately. RadicalHex recalculates them for you when you edit a party Pokémon, and the Stats tab has a **Recalculate stats** button.
- Like the main games, a Pokémon in Radical Red has ability 1, ability 2 or its hidden ability, and RadicalHex lets you pick any of the ones its species has.

## Reporting a problem

If you find any issue, please report it on the [Issues page](https://github.com/jajaa17/RadicalHex/issues/new/choose) and pick **Bug report**, **Save problem**, **Wrong game data** or **Feature request**. Your original save is always in the `Backups` folder next to RadicalHex.exe, so attaching it is safe.

## What it's built with

- **[Electron](https://www.electronjs.org/)**, the same base used by apps like Discord and VS Code. Electron is an open-source project of the OpenJS Foundation (it was started by GitHub). It packs two things into one Windows app:
  - **Chromium**, the open-source browser engine behind Google Chrome, which draws the window
  - **Node.js**, which handles your files: opening and saving saves, and making backups
- The app itself is plain **HTML, CSS and JavaScript**, with no frameworks or extra libraries. All the save reading, editing and checking is in `src/core.js`.
- **[electron-builder](https://www.electron.build/)** turns it into the single `RadicalHex.exe`, and **GitHub Actions** builds it on Windows from this code for every release, so the .exe isn't built on anyone's own PC.
- The data and asset tools in `tools/` use **Node.js**, **Python** (with Pillow for the item icons) and **ffmpeg** (for the cries).
- The sounds are made by the app as they play, with the browser's Web Audio feature, so there are no sound files for them.

**Why is the .exe about 100 MB?** Almost all of it is Electron, because every Electron app brings its own copy of Chromium. RadicalHex's own code, data, sprites, item icons and cries are about 20 MB of that. The download is already trimmed (English-only browser files, maximum compression).

**Does it go online?** Only to check for updates: when it starts, it asks GitHub for the latest RadicalHex release. Nothing about you or your saves is sent, and you can turn the check off (see [Updates](#updates)). Everything else stays on your PC.

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
python3 tools/build-cries.py <sources>   # the cries (needs ffmpeg)
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
- [PokéAPI](https://github.com/PokeAPI/pokeapi) for national Pokédex numbers and gender ratios, [PokéAPI sprites](https://github.com/PokeAPI/sprites) for the Pokémon sprites, and [PokéAPI cries](https://github.com/PokeAPI/cries) for the cries
- Pokémon Radical Red by soupercell and the Radical Red team

RadicalHex is a fan project and is not affiliated with Nintendo, Creatures Inc., GAME FREAK inc. or The Pokémon Company. Pokémon names, sprites and cries are © their respective owners. Please do not use edited Pokémon against people who have not agreed to it.

### A note from me

RadicalHex started as something just for my own Radical Red saves. I decided to put it on GitHub for anyone else who wants to use it. It's free and open source, so if you don't trust a random .exe (fair!), you can read every line of the code here, or build it yourself from source.

I'm new to JavaScript and the other languages RadicalHex is written in. I wanted a save editor for Radical Red, so I built this with help from [Claude](https://claude.ai) by Anthropic, which showed me how to do things I didn't know were possible yet.

## License

GPL-3.0-or-later, matching PKHeX and PKForge. See [LICENSE](LICENSE).
