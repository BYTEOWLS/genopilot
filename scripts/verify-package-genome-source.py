# Verify the installed package's Node/Python genome-source boundary.
import hashlib, json, os, pathlib, subprocess, sys
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
    blocked = subprocess.Popen([os.environ['GENOPILOT_NODE_EXECUTABLE'], str(entry)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    blocked.stdin.write(json.dumps(refresh) + '\n')
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
gff3 = b'##gff-version 3\n'
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
# Invoke the actual packaged workflow resolver CLI, not only its copy helper.
resolver = pathlib.Path(sys.argv[1]) / 'resolve_input.py'
remote = {'source': 'remote', 'reference': request['reference'], 'cache_mode': 'reuse', 'copy': request['copy']}
for role in ('target', 'backbone', 'reference'):
    output = root / role
    output.mkdir()
    args = [sys.executable, str(resolver), '--role', role, '--input-json', json.dumps(remote),
            '--output-root', request['root'], '--fasta-destination', str(output / 'genome.fasta'),
            '--fasta-provenance', str(output / 'fasta.json')]
    if role == 'reference':
        args += ['--gff3-destination', str(output / 'genome.gff'), '--gff3-provenance', str(output / 'gff3.json')]
        unavailable = subprocess.run(args, capture_output=True, text=True)
        assert unavailable.returncode != 0 and not (output / 'fasta.json').exists(), unavailable.stderr
        (cache / 'genomic.gff').write_bytes(gff3)
        (cache / 'checksums.json').write_text(json.dumps({'fasta': request['copy']['fasta_sha256'], 'gff3': gff3_digest}))
        record = json.loads((cache / 'genome.json').read_text())
        record['annotation'] = 'available'
        (cache / 'genome.json').write_text(json.dumps(record))
        remote['copy']['gff3_sha256'] = gff3_digest
        args[args.index('--input-json') + 1] = json.dumps(remote)
    resolved = subprocess.run(args, capture_output=True, text=True)
    assert resolved.returncode == 0, resolved.stdout + resolved.stderr
    assert (output / 'genome.fasta').read_bytes() == expected
    provenance = json.loads((output / 'fasta.json').read_text())
    assert provenance['source'] == 'ncbi' and provenance['id'] == request['reference']['id']
    assert provenance['origin'] == 'imported' and provenance['downloaded'] is False
    assert provenance['checksum']['value'] == request['copy']['fasta_sha256']
    assert provenance['provider_facts']['api'] == 'datasets-v2-rest'
    assert provenance['resolver']['node_version']
    if role == 'reference':
        assert (output / 'genome.gff').read_bytes() == gff3
        assert json.loads((output / 'gff3.json').read_text())['checksum']['value'] == gff3_digest
    assert not lock.exists()
