# Loads a SoulGold save with the game's own save code (save.c compiled for the GBA CPU, run in an emulator)
# and prints the game's verdict plus the loaded SaveBlock1, SaveBlock2 and PokemonStorage as hex files.
# Usage: python3 tools/sg-gamecheck/gamecheck.py [--resave] save.srm [...]   (run build.sh first; needs pip install unicorn)
import sys, json, os
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB
from unicorn.arm_const import UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_R0
BUILD = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build')
sym = {}
for l in open(os.path.join(BUILD, 'h.sym')).read().split('\n'):
    p = l.split()
    if len(p) == 3: sym[p[2]] = int(p[0], 16)
def run(save_bytes, fn='run', mu=None):
    if mu is None:
        mu = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
        mu.mem_map(0x02000000, 0x200000)
        mu.mem_map(0x0F000000, 0x1000)
        mu.mem_write(0x02000000, open(os.path.join(BUILD, 'h.bin'), 'rb').read())
        mu.mem_write(sym['flash'], bytes(save_bytes[:0x20000]))
    mu.reg_write(UC_ARM_REG_SP, 0x021F0000)
    mu.reg_write(UC_ARM_REG_LR, 0x0F000001)
    mu.emu_start(sym[fn] | 1, 0x0F000000, count=200_000_000)
    return mu, mu.reg_read(UC_ARM_REG_R0)
def rd32(mu, a): return int.from_bytes(mu.mem_read(a, 4), 'little')
if __name__ == '__main__':
    out = []
    for f in sys.argv[1:]:
        if f.startswith('--'): continue
        data = open(f, 'rb').read()
        mu, st = run(data)
        p1, p2, pp = rd32(mu, sym['P1']), rd32(mu, sym['P2']), rd32(mu, sym['PP'])
        res = {'file': f, 'status': st, 'counter': rd32(mu, sym['counter']), 'init': rd32(mu, sym['initCalled']),
               'sb1': bytes(mu.mem_read(p1, rd32(mu, sym['SZ1']))).hex(), 'sb2': bytes(mu.mem_read(p2, rd32(mu, sym['SZ2']))).hex(),
               'ps': bytes(mu.mem_read(pp, rd32(mu, sym['SZP']))).hex()}
        if '--resave' in sys.argv:
            mu, st2 = run(data, 'runSave', mu)
            res['resave_status'] = st2
            res['resaved'] = bytes(mu.mem_read(sym['flash'], 0x20000)).hex()
        out.append(res)
    print(json.dumps(out))
