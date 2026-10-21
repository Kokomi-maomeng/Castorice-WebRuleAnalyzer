"""Generate the project's original network-hub Windows icon using only Python stdlib."""
from pathlib import Path
import math, struct, zlib
root = Path(__file__).resolve().parents[1] / 'backend/cmd/castorice/winres'
for size, filename in [(256, 'icon.png'), (16, 'icon16.png')]:
    factor = 4
    n = size * factor
    nodes = [(0.5, 0.27), (0.29, 0.5), (0.71, 0.5), (0.5, 0.73)]
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            total = [0, 0, 0, 0]
            for dy in range(factor):
                for dx in range(factor):
                    px, py = (x + (dx + .5)/factor)/size, (y + (dy + .5)/factor)/size
                    c = (0, 0, 0, 0)
                    if math.hypot(px-.5,py-.5) < .475:
                        c = (101, 71, 158, 255)
                        for nx, ny in nodes:
                            vx, vy = nx-.5, ny-.5
                            t = max(0, min(1, ((px-.5)*vx+(py-.5)*vy)/(vx*vx+vy*vy)))
                            if math.hypot(px-(.5+t*vx),py-(.5+t*vy)) < .025:
                                c = (238, 232, 250, 255)
                        if math.hypot(px-.5,py-.5) < .085 or any(math.hypot(px-nx,py-ny)<.065 for nx,ny in nodes):
                            c = (248, 245, 255, 255)
                    for i, v in enumerate(c): total[i] += v
            rows.extend(round(v/(factor*factor)) for v in total)
    def chunk(k, data): return struct.pack('>I',len(data))+k+data+struct.pack('>I',zlib.crc32(k+data)&0xffffffff)
    png = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(rows,9))+chunk(b'IEND',b'')
    (root/filename).write_bytes(png)
