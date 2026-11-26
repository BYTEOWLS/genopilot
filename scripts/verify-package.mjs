// Installs the packed tarball into a clean temporary prefix with npm and checks that the
// bundled CLI starts there with nothing but the package itself. Run after `pnpm pack:local`.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const tarball = resolve(process.argv[2] ?? 'byteowls-genopilot-local.tgz');
const tempDir = mkdtempSync(join(tmpdir(), 'genopilot-package-'));
const problems = [];

function run(command, arguments_) {
  return spawnSync(command, arguments_, {encoding: 'utf8', env: {...process.env, npm_config_update_notifier: 'false'}});
}

try {
  const install = run('npm', ['install', '--global', '--prefix', tempDir, '--no-audit', '--no-fund', tarball]);
  if (install.status !== 0) {
    throw new Error(`npm install failed:\n${install.stdout}${install.stderr}`);
  }
  const installed = join(tempDir, 'lib', 'node_modules', '@byteowls', 'genopilot');
  if (existsSync(join(installed, 'node_modules'))) {
    problems.push('the installed package has its own node_modules');
  }
  for (const path of [
    'dist/cli.js',
    'dist/gff3-replace-worker.js',
    'dist/genome-source.js',
    'workflows/shared/scripts/genome_source.py',
    'dist/THIRD-PARTY-LICENSES.md',
    'dist/browser/assets/index.html',
    'dist/browser/assets/page.js',
    'dist/browser/assets/page.css',
    'dist/browser/assets/igv.js',
    'workflows/shared/logging',
    'docs',
    'runtime/pixi.lock',
  ]) {
    if (!existsSync(join(installed, path))) {
      problems.push(`${path} is missing`);
    }
  }
  // Exercise the installed Node/Python copy boundary from an unrelated working directory.
  const unrelated = join(tempDir, 'unrelated');
  const root = join(tempDir, 'source-root');
  const reference = {source: 'ncbi', id: 'GCF_000000001.1', parameters: {}};
  const cache = join(root, 'ncbi-accessions-cache', reference.id);
  mkdirSync(cache, {recursive: true});
  mkdirSync(unrelated);
  const fasta = '>synthetic-redistributable\nACGTNNNN\n';
  const digest = createHash('sha256').update(fasta).digest('hex');
  writeFileSync(join(cache, 'genomic.fna'), fasta);
  writeFileSync(join(cache, 'checksums.json'), JSON.stringify({fasta: digest}));
  writeFileSync(join(cache, 'genome.json'), JSON.stringify({reference, metadata: null, facts: {source: 'ncbi', api: 'datasets-v2-rest'}, annotation: 'not-requested'}));
  const request = {reference, kinds: ['fasta'], root: join(tempDir, 'other-root'), mode: 'reuse', copy: {path: cache, fasta_sha256: digest}};
  const copyTest = spawnSync('python3', ['-c', `
import hashlib, json, pathlib, subprocess, sys
from unittest.mock import patch
sys.path.insert(0, sys.argv[1])
import genome_source
request = json.loads(sys.argv[2])
root = pathlib.Path(sys.argv[3])
entry = pathlib.Path(sys.argv[4])
cache = pathlib.Path(request['copy']['path'])
lock = cache.parent / ('.' + request['reference']['id'] + '.lock')
destination = root / 'run' / 'genomic.fna'
original_copy = genome_source.shutil.copyfile
calls = []
def checked_copy(source, target):
    assert lock.is_dir(), 'cache lease must cover Python consumption'
    refresh = dict(request, root=str(cache.parent.parent), mode='refresh')
    del refresh['copy']
    blocked = subprocess.Popen(['node', str(entry)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    blocked.stdin.write(json.dumps(refresh) + '\\n')
    blocked.stdin.flush()
    blocked_error = blocked.stderr.read()
    blocked.wait()
    blocked.stdin.close()
    blocked.stdout.close()
    blocked.stderr.close()
    assert blocked.returncode != 0 and 'holds this entry' in blocked_error, blocked_error
    calls.append(source)
    return original_copy(source, target)
with patch('genome_source.shutil.copyfile', checked_copy):
    result = genome_source.copy_genome(request, {'fasta': destination})
assert calls and result['downloaded'] is False
assert result['fasta_sha256'] == request['copy']['fasta_sha256']
assert not lock.exists()
expected = destination.read_bytes()
def corrupt_copy(source, target):
    pathlib.Path(target).write_bytes(b'corrupted during consumption')
with patch('genome_source.shutil.copyfile', corrupt_copy):
    try:
        genome_source.copy_genome(request, {'fasta': destination})
        raise AssertionError('corrupt copy was accepted')
    except RuntimeError as error:
        assert 'checksum' in str(error), str(error)
assert destination.read_bytes() == expected
assert not lock.exists()
assert not list(destination.parent.glob('.genome-*'))
try:
    genome_source.copy_genome(request, {'fasta': destination, 'gff3': destination.with_suffix('.gff')})
    raise AssertionError('an annotation-requiring role accepted missing GFF3')
except RuntimeError as error:
    assert 'gff3' in str(error), str(error)
assert destination.read_bytes() == expected
assert not destination.with_suffix('.gff').exists()
assert not lock.exists()
assert not list(destination.parent.glob('.genome-*'))
assert (cache / 'genomic.fna').is_file()
# An annotation-only catalog cache is independently consumable without inventing FASTA paths.
annotation_cache = root / 'annotation-source' / 'ncbi-accessions-cache' / request['reference']['id']
annotation_cache.mkdir(parents=True)
gff3 = b'##gff-version 3\\n'
gff3_digest = hashlib.sha256(gff3).hexdigest()
(annotation_cache / 'genomic.gff').write_bytes(gff3)
(annotation_cache / 'checksums.json').write_text(json.dumps({'gff3': gff3_digest}))
(annotation_cache / 'genome.json').write_text(json.dumps({'reference': request['reference'], 'metadata': None, 'facts': {}, 'annotation': 'available'}))
annotation_request = dict(request, kinds=['gff3'], copy={'path': str(annotation_cache), 'gff3_sha256': gff3_digest})
annotation_destination = root / 'run' / 'annotation.gff'
annotation_result = genome_source.copy_genome(annotation_request, {'gff3': annotation_destination})
assert 'fasta' not in annotation_result and 'fasta_sha256' not in annotation_result
assert annotation_result['downloaded'] is False
assert annotation_destination.read_bytes() == gff3
assert not (annotation_cache.parent / ('.' + request['reference']['id'] + '.lock')).exists()
`, join(installed, 'workflows', 'shared', 'scripts'), JSON.stringify(request), unrelated, join(installed, 'dist', 'genome-source.js')], {
    cwd: unrelated, encoding: 'utf8', env: {...process.env, HOME: tempDir},
  });
  if (copyTest.status !== 0) {
    problems.push(`installed genome consumer failed:\n${copyTest.stdout}${copyTest.stderr}`);
  }
  const abandoned = spawnSync(process.execPath, [join(installed, 'dist', 'genome-source.js')], {
    cwd: unrelated, input: `${JSON.stringify(request)}\n`, encoding: 'utf8', env: {...process.env, HOME: tempDir},
  });
  if (abandoned.status === 0 || existsSync(join(cache, '..', `.${reference.id}.lock`))) {
    problems.push('an unacknowledged genome consumer succeeded or left its lease behind');
  }
  // A misused subcommand loads the whole bundle and package.json, then exits with usage code 2
  // without opening the interactive application.
  const start = run(join(tempDir, 'bin', 'genopilot'), ['update', 'unexpected-argument']);
  if (start.status !== 2) {
    problems.push(`the installed CLI did not start (exit ${String(start.status)}):\n${start.stderr}`);
  }
} finally {
  rmSync(tempDir, {recursive: true, force: true});
}

if (problems.length > 0) {
  console.error(`The packed package is not installable as published:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Verified a clean installation of ${tarball}.`);
