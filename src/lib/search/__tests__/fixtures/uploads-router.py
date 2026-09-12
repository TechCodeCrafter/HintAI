"""
Upload and Processing Router

Handles file upload and document processing endpoints:
- Generate presigned S3 upload URLs
- Trigger Lambda processing for uploaded files
"""

import logging
import os
import boto3
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from api.config import settings
from api.models.requests import ProcessFilesV2Request
from api.models.responses import UploadUrlResponse, ProcessFilesResponse, ErrorResponse
from api.dependencies import verify_session_exists, get_storage_backend
from services.step_functions_processor import StepFunctionProcessor
from services.template_validation.duplicate_checker import DuplicateChecker

FILE_REGISTRY_TABLE = os.environ.get("FILE_REGISTRY_TABLE", "chb-rdb-labsai-dev-file-registry")
VALID_DUPLICATE_ACTIONS = {"reprocess", "continue"}

logger = logging.getLogger(__name__)


def _step_functions_setup_hint() -> str:
    """Return actionable local setup steps for Step Functions configuration."""
    return (
        "STEP_FUNCTION_ARN is not configured. "
        "For local runs, set environment variables before starting the API: "
        "USE_STEP_FUNCTIONS=true and "
        "STEP_FUNCTION_ARN=arn:aws:states:us-east-1:<account>:stateMachine:<name>. "
        "If you are not testing orchestration locally, set USE_STEP_FUNCTIONS=false."
    )

router = APIRouter(
    prefix="/sessions",
    tags=["File Upload & Processing"],
    responses={
        404: {"model": ErrorResponse, "description": "Session not found"},
        500: {"model": ErrorResponse, "description": "Internal server error"}
    }
)

# Initialize AWS clients
s3_client = boto3.client('s3', region_name=settings.AWS_REGION)



# ─────────────────────────────────────────────────────────────────────────────
# V2 endpoints — duplicate detection enforced
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{session_id}/upload-url-v2", response_model=UploadUrlResponse)
async def get_upload_url_v2(
    session_id: str,
    filename: str = Query(..., description="Name of the file to upload"),
    doc_type: str = Query(default="auto", description="Document type: 'test_plan', 'test_report', or 'auto'"),
    file_hash: Optional[str] = Query(default=None, description="SHA-256 hex digest of the file content"),
    _: None = Depends(verify_session_exists)
):
    """
    **V2** — Generate a presigned S3 upload URL **with duplicate detection**.

    Pass `file_hash` (SHA-256 of the raw file bytes, computed by the frontend).
    The API checks the shared file registry by hash:
    - Hash match  → `content_duplicate` (same content, filename ignored)

    If any match is found, `requires_confirmation=true` and `duplicate_warnings` are returned.
    The frontend must show the user a choice (`reprocess` / `skip` / `continue`) before
    calling `/process-v2`.

    If `file_hash` is omitted, duplicate pre-check is skipped.
    """
    try:
        if doc_type not in ['test_plan', 'test_report', 'auto']:
            doc_type = 'auto'

        s3_key = f"test-sessions/{session_id}/{filename}"
        expires_in = 3600
