"""Providers: presets, CRUD, test-connection. Keys live in env vars only."""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from home.providers.base import OpenAIClient, resolve_api_key
from home.providers.catalog import PRESETS
from home.registry.db import session
from home.registry.models import Provider

router = APIRouter(prefix="/api/providers", tags=["providers"])


@router.get("/presets")
def list_presets():
    return PRESETS


@router.get("")
def list_providers(s: Session = Depends(session)):
    return s.exec(select(Provider)).all()


@router.post("", status_code=201)
def create_provider(body: dict, s: Session = Depends(session)):
    for field in ("name", "base_url", "api_key_env"):
        if not body.get(field):
            raise HTTPException(400, f"{field} is required")
    provider = Provider(
        name=body["name"],
        base_url=body["base_url"].rstrip("/"),
        api_key_env=body["api_key_env"],
        model=body.get("model", ""),
    )
    s.add(provider)
    s.commit()
    s.refresh(provider)
    return provider


@router.delete("/{provider_id}", status_code=204)
def delete_provider(provider_id: int, s: Session = Depends(session)):
    provider = s.get(Provider, provider_id)
    if not provider:
        raise HTTPException(404, "provider not found")
    s.delete(provider)
    s.commit()


@router.post("/{provider_id}/test")
async def test_provider(provider_id: int, s: Session = Depends(session)):
    provider = s.get(Provider, provider_id)
    if not provider:
        raise HTTPException(404, "provider not found")
    client = OpenAIClient(provider.base_url, resolve_api_key(provider.api_key_env), provider.model)
    try:
        chunk = await client.test_connection()
        return {"ok": True, "model": chunk.get("model")}
    except Exception as e:
        return {"ok": False, "error": str(e)[:500]}
