from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
import re
import subprocess
import threading
import uuid


_PERCENT_RE = re.compile(r"(?<!\d)(100|[1-9]?\d)%")


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
    progress: int = 0
    phase: str = "Queued"
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: datetime | None = None
    finished_at: datetime | None = None
    return_code: int | None = None
    error: str | None = None
    process: subprocess.Popen[str] | None = field(default=None, repr=False)
    log_tail: str = field(default="", repr=False)

    def public_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "status": self.status,
            "progress": self.progress,
            "phase": self.phase,
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
        job.phase = "Cancelled"
        job.finished_at = datetime.now(timezone.utc)
        return True

    @staticmethod
    def _update_progress(job: GenerationJob, text: str) -> None:
        lower = text.lower()

        if "fetching" in lower or "download" in lower:
            job.phase = "Downloading"
        elif "load" in lower and ("model" in lower or "checkpoint" in lower):
            job.phase = "Loading model"
        elif "generating video" in lower or "sampling" in lower or "denois" in lower:
            job.phase = "Generating frames"
        elif "sav" in lower and ("video" in lower or ".mp4" in lower):
            job.phase = "Saving video"
        elif job.phase in {"Queued", "Starting"}:
            job.phase = "Running"

        matches = _PERCENT_RE.findall(text)
        if matches:
            parsed = max(int(value) for value in matches)

            if job.phase == "Loading model":
                mapped = 10 + round(parsed * 0.35)
            elif job.phase == "Generating frames":
                mapped = 45 + round(parsed * 0.50)
            elif job.phase == "Saving video":
                mapped = 97
            else:
                mapped = parsed

            # Reserve 100 for a process that actually exits successfully.
            job.progress = max(job.progress, min(mapped, 99))

    def _run(self, job: GenerationJob) -> None:
        job.status = JobStatus.running
        job.phase = "Starting"
        job.progress = 1
        job.started_at = datetime.now(timezone.utc)

        try:
            job.process = subprocess.Popen(
                job.command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )

            assert job.process.stdout is not None
            buffer = ""

            while True:
                char = job.process.stdout.read(1)
                if char == "":
                    break

                if char in "\r\n":
                    if buffer:
                        self._update_progress(job, buffer)
                        job.log_tail = (job.log_tail + buffer + "\n")[-8000:]
                        buffer = ""
                else:
                    buffer += char

            if buffer:
                self._update_progress(job, buffer)
                job.log_tail = (job.log_tail + buffer + "\n")[-8000:]

            job.process.wait()
            job.return_code = job.process.returncode

            if job.status == JobStatus.cancelled:
                return

            if job.return_code == 0:
                job.status = JobStatus.completed
                job.progress = 100
                job.phase = "Completed"
            else:
                job.status = JobStatus.failed
                job.phase = "Failed"
                job.error = job.log_tail or "Wan process failed"
        except Exception as exc:
            job.status = JobStatus.failed
            job.phase = "Failed"
            job.error = str(exc)
        finally:
            job.finished_at = datetime.now(timezone.utc)
