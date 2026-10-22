"""Shared shutdown for Predict60 Docker deployments."""
import shutil
import subprocess


def stop_docker():
    """Stop Predict60 containers without touching other Docker applications or volumes."""
    if shutil.which('docker') is None:
        return
    try:
        containers = set()
        for selector in ('name=^/p60-local$',
                         'label=com.docker.compose.project=p60',
                         'label=com.docker.compose.project=p60-local'):
            result = subprocess.run(
                ['docker', 'ps', '-q', '--filter', selector],
                check=True, capture_output=True, text=True,
            )
            containers.update(result.stdout.split())
        if containers:
            print('Stopping Predict60 Docker containers...', flush=True)
            subprocess.run(['docker', 'stop', '--time', '30', *sorted(containers)], check=True)
    except (OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(
            'Cannot check or stop Predict60 Docker containers. Check Docker access and '
            'permissions, then retry; Docker shutdown could not be completed.'
        ) from error

