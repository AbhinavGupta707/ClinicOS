#!/usr/bin/env python3
"""Disposable synthetic acceptance only; no Docker or existing database access."""
import json
import os
from pathlib import Path
import signal
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = ROOT / '.audit-spectra-retirement-20260920/migration-assurance-20261002'
PG_BIN = Path('/opt/homebrew/opt/postgresql@16/bin')
NODE_BIN = str(Path(shutil.which('node') or 'node').resolve().parent)
def unused_port(exclude=()):
    for _ in range(10):
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        if port not in exclude:
            return port
    raise RuntimeError('Could not reserve distinct local test ports')

PG_PORT = unused_port()
REDIS_PORT = unused_port((PG_PORT,))
DATABASE_TOKEN = uuid.uuid4().hex

repositories_only = sys.argv[1:] == ['--run-approved-synthetic-services', '--repositories-only']
all_workflows = sys.argv[1:] == ['--run-approved-synthetic-services']
if not all_workflows and not repositories_only:
    print(json.dumps({'action': 'plan only', 'postgres_port': PG_PORT,
        'redis_port': REDIS_PORT, 'data_logs_and_tmp_parent': str(EVIDENCE),
        'existing_services': 'untouched', 'downloads': False,
        'checks': ['35 migrations and validation', 'synthetic seed/verify',
            'import/front-desk, daily/documents and 5000-patient replay; real restore into a separate owned cluster']}, indent=2))
    raise SystemExit(0)

for port in [PG_PORT, REDIS_PORT]:
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', port))

EVIDENCE.mkdir(parents=True, exist_ok=True)
RUN = Path(tempfile.mkdtemp(prefix='native-', dir=EVIDENCE))
for name in ['tmp', 'postgres', 'restore-postgres', 'redis', 'npm-cache', 'browser']:
    (RUN / name).mkdir()
env = {k: os.environ[k] for k in ['HOME', 'USER', 'LOGNAME', 'LANG'] if k in os.environ}
env.update({
    'PATH': f'{NODE_BIN}:{PG_BIN}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    'TMPDIR': str(RUN / 'tmp'), 'TMP': str(RUN / 'tmp'), 'TEMP': str(RUN / 'tmp'),
    'npm_config_cache': str(RUN / 'npm-cache'), 'NEXT_TELEMETRY_DISABLED': '1',
    'FLYWAY_REPORT_ENABLED': 'false', 'FLYWAY_CHECK_FOR_UPDATES': 'false',
    'JAVA_ARGS': f'-Djava.io.tmpdir={RUN / "tmp"} -Djava.net.preferIPv4Stack=true',
    'CLINIC_OS_ENV': 'local', 'PILOT_SYNTHETIC_DATA_ONLY': 'true',
    'CLINIC_OS_LOCAL_DB_ADMIN_URL': f'postgresql://clinic_os:clinic_os@127.0.0.1:{PG_PORT}/postgres',
    'MIGRATION_DATABASE_URL': f'postgresql://clinic_os_migrator:clinic_os_migrator@127.0.0.1:{PG_PORT}/clinic_os',
    'DATABASE_URL': f'postgresql://clinic_os_runtime:clinic_os_runtime@127.0.0.1:{PG_PORT}/clinic_os',
    'WORKER_DATABASE_URL': f'postgresql://clinic_os_worker:clinic_os_worker@127.0.0.1:{PG_PORT}/clinic_os',
    'REDIS_URL': f'redis://127.0.0.1:{REDIS_PORT}',
    'CLINIC_OS_FLYWAY_BIN': '/opt/homebrew/bin/flyway',
    'CLINICOS_MVP_IMPORT_E2E_ENABLED': 'true',
    'CLINICOS_MVP_TEST_DATABASE_DISPOSABLE': 'true',
    'CLINICOS_MVP_DATABASE_TOKEN': DATABASE_TOKEN,
    'CLINICOS_MVP_ARTIFACTS_DIR': str(RUN / 'browser'),
    'PGPASSWORD': 'clinic_os',
})
children = []
results = []

def interrupted(signum, frame):
    raise SystemExit(128 + signum)

for sig in [signal.SIGINT, signal.SIGTERM]:
    signal.signal(sig, interrupted)

