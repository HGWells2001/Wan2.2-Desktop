from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
import subprocess
import threading
import uuid


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


@dataclass
class GenerationJob:
    id: str
    command: list[str]
    output_path: Path
    status: JobStatus = JobStatus.queued
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: datetime | None = None
    finished_at: datetime | None = None
    return_code: int | None = None
    error: str | None = None
    process: subprocess.Popen[str] | None = field(default=None, repr=False)

    def public_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "status": self.status,
            "outputPath": str(self.output_path),
            "createdAt": self.created_at.isoformat(),
            "startedAt": self.started_at.isoformat() if self.started_at else None,
            "finishedAt": self.finished_at.isoformat() if self.finished_at else None,
            "returnCode": self.return_code,
            "error": self.error,
        }


class JobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, GenerationJob] = {}
        self._lock = threading.Lock()

    def create(self, command: list[str], output_path: Path) -> GenerationJob:
        job = GenerationJob(
            id=uuid.uuid4().hex,
            command=command,
            output_path=output_path,
        )
        with self._lock:
            self._jobs[job.id] = job

        threading.Thread(target=self._run, args=(job,), daemon=True).start()
        return job

    def get(self, job_id: str) -> GenerationJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> bool:
        job = self.get(job_id)
        if job is None or job.process is None:
            return False

        if job.process.poll() is not None:
            return False

        job.process.terminate()
        job.status = JobStatus.cancelled
        job.finished_at = datetime.now(timezone.utc)
        return True

    def _run(self, job: GenerationJob) -> None:
        job.status = JobStatus.running
        job.started_at = datetime.now(timezone.utc)

        try:
            job.process = subprocess.Popen(
                job.command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            stdout, _ = job.process.communicate()
            job.return_code = job.process.returncode

            if job.status == JobStatus.cancelled:
                return

            if job.return_code == 0:
                job.status = JobStatus.completed
            else:
                job.status = JobStatus.failed
                job.error = stdout[-8000:] if stdout else "Wan process failed"
        except Exception as exc:
            job.status = JobStatus.failed
            job.error = str(exc)
        finally:
            job.finished_at = datetime.now(timezone.utc)
