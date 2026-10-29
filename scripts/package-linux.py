"""Archive a clean Linux package with portable executable permissions."""
import argparse
from pathlib import Path
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
args = parser.parse_args()
package = args.directory.resolve()
if not (package / 'castorice').is_file():
    raise SystemExit('Missing Linux executable')
for p in package.rglob('*'):
    if p.name in {'data', 'exports', '.runtime', '.git'} or p.is_symlink():
        raise SystemExit('Refusing runtime data or symlink in package')
archive = package.parent / (package.name + '.tar.gz')
with tarfile.open(archive, 'w:gz') as output:
    for p in sorted(package.rglob('*')):
        info = output.gettarinfo(str(p), arcname=package.name + '/' + p.relative_to(package).as_posix())
        info.uid = info.gid = 0
        info.uname = info.gname = ''
        info.mode = 0o755 if p.is_dir() or p.name in {'castorice', 'start.sh'} else 0o644
        if p.is_file():
            with p.open('rb') as content:
                output.addfile(info, content)
        else:
            output.addfile(info)
print(archive)