def command(name, args):
    print(name, flush=True)
    with (RUN / (name + '.log')).open('w') as log:
        child = subprocess.Popen([str(a) for a in args], cwd=ROOT, env=env,
            stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = child.wait(timeout=1200)
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try: child.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
    results.append({'check': name, 'exit': code})
    (RUN / 'checks.json').write_text(json.dumps(results, indent=2))
    if code:
        raise RuntimeError(f'{name} failed; inspect {RUN / (name + ".log")}')

def start(name, args):
    log = (RUN / (name + '.log')).open('w')
    child = subprocess.Popen([str(a) for a in args], cwd=ROOT, env=env,
        stdout=log, stderr=subprocess.STDOUT)
    children.append((name, child, log))
    return child

try:
    pw = RUN / 'synthetic-password'
    pw.write_text('clinic_os\n')
    pw.chmod(0o600)
    command('initdb', [PG_BIN / 'initdb', '-D', RUN / 'postgres', '-U', 'clinic_os',
        '--auth-local=trust', '--auth-host=scram-sha-256', '--pwfile', pw,
        '--encoding=UTF8', '--locale=C'])
    postgres = start('postgres', [PG_BIN / 'postgres', '-D', RUN / 'postgres',
        '-h', '127.0.0.1', '-p', str(PG_PORT), '-k', '',
        '-c', 'max_connections=80', '-c', 'shared_buffers=64MB'])
    redis = start('redis', ['/opt/homebrew/bin/redis-server', '--bind', '127.0.0.1',
        '--port', str(REDIS_PORT), '--dir', RUN / 'redis', '--save', '', '--appendonly', 'no'])
    for _ in range(100):
        if postgres.poll() is not None or redis.poll() is not None:
            raise RuntimeError('An owned test service failed to start; refusing database access.')
        ready = subprocess.run([str(PG_BIN / 'pg_isready'), '-h', '127.0.0.1',
            '-p', str(PG_PORT), '-U', 'clinic_os'], env=env, capture_output=True)
        if ready.returncode == 0:
            break
        time.sleep(0.1)
    else:
        raise RuntimeError('Isolated PostgreSQL did not become ready.')
    (RUN / 'owned-services.json').write_text(json.dumps({'postgres_pid': postgres.pid,
        'redis_pid': redis.pid, 'postgres_port': PG_PORT, 'redis_port': REDIS_PORT,
        'data_directory': str(RUN / 'postgres')}, indent=2))
    command('create-database', [PG_BIN / 'createdb', '-h', '127.0.0.1', '-p', str(PG_PORT),
        '-U', 'clinic_os', 'clinic_os'])
    command('mark-disposable-database', [PG_BIN / 'psql', '-h', '127.0.0.1', '-p', str(PG_PORT),
        '-U', 'clinic_os', '-d', 'clinic_os', '-v', 'ON_ERROR_STOP=1', '-c',
        f"comment on database clinic_os is 'ClinicOS disposable MVP acceptance {DATABASE_TOKEN}'"])
    command('build-shared', ['npm', 'run', 'build:shared'])
    command('provision', ['node', 'scripts/db-local-lifecycle.mjs', 'provision'])
    flyway = ['/opt/homebrew/bin/flyway',
        f'-url=jdbc:postgresql://127.0.0.1:{PG_PORT}/clinic_os',
        '-user=clinic_os_migrator', '-password=clinic_os_migrator',
        f'-locations=filesystem:{ROOT / "packages/db/migrations"}',
        '-sqlMigrationPrefix=0', '-sqlMigrationSeparator=_', '-sqlMigrationSuffixes=.sql',
        '-validateMigrationNaming=true', '-table=flyway_schema_history',
        '-connectRetries=30', '-lockRetryCount=30', '-cleanDisabled=true',
        '-outOfOrder=false', '-validateOnMigrate=true']
    command('migrate', flyway + ['migrate'])
    command('validate', flyway + ['validate'])
    for action in ['grant-runtime', 'seed-local', 'verify']:
        command(action, ['node', 'scripts/db-local-lifecycle.mjs', action])
    command('build-api', ['npm', '--workspace', '@clinic-os/api', 'run', 'build'])
    command('api-all-tests', ['npm', '--workspace', '@clinic-os/api', 'run', 'test'])
    if repositories_only:
        command('migration-assurance-repositories', ['node', 'scripts/test-migration-assurance-repositories.mjs'])
    if all_workflows:
        command('financial-appointment-repositories', ['node', 'scripts/test-financial-appointment-repositories.mjs'])
        command('patient-source-context-repositories', ['node', 'scripts/test-patient-source-context-repositories.mjs'])
        command('patient-history-repositories', ['node', 'scripts/test-patient-history-repositories.mjs'])
        command('patient-media-repositories', ['node', 'scripts/test-patient-media-repositories.mjs'])
        command('real-stack-browser', ['node', 'scripts/test-mvp-real-stack.mjs'])
        command('patient-file-repositories', ['node', 'scripts/test-patient-file-repositories.mjs'])
        command('daily-after-import-browser', ['node', 'scripts/test-mvp-real-stack.mjs', '--daily-workflow'])
        command('patient-document-repositories', ['node', 'scripts/test-patient-document-repositories.mjs'])
        command('migration-assurance-repositories', ['node', 'scripts/test-migration-assurance-repositories.mjs'])
        restore_port = unused_port((PG_PORT, REDIS_PORT))
        command('restore-initdb', [PG_BIN / 'initdb', '-D', RUN / 'restore-postgres', '-U', 'clinic_os',
            '--auth-local=trust', '--auth-host=scram-sha-256', '--pwfile', pw,
            '--encoding=UTF8', '--locale=C'])
        restored = start('restore-postgres', [PG_BIN / 'postgres', '-D', RUN / 'restore-postgres',
            '-h', '127.0.0.1', '-p', str(restore_port), '-k', '',
            '-c', 'max_connections=30', '-c', 'shared_buffers=32MB'])
        for _ in range(100):
            if restored.poll() is not None:
                raise RuntimeError('Owned restore cluster failed to start.')
            ready = subprocess.run([str(PG_BIN / 'pg_isready'), '-h', '127.0.0.1', '-p', str(restore_port), '-U', 'clinic_os'], env=env, capture_output=True)
            if ready.returncode == 0: break
            time.sleep(0.1)
        else: raise RuntimeError('Owned restore cluster did not become ready.')
        command('restore-create-database', [PG_BIN / 'createdb', '-h', '127.0.0.1', '-p', str(restore_port), '-U', 'clinic_os', 'clinic_os'])
        command('restore-mark-disposable', [PG_BIN / 'psql', '-h', '127.0.0.1', '-p', str(restore_port), '-U', 'clinic_os', '-d', 'clinic_os', '-v', 'ON_ERROR_STOP=1', '-c',
            f"comment on database clinic_os is 'ClinicOS disposable MVP acceptance {DATABASE_TOKEN}'"])
        restore_manifest = RUN / 'restore-manifest.json'
        restore_manifest.write_text(json.dumps({'version': 1, 'syntheticOnly': True, 'token': DATABASE_TOKEN,
            'pgBin': str(PG_BIN),
            'source': {'port': PG_PORT, 'pid': postgres.pid, 'dataDirectory': str(RUN / 'postgres')},
            'target': {'port': restore_port, 'pid': restored.pid, 'dataDirectory': str(RUN / 'restore-postgres')}}))
        restore_manifest.chmod(0o600)
        source_env = env.copy()
        for key in ['CLINIC_OS_LOCAL_DB_ADMIN_URL', 'MIGRATION_DATABASE_URL', 'DATABASE_URL', 'WORKER_DATABASE_URL']:
            env[key] = env[key].replace(f':{PG_PORT}/', f':{restore_port}/')
        command('restore-provision-roles', ['node', 'scripts/db-local-lifecycle.mjs', 'provision'])
        env = source_env.copy()
        command('real-database-restore', ['node', 'scripts/synthetic-database-restore.mjs', restore_manifest])
        for key in ['CLINIC_OS_LOCAL_DB_ADMIN_URL', 'MIGRATION_DATABASE_URL', 'DATABASE_URL', 'WORKER_DATABASE_URL']:
            env[key] = env[key].replace(f':{PG_PORT}/', f':{restore_port}/')
        command('restored-runtime-rls-verify', ['node', 'scripts/db-local-lifecycle.mjs', 'verify'])
        restored_flyway = [arg.replace(f':{PG_PORT}/', f':{restore_port}/') for arg in flyway]
        command('restored-migration-validation', restored_flyway + ['validate'])

finally:
    cleanup = []
    for name, child, log in reversed(children):
        if child.poll() is None:
            child.send_signal(signal.SIGINT if name in ['postgres', 'restore-postgres'] else signal.SIGTERM)
            try:
                child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        log.close()
        cleanup.append({'service': name, 'pid': child.pid, 'exit': child.returncode})
    (RUN / 'cleanup.json').write_text(json.dumps(cleanup, indent=2))
    print(f'Evidence retained: {RUN}', flush=True)
